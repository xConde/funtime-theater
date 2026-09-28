/**
 * Theater film contact-sheet harness.
 *
 * Renders the procedural film scenes to PNG contact sheets so composition
 * can be reviewed frame by frame, with optional guides:
 *   - blue: true frame center
 *   - green: safe stage (SCENE_SAFE_TOP/BOTTOM and STAGE_CENTER_Y from the
 *     painter itself, so guides never drift from code)
 *   - red: simulated in-game crop window for a given screen aspect
 *     (object-fit: cover anchored at 75%, matching _film-layer.scss)
 *
 * Run from the repo root (playwright resolves from cwd):
 *   node scripts/theater-contact-sheet.mjs                  # featured films
 *   node scripts/theater-contact-sheet.mjs --seeds 15,53    # specific seeds
 *   node scripts/theater-contact-sheet.mjs --crop 4.5       # add crop guide
 *   node scripts/theater-contact-sheet.mjs --no-guides      # raw frames
 *   node scripts/theater-contact-sheet.mjs --bw             # grayscale twin
 *   node scripts/theater-contact-sheet.mjs --timeline 3     # filmstrip: a frame every 3s
 *   node scripts/theater-contact-sheet.mjs --seconds 7,31,84  # exact frames
 *   node scripts/theater-contact-sheet.mjs --out /tmp/sheets
 *
 * --bw renders a grayscale copy under each frame: if a scene reads in
 * grayscale its contrast is real; if it dissolves, the colors were doing
 * the work and will blend on dim screens.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILM_DIR = join(repoRoot, 'src/app/theater/film');
const FILES = ['seeded-rng', 'film.model', 'film-content', 'film-generator', 'scene-painter', 'featured-films'];

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const seedsArg = argValue('--seeds');
const cropAspect = argValue('--crop') ? Number(argValue('--crop')) : null;
// Render each cell at a chosen logical width instead of the design 480. The
// in-game screen now sizes its buffer to the panel aspect, so this shows the
// real wide-monitor frame (full height, leader intact) without simulation.
const renderWidth = argValue('--width') ? Number(argValue('--width')) : null;
const outDir = argValue('--out') ?? '/tmp/theater-sheets';
const guides = !args.includes('--no-guides');
const grayscale = args.includes('--bw');
const timelineStep = argValue('--timeline') ? Number(argValue('--timeline')) : null;
const exactSeconds = argValue('--seconds')
  ? argValue('--seconds').split(',').map(Number)
  : null;

// Transpile the pure film modules with the repo's TypeScript.
const work = mkdtempSync(join(tmpdir(), 'film-sheet-'));
for (const f of FILES) {
  execFileSync('cp', [join(FILM_DIR, `${f}.ts`), work]);
}
execFileSync(
  join(repoRoot, 'node_modules/.bin/tsc'),
  ['--module', 'commonjs', '--target', 'es2022', '--skipLibCheck', ...FILES.map((f) => `${f}.ts`)],
  { cwd: work }
);

let bundle = 'const modules = {}; const require = (p) => modules[p.replace("./","")];\n';
for (const f of FILES) {
  const src = readFileSync(join(work, `${f}.js`), 'utf8');
  bundle += `modules[${JSON.stringify(f)}] = (() => { const exports = {}; const module = { exports };\n${src}\nreturn module.exports; })();\n`;
}
bundle += `window.FILM = modules['film-generator'];
window.PAINT = modules['scene-painter'];
window.FEATURED = modules['featured-films'];`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.setContent('<body style="background:#191919;margin:0;padding:8px"></body>');
await page.evaluate(bundle);

const seeds = seedsArg
  ? seedsArg.split(',').map(Number)
  : await page.evaluate(() => window.FEATURED.FEATURED_FILM_SEEDS.slice());

for (const seed of seeds) {
  await page.evaluate(() => {
    document.body.innerHTML = '';
  });
  const meta = await page.evaluate(
    ({ s, withGuides, crop, bw, step, exact, rw }) => {
      const { generateFilm, beatAt } = window.FILM;
      const paint = window.PAINT;
      const { paintScene, SCENE_WIDTH, SCENE_HEIGHT, SCENE_PIXEL_RATIO } = paint;
      const cellW = rw || SCENE_WIDTH;
      const dispW = Math.round(100 * (cellW / SCENE_HEIGHT));
      const film = generateFilm(s, 90);

      const header = document.createElement('div');
      header.style.cssText = 'color:#ddd;font:bold 13px monospace;margin:4px';
      header.textContent = `seed ${s} [${film.genre}] ${film.title} (${film.year})`;
      document.body.appendChild(header);

      let samples;
      if (exact) {
        samples = exact.map((t) => ({ t, tag: 'frame' }));
      } else if (step) {
        // Filmstrip: a frame every `step` seconds across the whole runtime,
        // for continuity effects that per-beat samples cannot show.
        samples = [];
        for (let t = 0.5; t < film.runtimeSeconds; t += step) {
          samples.push({ t, tag: beatAt(film, t)?.kind ?? 'none' });
        }
      } else {
        samples = [
          { t: 1.2, tag: 'leader' },
          { t: 4.2, tag: 'title' },
        ];
        for (const b of film.beats) {
          if (b.kind === 'title-card' || b.kind === 'credits') continue;
          samples.push({ t: b.startsAt + b.duration * 0.15, tag: `${b.kind} early` });
          samples.push({ t: b.startsAt + b.duration * 0.6, tag: `${b.kind} mid` });
        }
        samples.push({ t: 87, tag: 'credits' });
      }

      for (const sm of samples) {
        const wrapEl = document.createElement('div');
        wrapEl.style.cssText = 'display:inline-block;margin:3px;text-align:center;color:#999;font:9px monospace';
        const c = document.createElement('canvas');
        c.width = cellW * SCENE_PIXEL_RATIO;
        c.height = SCENE_HEIGHT * SCENE_PIXEL_RATIO;
        c.style.cssText = step
          ? `width:${Math.round(70 * (cellW / SCENE_HEIGHT))}px;height:70px;display:block`
          : `width:${dispW}px;height:100px;display:block`;
        wrapEl.appendChild(c);
        const cap = document.createElement('div');
        const beat = beatAt(film, sm.t);
        cap.textContent = `${sm.tag} @${sm.t.toFixed(1)}s`;
        wrapEl.appendChild(cap);
        document.body.appendChild(wrapEl);
        const ctx = c.getContext('2d');
        paintScene(ctx, film, beat, sm.t);
        if (bw) {
          const twin = document.createElement('canvas');
          twin.width = c.width;
          twin.height = c.height;
          twin.style.cssText = `width:${dispW}px;height:100px;display:block;filter:grayscale(1)`;
          twin.getContext('2d').drawImage(c, 0, 0);
          wrapEl.insertBefore(twin, cap);
        }

        if (withGuides) {
          // Guides paint in logical units on top of the frame.
          ctx.setTransform(SCENE_PIXEL_RATIO, 0, 0, SCENE_PIXEL_RATIO, 0, 0);
          const w = cellW;
          const h = SCENE_HEIGHT;
          // True frame center: blue.
          ctx.strokeStyle = 'rgba(80, 160, 255, 0.6)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(w / 2, 0);
          ctx.lineTo(w / 2, h);
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();
          // Safe stage: green band + stage center line.
          ctx.strokeStyle = 'rgba(80, 255, 140, 0.55)';
          ctx.beginPath();
          ctx.moveTo(0, paint.SCENE_SAFE_TOP);
          ctx.lineTo(w, paint.SCENE_SAFE_TOP);
          ctx.moveTo(0, paint.SCENE_SAFE_BOTTOM);
          ctx.lineTo(w, paint.SCENE_SAFE_BOTTOM);
          ctx.stroke();
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(0, paint.STAGE_CENTER_Y);
          ctx.lineTo(w, paint.STAGE_CENTER_Y);
          ctx.stroke();
          ctx.setLineDash([]);
          // Simulated in-game crop for a given aspect: red.
          if (crop) {
            const visibleH = h * (w / h / crop);
            const cropTotal = h - visibleH;
            const top = cropTotal * 0.75;
            ctx.strokeStyle = 'rgba(255, 90, 90, 0.7)';
            ctx.setLineDash([6, 4]);
            ctx.strokeRect(0.5, top, w - 1, visibleH);
            ctx.setLineDash([]);
          }
        }
      }
      return film.title;
    },
    { s: seed, withGuides: guides, crop: cropAspect, bw: grayscale, step: timelineStep, exact: exactSeconds, rw: renderWidth }
  );
  const file = join(outDir, `sheet-${seed}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`seed ${seed}: ${meta} -> ${file}`);
}
await browser.close();
