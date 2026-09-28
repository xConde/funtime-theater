import { LEADER_SECONDS } from './film-generator';
import { BeatKind, Film, FilmBeat } from './film.model';
import { createRng, Rng } from './seeded-rng';

/**
 * Lo-fi procedural scene painter: what is actually ON the screen.
 *
 * Each genre has a default set plus staging variants per beat kind, so a
 * chase looks like a chase and a climax looks like a climax instead of the
 * same furniture at a different speed. After the scene, the frame gets the
 * house treatment: film grain, an occasional projector scratch, the reel
 * change cue dot, letterbox bars, and a front row of audience silhouettes
 * so every frame reads as watched from inside the theater.
 *
 * Determinism: scene furniture derives from film.seed (same film, same
 * sets, forever). Motion derives from the film clock, so painting is a pure
 * function of (film, beat, second) callable at any cadence.
 *
 * Perf rules honored: no shadowBlur, no per-shape gradients, no string
 * building in the loop, no allocations beyond the cached scene props.
 */

export const SCENE_WIDTH = 480;
export const SCENE_HEIGHT = 150;
/**
 * Device pixels per logical scene unit. The art direction is mid-century
 * flat silhouette, not pixel art: canvases render at double resolution so
 * curves stay smooth when CSS scales them up.
 */
export const SCENE_PIXEL_RATIO = 2;

const LETTERBOX = 7;
/** Seconds over which beat-driven positions ease across a beat boundary. */
const INTENSITY_EASE_SECONDS = 1.5;

/**
 * Safe stage. The in-game screen now sizes its canvas buffer to the panel's
 * aspect ratio (clamped ~3.2:1..5.3:1), so within that range the full frame
 * height is shown and nothing crops vertically — the countdown leader and
 * hero moments are framed on every monitor. The safe band remains the guide
 * for two cases: the fixed-aspect lobby attract canvas, and panels beyond the
 * clamp ceiling where object-fit cover still trims a little. Anything that
 * must read everywhere (countdown leader, irises, hero moments) centers on
 * STAGE_CENTER_Y. The contact-sheet harness draws these as guides.
 */
export const SCENE_SAFE_TOP = 36;
export const SCENE_SAFE_BOTTOM = 140;
export const STAGE_CENTER_Y = 82;

interface AudienceHead {
  x: number;
  r: number;
  phase: number;
}

interface SceneProps {
  readonly seed: number;
  readonly house: { x: number; w: number; roof: number };
  readonly stars: readonly { x: number; y: number; r: number }[];
  readonly skyline: readonly { x: number; w: number; h: number }[];
  readonly windows: readonly { x: number; y: number }[];
  readonly cacti: readonly { x: number; h: number }[];
  readonly rain: readonly { x: number; speed: number }[];
  readonly audience: readonly AudienceHead[];
}

interface SceneEnv {
  readonly ctx: CanvasRenderingContext2D;
  readonly w: number;
  readonly h: number;
  readonly second: number;
  readonly progress: number;
  /** 0..1 across the whole film, for arcs that span every beat. */
  readonly filmProgress: number;
  readonly intensity: number;
  readonly flash: boolean;
  readonly beatKind: BeatKind;
  readonly props: SceneProps;
  readonly primary: string;
  readonly accent: string;
  /** The palette's background: used to cut same-color shapes out of a
   *  same-color set piece (road dashes over a road strip, a clock face
   *  inset in its own rim) so they read instead of vanishing. */
  readonly bg: string;
}

let cachedProps: SceneProps | null = null;
let cachedPropsWidth = 0;

/**
 * Scene furniture for a film, laid out across the actual render width so a
 * wider buffer fills with stars / skyline / rain / a longer front row instead
 * of leaving the right edge bare. Cached by seed AND width; width is stable
 * for the life of a mount, so the render loop still gets a cache hit every
 * frame and never reallocates. Counts scale with width to hold density (and
 * the front-row pitch) constant across panel shapes.
 */
function sceneProps(film: Film, width: number): SceneProps {
  const w = Math.round(width);
  if (cachedProps && cachedProps.seed === film.seed && cachedPropsWidth === w) return cachedProps;
  const rng = createRng(film.seed ^ 0x5ce9e);
  const density = w / SCENE_WIDTH;
  const audienceCount = Math.max(15, Math.round(15 * density));
  cachedProps = {
    seed: film.seed,
    // Every haunted house is haunted in its own way.
    house: { x: 0.3 + rng() * 0.42, w: 58 + rng() * 38, roof: 16 + rng() * 20 },
    stars: makeMany(Math.round(38 * density), () => ({
      x: rng() * w,
      y: rng() * SCENE_HEIGHT * 0.55,
      r: rng() < 0.85 ? 1 : 2,
    })),
    skyline: makeSkyline(rng, w),
    windows: makeMany(26, () => ({ x: rng(), y: rng() })),
    cacti: makeMany(3, () => ({ x: 40 + rng() * (w - 80), h: 22 + rng() * 18 })),
    rain: makeMany(Math.round(42 * density), () => ({ x: rng() * w, speed: 90 + rng() * 70 })),
    // Jittered grid, not pure random: real rows have a seat pitch.
    audience: makeMany(audienceCount, () => ({ x: 0, r: 6 + rng() * 4, phase: rng() * Math.PI * 2 })).map(
      (head, i) => ({
        ...head,
        x: (i + 0.5) * (w / audienceCount) + (rng() - 0.5) * 14,
      })
    ),
  };
  cachedPropsWidth = w;
  return cachedProps;
}

function makeMany<T>(count: number, factory: () => T): T[] {
  const out: T[] = [];
  for (let i = 0; i < count; i++) out.push(factory());
  return out;
}

function makeSkyline(rng: Rng, width: number): { x: number; w: number; h: number }[] {
  const buildings: { x: number; w: number; h: number }[] = [];
  let x = -10;
  while (x < width + 10) {
    const w = 24 + rng() * 36;
    buildings.push({ x, w, h: 28 + rng() * 52 });
    x += w + 2;
  }
  return buildings;
}

/** Positive modulo for scroll wrapping. */
function wrap(value: number, range: number): number {
  return ((value % range) + range) % range;
}

/**
 * Multiplicative tint of a #rrggbb color, cached so the render loop never
 * rebuilds strings. Used to give hero silhouettes their own value so they
 * separate from set pieces painted in the same palette primary.
 */
const shadeCache = new Map<string, string>();
function shade(hex: string, factor: number): string {
  const key = hex + factor;
  let value = shadeCache.get(key);
  if (!value) {
    const n = parseInt(hex.slice(1), 16);
    const channel = (bits: number): number => Math.min(255, Math.round(((n >> bits) & 255) * factor));
    value = `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
    shadeCache.set(key, value);
  }
  return value;
}

/**
 * Intensity eased from the previous beat's value over the first moments of
 * the current beat, so positions keyed to intensity (the approaching figure,
 * the closing standoff) glide instead of teleporting at beat boundaries.
 */
function easedIntensity(film: Film, beat: FilmBeat, second: number): number {
  const index = film.beats.indexOf(beat);
  if (index <= 0) return beat.intensity;
  const prev = film.beats[index - 1].intensity;
  const k = Math.min(1, Math.max(0, (second - beat.startsAt) / INTENSITY_EASE_SECONDS));
  const eased = 1 - (1 - k) * (1 - k);
  return prev + (beat.intensity - prev) * eased;
}

/**
 * Paint one frame. `second` is the film clock; `beat` the current beat.
 * Returns quietly when beat is null (screen dark between shows).
 */
export function paintScene(
  ctx: CanvasRenderingContext2D,
  film: Film,
  beat: FilmBeat | null,
  second: number,
  options: { frontRow?: boolean } = {}
): void {
  // All painting happens in logical scene units; the canvas itself is
  // double resolution so flat shapes keep smooth edges when scaled.
  ctx.setTransform(SCENE_PIXEL_RATIO, 0, 0, SCENE_PIXEL_RATIO, 0, 0);
  const [bg, primary, accent] = film.poster.palette;
  // The in-game screen sizes its buffer to the panel aspect (clamped), so the
  // painter renders at the real logical width and the full height always
  // shows. Fixed-size callers (the lobby attract canvas, specs) fall back to
  // the design width. Height is fixed; only the width breathes.
  const w = ctx.canvas?.width ? ctx.canvas.width / SCENE_PIXEL_RATIO : SCENE_WIDTH;
  const h = SCENE_HEIGHT;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (!beat) return;

  const props = sceneProps(film, w);
  const progress = Math.min(1, Math.max(0, (second - beat.startsAt) / beat.duration));
  const env: SceneEnv = {
    ctx,
    w,
    h,
    second,
    progress,
    filmProgress: Math.min(1, second / film.runtimeSeconds),
    intensity: easedIntensity(film, beat, second),
    // Spike beats open with a hard flash: the jump scare, the reveal.
    flash: beat.kind === 'spike' && progress < 0.18,
    beatKind: beat.kind,
    props,
    primary,
    accent,
    bg,
  };

  if (beat.kind === 'title-card') {
    // First the countdown leader, then premiere searchlights under the title.
    const leaderSecond = second - beat.startsAt;
    if (leaderSecond < LEADER_SECONDS) {
      paintLeader(ctx, w, h, leaderSecond, primary, accent);
    } else {
      paintSearchlights(ctx, w, h, second, accent);
    }
  } else if (beat.kind === 'credits') {
    // The DOM layer owns the typography; the canvas sweeps the premiere
    // searchlights behind it. The old low-alpha iris was invisible against
    // dark palettes.
    paintSearchlights(ctx, w, h, second, accent);
  } else {
    switch (film.genre) {
      case 'scifi':
        paintScifi(env);
        break;
      case 'kaiju':
        paintKaiju(env);
        break;
      case 'horror':
        paintHorror(env);
        break;
      case 'noir':
        paintNoir(env);
        break;
      case 'western':
        paintWestern(env);
        break;
      case 'romance':
        paintRomance(env);
        break;
    }
    if (env.flash) {
      // Bright enough to read as lightning, light enough that the scene's
      // shapes keep their separation instead of washing into the sky.
      ctx.fillStyle = 'rgba(255, 250, 235, 0.32)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  paintArtifacts(ctx, w, h, beat, second, film.poster.grain);
  paintLetterbox(ctx, w, h);
  // The painted front row frames a lobby attract clip as "watched from inside a
  // theater". In-game the real seating sits directly below the screen, so the
  // painted heads would double the audience — the in-game caller turns them off.
  if (options.frontRow ?? true) {
    paintAudience(ctx, props, w, h, second);
  }
}

// ---------------------------------------------------------------------------
// Sci-fi
// ---------------------------------------------------------------------------

function paintScifi(env: SceneEnv): void {
  const { ctx, w, h, second, intensity, primary, accent } = env;
  ctx.fillStyle = primary;
  for (const s of env.props.stars) {
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.fillRect(0, h - 18, w, 18);

  if (env.beatKind === 'chase') {
    // The pickup truck outruns the light beam.
    // Dashes are a cut-out of the road, not a paint-over: same color as the
    // road strip would just erase them.
    ctx.fillStyle = env.bg;
    for (let i = 0; i < 9; i++) {
      const x = wrap(i * 60 - second * 220, w + 60) - 30;
      ctx.fillRect(x, h - 13, 26, 3);
    }
    // A fast washboard jolt, not a lazy side-to-side sway: dirt roads
    // throw a truck up and down, not port to starboard.
    const jolt = Math.sin(second * 13) * 1.2;
    const tx = w * 0.32 + Math.sin(second * 0.5) * 1.5;
    ctx.fillStyle = accent;
    ctx.fillRect(tx, h - 34 + jolt, 46, 14);
    ctx.fillRect(tx + 4, h - 45 + jolt, 17, 11);
    // Cab window cut from the body color, wheels dark and separate.
    ctx.fillStyle = primary;
    ctx.fillRect(tx + 7, h - 42 + jolt, 9, 6);
    ctx.fillStyle = 'rgba(10, 14, 24, 0.7)';
    ctx.beginPath();
    ctx.arc(tx + 10, h - 19 + jolt, 5, 0, Math.PI * 2);
    ctx.arc(tx + 36, h - 19 + jolt, 5, 0, Math.PI * 2);
    ctx.fill();
    // The beam sweeps from wherever the saucer actually is, so it never
    // detaches from a swaying source.
    const saucerX = w * 0.62 + Math.sin(second * 3) * 8;
    const saucerY = h * 0.32;
    drawSaucer(ctx, saucerX, saucerY, accent, second);
    sweepBeam(ctx, saucerX, saucerY, tx + 50, h - 18, accent, 0.3);
    return;
  }

  if (env.beatKind === 'twist') {
    // The moon is a door.
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.arc(w * 0.5, STAGE_CENTER_Y - 8, 42, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w * 0.5, STAGE_CENTER_Y - 8, 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = primary;
    ctx.fillRect(w * 0.5 - 9, STAGE_CENTER_Y - 24, 18, 32);
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.5 + 4, STAGE_CENTER_Y - 10, 2, 4);
    return;
  }

  // Default set: the saucer drifts over the water tower, descending a
  // little more with every reel.
  ctx.fillStyle = primary;
  // Tank on splayed legs with a little cap: unmistakably a water tower.
  ctx.fillRect(w * 0.78 - 1, h - 50, 3, 32);
  ctx.fillRect(w * 0.78 + 9, h - 50, 3, 32);
  ctx.beginPath();
  ctx.ellipse(w * 0.78 + 5, h - 54, 14, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w * 0.78 - 7, h - 58);
  ctx.lineTo(w * 0.78 + 5, h - 68);
  ctx.lineTo(w * 0.78 + 17, h - 58);
  ctx.closePath();
  ctx.fill();
  const sx = w * (0.5 + 0.26 * Math.sin(second * (0.4 + intensity)));
  const sy = h * (0.24 + env.filmProgress * 0.16) + Math.sin(second * 1.7) * 6 * intensity;
  drawSaucer(ctx, sx, sy, accent, second);
  if (intensity > 0.6 || env.flash) {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(sx - 6, sy + 6);
    ctx.lineTo(sx - 22, h - 18);
    ctx.lineTo(sx + 22, h - 18);
    ctx.lineTo(sx + 6, sy + 6);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function drawSaucer(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, second = 0): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, 42, 11, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x, y - 9, 17, 9, 0, Math.PI, 0);
  ctx.fill();
  // Portholes, and the under-light that blinks like it means something.
  ctx.fillStyle = 'rgba(10, 14, 24, 0.7)';
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(x + i * 14 - 2, y - 3, 4, 4);
  }
  if (Math.sin(second * 4) > 0) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.arc(x, y + 7, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function sweepBeam(
  ctx: CanvasRenderingContext2D,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  color: string,
  alpha: number
): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(fromX - 5, fromY + 6);
  ctx.lineTo(toX - 14, toY);
  ctx.lineTo(toX + 14, toY);
  ctx.lineTo(fromX + 5, fromY + 6);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Kaiju
// ---------------------------------------------------------------------------

function paintKaiju(env: SceneEnv): void {
  const { ctx, w, h, second, progress, intensity, primary, accent } = env;

  if (env.beatKind === 'climax') {
    // Monster against monster, fought over the wreckage already made:
    // the filmstrip caught the city quietly healing for the finale.
    paintSkyline(env, 0.55, kaijuCityDamage(env).perBuilding);
    // Different rates and phases so the two read as trading blows, not
    // mirror-dancing, and a shared strike clock alternates who lunges.
    const leftSway = Math.sin(second * 0.7) * 6;
    const rightSway = Math.sin(second * 0.9 + Math.PI * 0.5) * 6;
    const strike = Math.sin(second * 0.9);
    const leftLunge = strike > 0.35 ? Math.min(1, (strike - 0.35) / 0.4) : 0;
    const rightLunge = strike < -0.35 ? Math.min(1, (-strike - 0.35) / 0.4) : 0;
    drawKaijuMonster(ctx, w * 0.16 + leftSway, h, 0.85, 1, primary, accent, env.flash || leftLunge > 0.5, leftLunge);
    drawKaijuMonster(
      ctx,
      w * 0.78 + rightSway,
      h,
      0.85,
      -1,
      primary,
      accent,
      env.flash || rightLunge > 0.5,
      rightLunge
    );
    return;
  }

  if (env.beatKind === 'chase') {
    // The city they are fleeing, distant and dark, plus an air-raid
    // searchlight: the sky was a void without them.
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.4;
    for (const b of env.props.skyline) {
      ctx.fillRect(b.x, h - 16 - b.h * 0.4, b.w, b.h * 0.4);
    }
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = accent;
    const sweep = Math.sin(second * 0.8) * 0.45;
    ctx.beginPath();
    ctx.moveTo(w * 0.7 - 4, h - 16);
    ctx.lineTo(w * 0.7 + Math.sin(sweep) * h * 1.3 - 20, h - 16 - Math.cos(sweep) * h * 1.3);
    ctx.lineTo(w * 0.7 + Math.sin(sweep) * h * 1.3 + 20, h - 16 - Math.cos(sweep) * h * 1.3);
    ctx.lineTo(w * 0.7 + 4, h - 16);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // The crowd run. Hats everywhere.
    ctx.fillStyle = primary;
    ctx.fillRect(0, h - 16, w, 16);
    for (let i = 0; i < 14; i++) {
      const x = wrap(i * 38 + second * (120 + (i % 3) * 18), w + 60) - 30;
      const bob = Math.abs(Math.sin(second * 9 + i)) * 2.5;
      const step = Math.floor(second * 10 + i) % 2;
      ctx.fillRect(x, h - 31 - bob, 5, 13);
      ctx.fillRect(x - 1 + step * 4, h - 18 - bob, 2.5, 6);
      ctx.fillRect(x + 3.5 - step * 4, h - 18 - bob, 2.5, 6);
      ctx.beginPath();
      ctx.arc(x + 2.5, h - 34 - bob, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Hats coming off in the panic: tumbling in an arc just over the
    // crowd's heads, drifting backward against the run.
    ctx.fillStyle = accent;
    for (let i = 0; i < 3; i++) {
      const t = wrap(second * 0.9 + i * 0.33, 1);
      const hatX = wrap(i * 150 + 40 + second * 130, w + 60) - 30 - t * 26;
      const hatY = h - 38 - Math.sin(t * Math.PI) * 16;
      ctx.save();
      ctx.translate(hatX, hatY);
      ctx.rotate(t * Math.PI * 2);
      ctx.fillRect(-6, -1.5, 12, 3);
      ctx.fillRect(-3.5, -6.5, 7, 5);
      ctx.restore();
    }
    // The leg descends at an angle and ends in an actual foot with claws.
    // Moonlit shade so the creature separates from same-palette set pieces.
    // Weighted stomp cycle: slow lift, a beat held up, a fast drop, then a
    // longer hold on the ground, instead of a symmetric up-down wobble.
    const STOMP_PERIOD = 1.9;
    const stompPhase = wrap(second, STOMP_PERIOD) / STOMP_PERIOD;
    let stomp: number;
    let justLanded = false;
    if (stompPhase < 0.45) {
      const k = stompPhase / 0.45;
      stomp = 1 - (1 - k) * (1 - k); // ease-out rise
    } else if (stompPhase < 0.55) {
      stomp = 1; // held up
    } else if (stompPhase < 0.65) {
      stomp = 1 - (stompPhase - 0.55) / 0.1; // fast drop
    } else {
      stomp = 0; // grounded hold
      justLanded = stompPhase < 0.72;
    }
    const ankleY = h - 24 - stomp * 46;
    ctx.fillStyle = shade(primary, 1.45);
    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(36, 0);
    ctx.lineTo(54, ankleY - 6);
    ctx.lineTo(10, ankleY);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(8, ankleY - 6, 58, 18);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(8, ankleY - 6, 58, 18);
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(66, ankleY - 6);
    ctx.lineTo(82, ankleY - 1);
    ctx.lineTo(66, ankleY + 2);
    ctx.moveTo(66, ankleY + 2);
    ctx.lineTo(84, ankleY + 7);
    ctx.lineTo(66, ankleY + 10);
    ctx.moveTo(66, ankleY + 10);
    ctx.lineTo(80, ankleY + 15);
    ctx.lineTo(66, ankleY + 12);
    ctx.closePath();
    ctx.fill();
    // Impact dust the moment the foot lands.
    if (justLanded) {
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(72 + i * 17, h - 18, 6 + i * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    return;
  }

  // Default set: the skyline, the windows, the patrol, the chomping.
  // The monster works its way along the city taking bites on a schedule;
  // damage persists, so the skyline is visibly worse as the beat wears on.
  const damage = kaijuCityDamage(env);
  paintSkyline(env, 0.8, damage.perBuilding);
  const sinceChomp = damage.lastChompAt < 0 ? Infinity : second - damage.lastChompAt;
  const lunge = sinceChomp < 0.9 ? 1 - sinceChomp / 0.9 : 0;
  const mx = kaijuPatrolX(w, second);
  const facing = Math.cos(second * 0.12) >= 0 ? 1 : -1;
  const rise = intensity > 0.6 ? 0.35 + progress * 0.65 : 0.35;
  drawKaijuMonster(ctx, mx, h, rise, facing, primary, accent, env.flash || lunge > 0.5, lunge);
  // Debris where the last bite landed.
  if (sinceChomp < 0.9 && damage.lastTarget >= 0) {
    const b = env.props.skyline[damage.lastTarget];
    const top = h - b.h * 0.8 * (1 - damage.perBuilding[damage.lastTarget]);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.5 * (1 - sinceChomp);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(b.x + b.w * (0.25 + i * 0.25), top - 4 - sinceChomp * 14 - i * 3, 4 + i * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

const CHOMP_FIRST_SECOND = 7;
const CHOMP_INTERVAL = 6.5;
const CHOMP_BITE = 0.28;

/** Slow patrol across the left half of the city, quick sway on top. */
function kaijuPatrolX(w: number, t: number): number {
  return w * (0.26 + 0.17 * Math.sin(t * 0.12)) + Math.sin(t * 0.6) * 10;
}

let damageScratch: number[] = [];

/**
 * Deterministic city damage: every CHOMP_INTERVAL seconds the monster bites
 * the building nearest its patrol position at that moment. Pure function of
 * the film clock, so pausing, resuming, and re-rendering all agree on how
 * much city is left.
 */
function kaijuCityDamage(env: SceneEnv): {
  perBuilding: number[];
  lastChompAt: number;
  lastTarget: number;
} {
  const { props, w, second } = env;
  if (damageScratch.length !== props.skyline.length) {
    damageScratch = new Array<number>(props.skyline.length);
  }
  damageScratch.fill(0);
  let lastChompAt = -1;
  let lastTarget = -1;
  for (let k = 0; ; k++) {
    const t = CHOMP_FIRST_SECOND + k * CHOMP_INTERVAL;
    if (t > second) break;
    const biteX = kaijuPatrolX(w, t) + 24;
    let target = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < props.skyline.length; i++) {
      const center = props.skyline[i].x + props.skyline[i].w / 2;
      const distance = Math.abs(center - biteX);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = i;
      }
    }
    damageScratch[target] = Math.min(0.7, damageScratch[target] + CHOMP_BITE);
    lastChompAt = t;
    lastTarget = target;
  }
  return { perBuilding: damageScratch, lastChompAt, lastTarget };
}

function paintSkyline(env: SceneEnv, scale: number, damage?: readonly number[]): void {
  const { ctx, h, intensity, primary, accent } = env;
  ctx.fillStyle = primary;
  for (let i = 0; i < env.props.skyline.length; i++) {
    const b = env.props.skyline[i];
    const crush = damage?.[i] ?? 0;
    const bh = b.h * scale * (1 - crush);
    ctx.fillRect(b.x, h - bh, b.w, bh);
    if (crush > 0) {
      // A chewed roofline: two ragged stubs where the floors used to be.
      ctx.fillRect(b.x + 2, h - bh - 5, b.w * 0.22, 5);
      ctx.fillRect(b.x + b.w * 0.55, h - bh - 3, b.w * 0.3, 3);
    }
  }
  ctx.fillStyle = accent;
  for (let i = 0; i < env.props.windows.length; i++) {
    const win = env.props.windows[i];
    const index = i % env.props.skyline.length;
    const b = env.props.skyline[index];
    const crush = damage?.[index] ?? 0;
    // Bitten buildings lose power; intact windows go dark as the monster
    // gets closer.
    if (crush < 0.2 && win.y > intensity * 0.8) {
      const bh = b.h * scale;
      ctx.fillRect(b.x + 4 + win.x * (b.w - 10), h - bh + 6 + win.y * (bh - 14), 3, 4);
    }
  }
}

/**
 * An actual creature: leaning tapered body, open jaw, dorsal plates, thick
 * tail, two legs with stubby arms. `rise` 0..1 scales how far it has come
 * up; `facing` 1 looks right, -1 looks left; `lunge` 0..1 dips the head
 * forward and down for the bite.
 */
function drawKaijuMonster(
  ctx: CanvasRenderingContext2D,
  x: number,
  ground: number,
  rise: number,
  facing: number,
  primary: string,
  accent: string,
  eyeLit: boolean,
  lunge = 0
): void {
  const f = facing;
  const s = 0.55 + rise * 0.65;
  const hipX = x;
  const hipY = ground - 34 * s;
  const headX = x + f * (34 + lunge * 12) * s;
  const headY = ground - (78 - lunge * 18) * s;

  // Moonlit shade of the palette primary: the creature must separate from
  // the buildings (same primary) and from the night sky at once.
  ctx.fillStyle = shade(primary, 1.45);
  // Tail: thick at the hip, curling away behind.
  ctx.beginPath();
  ctx.moveTo(hipX - f * 2, hipY - 10 * s);
  ctx.quadraticCurveTo(hipX - f * 44 * s, hipY - 4 * s, hipX - f * 62 * s, hipY - 26 * s);
  ctx.quadraticCurveTo(hipX - f * 42 * s, hipY + 8 * s, hipX - f * 2, hipY + 12 * s);
  ctx.closePath();
  ctx.fill();
  // Body: haunch up through the chest, leaning into the walk.
  ctx.beginPath();
  ctx.moveTo(hipX - f * 12 * s, ground);
  ctx.quadraticCurveTo(hipX - f * 16 * s, hipY - 26 * s, hipX + f * 10 * s, hipY - 34 * s);
  ctx.quadraticCurveTo(headX - f * 4 * s, headY + 16 * s, headX, headY + 6 * s);
  ctx.lineTo(headX + f * 4 * s, headY + 18 * s);
  ctx.quadraticCurveTo(hipX + f * 18 * s, hipY, hipX + f * 16 * s, ground);
  ctx.closePath();
  ctx.fill();
  // Head with an opinionated open jaw.
  ctx.beginPath();
  ctx.moveTo(headX - f * 6 * s, headY + 8 * s);
  ctx.lineTo(headX - f * 2 * s, headY - 8 * s);
  ctx.lineTo(headX + f * 22 * s, headY - 4 * s);
  ctx.lineTo(headX + f * 10 * s, headY + 2 * s);
  ctx.lineTo(headX + f * 20 * s, headY + 10 * s);
  ctx.lineTo(headX - f * 2 * s, headY + 14 * s);
  ctx.closePath();
  ctx.fill();
  // Dorsal plates marching down the spine.
  for (let i = 0; i < 4; i++) {
    const px = hipX + f * (2 + i * 9) * s;
    const py = hipY - (30 - i * 5) * s;
    ctx.beginPath();
    ctx.moveTo(px - 4 * s, py + 2 * s);
    ctx.lineTo(px, py - 9 * s);
    ctx.lineTo(px + 4 * s, py + 2 * s);
    ctx.closePath();
    ctx.fill();
  }
  // Legs and the famous tiny arm.
  ctx.fillRect(hipX - f * 12 * s, ground - 18 * s, 9 * s, 18 * s);
  ctx.fillRect(hipX + f * 6 * s, ground - 16 * s, 9 * s, 16 * s);
  ctx.fillRect(headX - f * 8 * s, headY + 22 * s, f * 10 * s, 4 * s);
  // The eye, always. Lit on the reveal.
  ctx.fillStyle = eyeLit ? accent : 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(headX + f * 2 * s - 2, headY - 2 * s - 2, 4, 4);
}

// ---------------------------------------------------------------------------
// Horror
// ---------------------------------------------------------------------------

function paintHorror(env: SceneEnv): void {
  const { ctx, w, h, second, progress, intensity, filmProgress, primary, accent } = env;
  ctx.fillStyle = primary;
  for (const s of env.props.stars) {
    if (s.r === 1) ctx.fillRect(s.x, s.y, 1, 1);
  }

  if (env.beatKind === 'chase') {
    // The woods do not end. Canopy overhead, trunks of every age.
    ctx.fillStyle = primary;
    ctx.fillRect(0, 0, w, 18);
    ctx.fillRect(0, h - 22, w, 22);
    for (let i = 0; i < 10; i++) {
      const x = wrap(i * 53 + (i % 3) * 17 - second * 170, w + 90) - 45;
      const trunkH = 66 + ((i * 37) % 34);
      const trunkW = 7 + ((i * 13) % 7);
      ctx.fillRect(x, h - 22 - trunkH, trunkW, trunkH);
      ctx.fillRect(x - 5, h - 30 - trunkH, trunkW + 11, 12);
    }
    const step = Math.floor(second * 9) % 2;
    const fx = w * 0.42;
    ctx.fillStyle = accent;
    ctx.fillRect(fx, h - 50, 8, 20);
    ctx.fillRect(fx - 2 + step * 5, h - 31, 4, 11);
    ctx.fillRect(fx + 6 - step * 5, h - 31, 4, 11);
    ctx.beginPath();
    ctx.arc(fx + 4, h - 55, 5, 0, Math.PI * 2);
    ctx.fill();
    // The pursuer, never fully seen: two eyes low in the trees, with a
    // faint hint of mass beneath rather than a soft glowing blob.
    const pursuerX = fx - 80;
    const pursuerY = h - 30;
    ctx.fillStyle = shade(primary, 1.3);
    ctx.globalAlpha = 0.22;
    ctx.fillRect(pursuerX - 22, pursuerY - 4, 44, 8);
    ctx.globalAlpha = 1;
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(second * 5);
    ctx.beginPath();
    ctx.arc(pursuerX - 5, pursuerY - 10, 1.5, 0, Math.PI * 2);
    ctx.arc(pursuerX + 5, pursuerY - 10, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    return;
  }

  if (env.beatKind === 'climax') {
    // Dawn against the basement door.
    const shake = intensity > 0.9 ? Math.sin(second * 22) * 1.5 : 0;
    // A real wall, floor to frame, with a baseboard.
    ctx.fillStyle = shade(primary, 0.55);
    ctx.fillRect(0, h * 0.12, w, h);
    ctx.fillStyle = shade(primary, 0.4);
    ctx.fillRect(0, h - 26, w, 26);
    ctx.fillRect(0, h * 0.12, w, 5);
    // The door, and dawn forcing its way around the frame.
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.25 + 0.55 * progress;
    ctx.fillRect(w * 0.5 - 23 + shake, h - 96, 46, 4);
    ctx.fillRect(w * 0.5 - 23 + shake, h - 96, 4, 76);
    ctx.fillRect(w * 0.5 + 19 + shake, h - 96, 4, 76);
    ctx.globalAlpha = 1;
    ctx.fillStyle = primary;
    ctx.fillRect(w * 0.5 - 19 + shake, h - 92, 38, 72);
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.5 + 9 + shake, h - 56, 3, 3);
    // The last one standing, braced beside the frame.
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.5 - 42, h - 48, 8, 22);
    ctx.beginPath();
    ctx.arc(w * 0.5 - 38, h - 53, 5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (env.beatKind === 'twist') {
    // The call is from inside: the house stays put, the phone gets the
    // insert shot. B pictures cut to the prop in an iris.
    paintHorrorHouse(env, 0.4);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = STAGE_CENTER_Y;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 52, 0, Math.PI * 2);
    ctx.stroke();
    const ring = Math.sin(second * 10) > 0.2;
    const tremble = ring ? Math.sin(second * 40) * 1.5 : 0;
    ctx.fillStyle = primary;
    ctx.fillRect(cx - 22 + tremble, cy - 4, 44, 32);
    // The rotary dial, on the body's face, so it reads as a phone and not
    // a casserole dish.
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx + tremble, cy + 14, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(cx + tremble, cy + 14, 2, 0, Math.PI * 2);
    ctx.fill();
    // The handset: a cradled bar with earpiece and mouthpiece bulbs.
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.ellipse(cx + tremble, cy - 8, 26, 8, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 26 + tremble, cy - 8, 6, 0, Math.PI * 2);
    ctx.arc(cx + 26 + tremble, cy - 8, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = primary;
    ctx.beginPath();
    ctx.moveTo(cx + 22, cy + 26);
    ctx.quadraticCurveTo(cx + 48, cy + 38, cx + 40, cy + 12);
    ctx.stroke();
    if (ring) {
      ctx.strokeStyle = accent;
      ctx.beginPath();
      ctx.arc(cx + tremble, cy + 2, 36, -2.4, -0.7);
      ctx.stroke();
    }
    return;
  }

  // Default set: the house on the hill, the visitor crossing the film.
  paintHorrorHouse(env, 1);
  const house = env.props.house;
  const hx = w * house.x;
  if (env.beatKind !== 'spike') {
    // The visitor arrives early and holds at the porch: reaching the door
    // by ~62% through the film means a single beat actually shows motion
    // instead of a few inches of lawn.
    const approach = Math.min(1, filmProgress * 1.6);
    const arrived = approach >= 1;
    const sway = arrived ? 0 : Math.sin(second * 2.2) * 2;
    const fx = w * 0.06 + approach * (hx - w * 0.12) + sway;
    const gait = arrived ? 0 : Math.abs(Math.sin(second * 4)) * 1.5;
    // Footing follows the hill slope, not the flat canvas bottom.
    const ground = hillSurfaceY(w, h, fx) + 1;
    ctx.fillStyle = accent;
    // Feet rest ON the surface (gait lifts them mid-stride); the whole
    // figure is measured up from there so nothing hovers beside the porch.
    ctx.fillRect(fx, ground - 20 - gait, 8, 20);
    ctx.beginPath();
    ctx.arc(fx + 4, ground - 25 - gait, 5, 0, Math.PI * 2);
    ctx.fill();
    // The lantern: swings with the stride, hangs steady once waiting.
    const lanternSwing = arrived ? 0 : Math.sin(second * 4) * 2.5;
    const lanternX = fx + 10 + lanternSwing;
    const lanternY = ground - 12 - gait;
    ctx.fillRect(lanternX, lanternY, 4, 5);
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(lanternX + 2, lanternY + 2.5, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (env.beatKind === 'calm' || env.beatKind === 'build') {
    // Otherwise the calm stretch is just the house sitting there: a pair of
    // bats cross the sky every ~9 seconds, same wing construction as the
    // western vulture at 60% size.
    const batWindow = wrap(second, 9);
    if (batWindow < 3.5) {
      const bx = w * (1 - batWindow / 3.5);
      ctx.strokeStyle = shade(primary, 1.5);
      ctx.lineWidth = 1;
      drawBatWings(ctx, bx, 34, Math.sin(second * 7) * 2);
      drawBatWings(ctx, bx + 30, 42, Math.sin(second * 7 + 1.1) * 2);
    }
  }
  if (env.flash) {
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.3, 0);
    ctx.lineTo(w * 0.34, h * 0.3);
    ctx.lineTo(w * 0.3, h * 0.32);
    ctx.lineTo(w * 0.36, h * 0.62);
    ctx.stroke();
  }
}

/**
 * The hill's surface y at horizontal position x: a quadratic from (0, h) to
 * (w, h) with control (w*0.5, h-28), matching the hill quadratic drawn in
 * paintHorrorHouse. Shared so the house and the visitor's footing agree on
 * where the ground actually is.
 */
function hillSurfaceY(w: number, h: number, x: number): number {
  const t = x / w;
  return h - 56 * t * (1 - t);
}

/** A distant bat: two small wing arcs, same construction as the western
 *  vulture at ~60% size. `flap` modulates the arc height ±2px. */
function drawBatWings(ctx: CanvasRenderingContext2D, x: number, y: number, flap: number): void {
  const wingH = 3 + flap;
  ctx.beginPath();
  ctx.moveTo(x - 4, y);
  ctx.quadraticCurveTo(x - 2, y - wingH, x, y);
  ctx.quadraticCurveTo(x + 2, y - wingH, x + 4, y);
  ctx.stroke();
}

/** The hill and the house, sized and placed by the film's seed. */
function paintHorrorHouse(env: SceneEnv, lightLevel: number): void {
  const { ctx, w, h, second, intensity, primary, accent } = env;
  const house = env.props.house;
  const hw = house.w;
  const hx = w * house.x;
  // Anchor the house to the hill surface at its own center instead of a
  // flat h-40: on wide in-game panels the hill's apex sits well above that,
  // leaving the house floating. Body bottom sits 3px into the hill.
  const hillCenterX = hx + hw / 2;
  const hy = hillSurfaceY(w, h, hillCenterX) - 11;
  ctx.fillStyle = primary;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.quadraticCurveTo(w * 0.5, h - 28, w, h);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(hx, hy - hw * 0.55, hw, hw * 0.55 + 14);
  ctx.beginPath();
  ctx.moveTo(hx - 8, hy - hw * 0.55);
  ctx.lineTo(hx + hw / 2, hy - hw * 0.55 - house.roof);
  ctx.lineTo(hx + hw + 8, hy - hw * 0.55);
  ctx.closePath();
  ctx.fill();
  // The chimney, leaning with the rest of the place.
  ctx.fillRect(hx + hw * 0.72, hy - hw * 0.55 - house.roof * 0.8, 9, house.roof * 0.8);
  // One window is lit. Sometimes it blinks. That is the whole movie.
  const litWindow = Math.sin(second * (1 + intensity * 6)) > -0.7;
  ctx.fillStyle = litWindow && lightLevel > 0.5 ? accent : shade(primary, 1.3);
  const winX = hx + hw * 0.62;
  const winY = hy - hw * 0.28;
  ctx.fillRect(winX, winY, 12, 14);
  if (env.beatKind === 'spike' && litWindow) {
    // The visitor is gone. The window is not empty.
    ctx.fillStyle = primary;
    ctx.beginPath();
    ctx.arc(winX + 6, winY + 11, 4.5, Math.PI, 0);
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Noir
// ---------------------------------------------------------------------------

function paintNoir(env: SceneEnv): void {
  const { ctx, w, h, second, intensity, primary, accent } = env;

  if (env.beatKind === 'chase') {
    // Headlights in the wet streets.
    ctx.fillStyle = primary;
    ctx.fillRect(0, h - 16, w, 16);
    for (let i = 0; i < 5; i++) {
      const x = wrap(i * 120 - second * 160, w + 120) - 60;
      ctx.fillRect(x, h - 66, 4, 50);
      ctx.fillRect(x - 4, h - 70, 12, 4);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.moveTo(x + 2, h - 66);
      ctx.lineTo(x - 12, h - 16);
      ctx.lineTo(x + 16, h - 16);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = primary;
    }
    const bounce = Math.sin(second * 14);
    // Wheel bottoms sit on the road surface; body rides on top of them.
    const wheelY = h - 21 + bounce;
    ctx.fillStyle = primary;
    ctx.fillRect(w * 0.4, h - 34 + bounce, 54, 13);
    ctx.fillRect(w * 0.43, h - 42 + bounce, 28, 8);
    ctx.fillStyle = 'rgba(10, 14, 24, 0.7)';
    ctx.beginPath();
    ctx.arc(w * 0.4 + 12, wheelY, 5, 0, Math.PI * 2);
    ctx.arc(w * 0.4 + 42, wheelY, 5, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (env.beatKind === 'climax') {
    // The dock at midnight.
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = primary;
    ctx.fillRect(0, h - 34, w, 5);
    // Posts spaced proportionally across the panel width, so the rail is
    // supported all the way out on wide buffers instead of going bare.
    const postCount = Math.max(6, Math.round(w / 80));
    const postPitch = w / postCount;
    for (let i = 0; i < postCount; i++) {
      ctx.fillRect(postPitch * (i + 0.5) - 2.5, h - 29, 5, 14);
    }
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < 3; i++) {
      const off = wrap(second * 9 + i * 30, 60);
      for (let xx = -off; xx < w; xx += 60) {
        ctx.fillRect(xx, h - 11 + i * 4, 26, 1);
      }
    }
    ctx.globalAlpha = 1;
    drawStandingFigure(ctx, w * 0.44, h - 34, primary);
    drawStandingFigure(ctx, w * 0.56, h - 34, primary);
    return;
  }

  if (env.beatKind === 'twist') {
    // The interrogation. One lamp, two versions of the truth.
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.moveTo(w * 0.5 - 4, 12);
    ctx.lineTo(w * 0.5 - 52, h - 18);
    ctx.lineTo(w * 0.5 + 52, h - 18);
    ctx.lineTo(w * 0.5 + 4, 12);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // The hanging lamp, swinging slightly.
    const sway = Math.sin(second * 1.3) * 3;
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, 0);
    ctx.lineTo(w * 0.5 + sway, 12);
    ctx.stroke();
    ctx.fillStyle = primary;
    ctx.fillRect(w * 0.5 - 9 + sway, 12, 18, 6);
    // Seated suspect: chair, slumped body, hatless.
    drawNoirFigure(ctx, w * 0.5 - 26, h - 18, primary, { seated: true, hat: false });
    // The detective stands across, hat on, taking his time.
    drawNoirFigure(ctx, w * 0.5 + 30, h - 18, primary, { seated: false, hat: true });
    return;
  }

  if (env.beatKind === 'build') {
    // Somebody is following the tail.
    ctx.fillStyle = primary;
    ctx.fillRect(0, h - 16, w, 16);
    // One streetlamp, one cone of light, two walkers out of step.
    const lampX = w * 0.62;
    ctx.fillRect(lampX, h - 70, 4, 54);
    ctx.fillRect(lampX - 5, h - 74, 14, 4);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    ctx.moveTo(lampX + 2, h - 70);
    ctx.lineTo(lampX - 18, h - 16);
    ctx.lineTo(lampX + 22, h - 16);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    const stride = second * 14;
    // Two walkers, out of step: their strides are offset half a cycle so
    // they never land in lockstep.
    const walkPhase = wrap(second * 2.8, 1);
    drawNoirFigure(ctx, wrap(stride * 1.04, w + 60) - 30, h - 16, primary, {
      seated: false,
      hat: false,
      walkPhase,
    });
    drawNoirFigure(ctx, wrap(stride * 1.04, w + 60) - 95, h - 16, primary, {
      seated: false,
      hat: true,
      walkPhase: wrap(walkPhase + 0.5, 1),
    });
    return;
  }

  // Default set (calm): rain on the office window, one warm lamp.
  // The lit window panel the detective stands against: the key light that
  // keeps the scene from dissolving into the dark background.
  ctx.fillStyle = primary;
  ctx.globalAlpha = 0.18;
  ctx.fillRect(w * 0.58, 14, w * 0.26, h - 44);
  ctx.globalAlpha = 1;
  ctx.fillRect(w * 0.58 - 3, 14, 3, h - 44);
  ctx.fillRect(w * 0.84, 14, 3, h - 44);
  ctx.fillRect(w * 0.58, h - 33, w * 0.26, 4);
  // Venetian blinds across the lit panel only.
  ctx.globalAlpha = 0.3;
  for (let y = 18; y < h - 36; y += 14) {
    ctx.fillRect(w * 0.58, y, w * 0.26, 5);
  }
  ctx.globalAlpha = 1;
  // The desk and its lamp, holding down the left side.
  ctx.fillRect(w * 0.16, h - 38, 78, 5);
  ctx.fillRect(w * 0.18, h - 33, 6, 24);
  ctx.fillRect(w * 0.16 + 66, h - 33, 6, 24);
  ctx.fillRect(w * 0.2, h - 54, 4, 16);
  ctx.fillRect(w * 0.2 - 8, h - 58, 22, 6);
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.moveTo(w * 0.2 - 8, h - 52);
  ctx.lineTo(w * 0.2 - 22, h - 34);
  ctx.lineTo(w * 0.2 + 28, h - 34);
  ctx.lineTo(w * 0.2 + 14, h - 52);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  drawNoirFigure(ctx, w * 0.7, h, primary, { seated: false, hat: true, tall: true });
  const ember = Math.sin(second * 2.4) > 0.4;
  if (ember) {
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.7 + 12, h - 53, 3, 3);
  }
  ctx.strokeStyle = primary;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const drop of env.props.rain) {
    const y = (second * drop.speed * (0.6 + intensity)) % (h + 20);
    ctx.moveTo(drop.x, y - 8);
    ctx.lineTo(drop.x - 2, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** A person who reads as a person: narrow body, neck gap, brimmed hat. */
function drawNoirFigure(
  ctx: CanvasRenderingContext2D,
  x: number,
  ground: number,
  color: string,
  opts: { seated: boolean; hat: boolean; tall?: boolean; walkPhase?: number }
): void {
  const bodyH = opts.seated ? 22 : opts.tall ? 44 : 34;
  ctx.fillStyle = color;
  if (opts.seated) {
    ctx.fillRect(x - 14, ground - 16, 4, 16);
    ctx.fillRect(x - 14, ground - 18, 22, 4);
  }
  if (opts.walkPhase !== undefined) {
    // Two legs stepping alternately, same idea as the horror chase runner,
    // with a ~1px body bob so the walk has weight instead of gliding.
    const legH = bodyH / 3;
    const step = Math.floor(opts.walkPhase * 2) % 2;
    const bob = Math.abs(Math.sin(opts.walkPhase * Math.PI));
    ctx.fillRect(x - 5, ground - bodyH - bob, 10, bodyH - legH);
    ctx.fillRect(x - 4 + step * 4, ground - legH - bob, 3, legH);
    ctx.fillRect(x + 1 - step * 4, ground - legH - bob, 3, legH);
    ctx.beginPath();
    ctx.arc(x, ground - bodyH - 7 - bob, 6, 0, Math.PI * 2);
    ctx.fill();
    if (opts.hat) {
      ctx.fillRect(x - 10, ground - bodyH - 13 - bob, 20, 3);
      ctx.fillRect(x - 6, ground - bodyH - 19 - bob, 12, 7);
    }
    return;
  }
  ctx.fillRect(x - 5, ground - bodyH, 10, bodyH);
  ctx.beginPath();
  ctx.arc(x, ground - bodyH - 7, 6, 0, Math.PI * 2);
  ctx.fill();
  if (opts.hat) {
    ctx.fillRect(x - 10, ground - bodyH - 13, 20, 3);
    ctx.fillRect(x - 6, ground - bodyH - 19, 12, 7);
  }
}

function drawStandingFigure(ctx: CanvasRenderingContext2D, x: number, ground: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x - 6, ground - 34, 12, 34);
  ctx.beginPath();
  ctx.arc(x, ground - 39, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 11, ground - 43, 22, 4);
}

// ---------------------------------------------------------------------------
// Western
// ---------------------------------------------------------------------------

function paintWestern(env: SceneEnv): void {
  const { ctx, w, h, second, progress, intensity, filmProgress, primary, accent } = env;
  // The whole picture is one long sunset: dusk band fading, sun sinking
  // reel by reel until the climax plays against its last sliver.
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.1 * (1 - filmProgress * 0.7);
  ctx.fillRect(0, h - 64, w, 34);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(w * 0.5, h - 30 + filmProgress * 15, 19, Math.PI, 0);
  ctx.fill();
  ctx.globalAlpha = 1;
  // The town they are too small for, behind everything.
  ctx.fillStyle = shade(primary, 0.7);
  for (const b of env.props.skyline) {
    ctx.fillRect(b.x, h - 30 - b.h * 0.26, b.w, b.h * 0.26);
  }
  ctx.fillStyle = primary;
  ctx.fillRect(0, h - 30, w, 30);

  if (env.beatKind === 'chase') {
    // The stagecoach loses a wheel (eventually).
    for (let i = 0; i < 7; i++) {
      const x = wrap(i * 80 - second * 240, w + 80) - 40;
      ctx.fillRect(x, h - 26, 18, 2);
    }
    const cx = w * 0.42;
    // The rear wheel wobbles increasingly as foreshadowing, then actually
    // comes off past 60% through the beat and rolls away on its own.
    const rearDetached = progress > 0.6;
    const detachT = rearDetached ? Math.min(1, (progress - 0.6) / 0.4) : 0;
    const jolt = rearDetached ? Math.sin(second * 16) * 2.5 : Math.sin(second * 11) * 1.5;
    const bodyY = h - 56 + jolt;
    const frontW = 26;
    ctx.fillRect(cx, bodyY, frontW, 22);
    ctx.fillRect(cx + frontW, bodyY + detachT * 4, 52 - frontW, 22);
    ctx.fillRect(cx + 8, h - 64 + jolt, 30, 8);
    drawSpokedWheel(ctx, cx + 10, h - 32 + jolt, 9, second * 6, primary);
    if (rearDetached) {
      // Rolls free of the coach, spinning faster on its own and taking a
      // couple of decaying hops as it goes.
      const rollX = cx + 42 + detachT * 70;
      const hop = Math.abs(Math.sin(second * 6)) * (1 - detachT) * 6;
      drawSpokedWheel(ctx, rollX, h - 32 + jolt - hop, 9, second * 10, primary);
    } else {
      const rearWobble = Math.sin(second * 9) * (1 + progress / 0.6);
      drawSpokedWheel(ctx, cx + 42, h - 32 + jolt + rearWobble, 9, second * 6 + 1, primary);
    }
    // Horses ahead, opinions unknown.
    for (let i = 0; i < 2; i++) {
      const hx2 = cx - 36 - i * 30;
      const gait = Math.sin(second * 12 + i * 2) * 2;
      ctx.fillRect(hx2, h - 46 + gait, 24, 10);
      ctx.fillRect(hx2 - 8, h - 52 + gait, 10, 8);
      ctx.fillRect(hx2 + 2, h - 36 + gait, 3, 8);
      ctx.fillRect(hx2 + 18, h - 36 - gait, 3, 8);
    }
    // Dust: small ground-hugging puffs that dissipate behind the coach,
    // not one smooth trailing disc.
    ctx.fillStyle = shade(primary, 0.6);
    for (let i = 0; i < 4; i++) {
      const puffX = cx + 58 + i * 16;
      const age = i / 4; // 0 near the coach, 1 furthest behind
      ctx.globalAlpha = 0.35 * (1 - age * 0.5);
      for (let j = 0; j < 3; j++) {
        const ox = (j - 1) * 4 + Math.sin(second * 3 + i * 1.7 + j) * 3;
        const oy = -Math.abs(Math.sin(second * 4 + i + j)) * 2;
        const r = 3 + ((i + j) % 3);
        ctx.beginPath();
        ctx.arc(puffX + ox, h - 27 + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    return;
  }

  // Default set: the standoff. Distance closes as intensity rises.
  for (const c of env.props.cacti) {
    ctx.fillRect(c.x, h - 30 - c.h, 6, c.h);
    // Saguaro candelabra arms: a stub out, then an upright rising from its
    // end, at different heights per side, not the flat crossbar of a grave
    // marker.
    const leftY = h - 30 - c.h * 0.55;
    const rightY = h - 30 - c.h * 0.75;
    ctx.fillRect(c.x - 7, leftY, 7, 5);
    ctx.fillRect(c.x - 7, leftY - c.h * 0.3, 5, c.h * 0.3 + 5);
    ctx.fillRect(c.x + 6, rightY, 7, 5);
    ctx.fillRect(c.x + 8, rightY - c.h * 0.25, 5, c.h * 0.25 + 5);
  }
  const gap = w * (0.34 - intensity * 0.18);
  drawGunslinger(ctx, w * 0.5 - gap, h - 30, 1);
  drawGunslinger(ctx, w * 0.5 + gap, h - 30, -1);
  const tx = wrap(second * 26, w + 40) - 20;
  ctx.strokeStyle = primary;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(tx, h - 36, 7, 0, Math.PI * 2);
  ctx.stroke();
  // Incident in the dead air: a vulture circling, and now and then a hat
  // crosses town without its owner.
  ctx.strokeStyle = shade(primary, 0.6);
  ctx.lineWidth = 1.5;
  const vx = w * 0.5 + Math.cos(second * 0.22) * w * 0.3;
  const vy = 26 + Math.sin(second * 0.44) * 9;
  ctx.beginPath();
  ctx.moveTo(vx - 7, vy);
  ctx.quadraticCurveTo(vx - 3, vy - 5, vx, vy);
  ctx.quadraticCurveTo(vx + 3, vy - 5, vx + 7, vy);
  ctx.stroke();
  if (env.beatKind === 'calm' || env.beatKind === 'build') {
    const hatT = wrap(second * 0.11, 1);
    const hatX = hatT * (w + 60) - 30;
    const hatY = h - 40 - Math.abs(Math.sin(second * 2.6)) * 9;
    ctx.fillStyle = shade(primary, 0.55);
    ctx.save();
    ctx.translate(hatX, hatY);
    ctx.rotate(second * 3);
    ctx.fillRect(-7, -1.5, 14, 3);
    ctx.fillRect(-4, -6.5, 8, 5);
    ctx.restore();
  }
}

function drawSpokedWheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  angle: number,
  color: string
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = angle + (i * Math.PI) / 3;
    ctx.moveTo(x - Math.cos(a) * r, y - Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.stroke();
}

function drawGunslinger(ctx: CanvasRenderingContext2D, x: number, ground: number, facing: number): void {
  // Narrow brim and split legs so he reads as a man, not a grave marker.
  ctx.fillRect(x - 3, ground - 26, 6, 16);
  ctx.fillRect(x - 3, ground - 10, 2.5, 10);
  ctx.fillRect(x + 0.5, ground - 10, 2.5, 10);
  ctx.beginPath();
  ctx.arc(x, ground - 30, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 6, ground - 33.5, 12, 2.5);
  ctx.fillRect(x - 3.5, ground - 38, 7, 5);
  // The hand hovering at the holster.
  ctx.fillRect(x + facing * 2, ground - 17, facing * 7, 2.5);
}

// ---------------------------------------------------------------------------
// Romance
// ---------------------------------------------------------------------------

function paintRomance(env: SceneEnv): void {
  const { ctx, w, h, second, progress, primary, accent, bg } = env;

  if (env.beatKind === 'chase') {
    // The run to the station.
    ctx.fillStyle = primary;
    ctx.fillRect(0, h - 18, w, 18);
    // The clock that is always almost too late: a real face, not a lollipop.
    ctx.fillRect(w * 0.12, h - 64, 4, 46);
    ctx.beginPath();
    ctx.arc(w * 0.12 + 2, h - 68, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(w * 0.12 + 2, h - 68, 6.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = primary;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w * 0.12 + 2, h - 68);
    ctx.lineTo(w * 0.12 + 2 + Math.cos(second) * 6, h - 68 + Math.sin(second) * 6);
    ctx.stroke();
    // The train pulls away as the beat advances.
    const trainX = w * 0.5 + progress * w * 0.45;
    ctx.fillStyle = primary;
    ctx.fillRect(trainX, h - 52, w, 34);
    ctx.fillStyle = accent;
    for (let i = 0; i < 6; i++) {
      ctx.fillRect(trainX + 10 + i * 26, h - 44, 10, 9);
    }
    // Smoke streams in from off-frame right, above the roof, drifting left
    // and rising as it thins. It ties to the same overall alpha as the
    // train departure so it never hangs over an empty platform.
    const smokeAlpha = Math.max(0, 1 - progress * 1.2);
    ctx.fillStyle = accent;
    for (let i = 0; i < 3; i++) {
      const age = wrap(second * 1.3 + i * 0.33, 1);
      const puffX = w - age * 60;
      const puffY = h - 56 - age * 18;
      ctx.globalAlpha = smokeAlpha * (1 - age) * 0.6;
      ctx.beginPath();
      ctx.arc(puffX, puffY, 5 + age * 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The runner, giving it everything.
    const step = Math.floor(second * 10) % 2;
    ctx.fillStyle = accent;
    ctx.fillRect(w * 0.32, h - 40, 6, 16);
    ctx.fillRect(w * 0.32 - 3 + step * 5, h - 24, 3, 8);
    ctx.fillRect(w * 0.32 + 6 - step * 5, h - 24, 3, 8);
    ctx.beginPath();
    ctx.arc(w * 0.32 + 3, h - 44, 4, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  // Default set: the approach spans the whole picture. They start a room
  // apart and close a little every reel; at the climax the kiss lands by
  // mid-beat and holds. The twist sends the rival in from off-frame.
  const filmCloseness = Math.min(1, env.filmProgress * 1.15);
  let gap = w * 0.2 * (1 - 0.8 * filmCloseness);
  let kissPull = 0;
  if (env.beatKind === 'climax') {
    gap = gap * Math.max(0, 1 - progress * 2);
    if (progress > 0.5) {
      // The geometry alone leaves noses a few px apart at gap 0: ease the
      // profiles the rest of the way in so the kiss actually lands and holds.
      const k = Math.min(1, (progress - 0.5) / 0.3);
      kissPull = 6 * k * k;
    }
  }
  if (env.beatKind === 'twist') {
    // The rival is a decent person, complicating things.
    gap += w * 0.06 * Math.min(1, progress * 3);
  }
  const cy = h * 0.55;
  if (env.beatKind === 'twist') {
    // The rival walks in from the edge of frame at the same baseline as
    // the leads, drawn first so the leads' overlap resolves cleanly, and
    // eases into a resting spot that stays readable between them.
    const entryT = Math.min(1, progress * 3);
    const easedEntry = entryT * entryT;
    const rivalRestX = w * 0.5 - 4;
    const rivalX = w + 30 + (rivalRestX - (w + 30)) * easedEntry;
    ctx.fillStyle = shade(primary, 0.55);
    drawProfile(ctx, rivalX, cy, -1);
  }
  ctx.fillStyle = primary;
  drawProfile(ctx, w * 0.5 - 20 - gap + kissPull, cy, 1);
  drawProfile(ctx, w * 0.5 + 20 + gap - kissPull, cy, -1);
  if (env.beatKind === 'climax' && gap <= 0.5) {
    // A small spark where they meet, pulsing softly.
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(second * 6);
    ctx.beginPath();
    ctx.arc(w * 0.5, cy - 18, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  // The moon crosses the sky over the course of the evening.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(w * (0.84 - env.filmProgress * 0.24), h * (0.18 + env.filmProgress * 0.08), 12, 0, Math.PI * 2);
  ctx.fill();
}

/** Facing profile with an actual brow, nose, lips, and chin. */
function drawProfile(ctx: CanvasRenderingContext2D, x: number, cy: number, facing: number): void {
  const f = facing;
  ctx.beginPath();
  // Crown, back of head, neck, shoulder.
  ctx.moveTo(x, cy - 36);
  ctx.quadraticCurveTo(x - f * 16, cy - 36, x - f * 18, cy - 18);
  ctx.quadraticCurveTo(x - f * 19, cy - 2, x - f * 12, cy + 8);
  ctx.lineTo(x - f * 12, cy + 18);
  ctx.quadraticCurveTo(x - f * 26, cy + 24, x - f * 28, cy + 44);
  ctx.lineTo(x + f * 6, cy + 44);
  ctx.lineTo(x + f * 6, cy + 20);
  // Chin, lips, nose tip, brow, forehead.
  ctx.quadraticCurveTo(x + f * 12, cy + 16, x + f * 11, cy + 10);
  ctx.lineTo(x + f * 13, cy + 6);
  ctx.lineTo(x + f * 10, cy + 4);
  ctx.lineTo(x + f * 15, cy - 4);
  ctx.quadraticCurveTo(x + f * 9, cy - 8, x + f * 10, cy - 14);
  ctx.quadraticCurveTo(x + f * 12, cy - 26, x, cy - 36);
  ctx.closePath();
  ctx.fill();
}

// ---------------------------------------------------------------------------
// House treatment: grain, scratch, cue dot, letterbox, audience.
// ---------------------------------------------------------------------------

function paintArtifacts(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  beat: FilmBeat,
  second: number,
  grain: number
): void {
  // Film grain: integer-hashed dot positions per 12fps grain frame.
  const frame = Math.floor(second * 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
  const dots = 16 + Math.floor(grain * 22);
  for (let i = 0; i < dots; i++) {
    const x = (i * 127 + frame * 311 + ((i * i + frame) % 13) * 41) % w;
    const y = (i * 251 + frame * 157) % h;
    ctx.fillRect(x, y, 1, 1);
  }
  // A scratch drifts through every few seconds.
  const segment = Math.floor(second / 2.5);
  if (segment % 4 === 1) {
    const sx = ((segment * 197) % w) + Math.sin(second * 9) * 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.fillRect(sx, 0, 1, h);
  }
  // Reel-change cue dot in the final beat moments.
  if (beat.kind !== 'credits') {
    const remaining = beat.startsAt + beat.duration - second;
    if (remaining < 0.7 && remaining > 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(w - 14, LETTERBOX + 8, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function paintLetterbox(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, LETTERBOX);
  ctx.fillRect(0, h - LETTERBOX, w, LETTERBOX);
}

/** The front row, from behind: heads gently shifting, in everyone's way. */
function paintAudience(ctx: CanvasRenderingContext2D, props: SceneProps, w: number, h: number, second: number): void {
  ctx.fillStyle = 'rgba(4, 4, 8, 0.92)';
  ctx.fillRect(0, h - 9, w, 9);
  ctx.beginPath();
  for (const head of props.audience) {
    const tilt = Math.sin(second * 0.4 + head.phase) * 1.5;
    ctx.moveTo(head.x + tilt - head.r, h - 9);
    ctx.arc(head.x + tilt, h - 9, head.r, Math.PI, 0, false);
  }
  ctx.fill();
}

/**
 * Academy-style countdown leader: target rings, crosshair, a sweeping
 * radius, and a big 3-2-1. Plays in the first seconds of every title card,
 * which also gives the attract loop a proper splice between features.
 */
function paintLeader(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  leaderSecond: number,
  primary: string,
  accent: string
): void {
  const cx = w / 2;
  const cy = STAGE_CENTER_Y;
  const r = h * 0.36;
  ctx.strokeStyle = primary;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.66, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 1.4, cy);
  ctx.lineTo(cx + r * 1.4, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  // The radial sweep completes one revolution per second.
  const angle = (leaderSecond % 1) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
  ctx.stroke();
  ctx.globalAlpha = 1;
  drawSevenSegmentDigit(ctx, Math.max(1, Math.ceil(LEADER_SECONDS - leaderSecond)), cx, cy, accent);
}

/** Big seven-segment digit centered at (cx, cy). Supports 1-3 (the leader). */
function drawSevenSegmentDigit(
  ctx: CanvasRenderingContext2D,
  digit: number,
  cx: number,
  cy: number,
  color: string
): void {
  // Segments: [top, topRight, bottomRight, bottom, bottomLeft, topLeft, middle]
  const SEGMENTS: Record<number, readonly boolean[]> = {
    1: [false, true, true, false, false, false, false],
    2: [true, true, false, true, true, false, true],
    3: [true, true, true, true, false, false, true],
  };
  const on = SEGMENTS[digit] ?? SEGMENTS[3];
  const sw = 18;
  const sh = 26;
  const t = 4;
  const x = cx - sw / 2;
  const y = cy - sh;
  ctx.fillStyle = color;
  if (digit === 1) {
    // A seven-segment "1" lights only the right-edge bars, which makes a
    // centered bounding box read as off-center. Draw the bar on center.
    ctx.fillRect(cx - t / 2, y, t, sh * 2);
    return;
  }
  if (on[0]) ctx.fillRect(x, y, sw, t);
  if (on[1]) ctx.fillRect(x + sw - t, y, t, sh);
  if (on[2]) ctx.fillRect(x + sw - t, y + sh, t, sh);
  if (on[3]) ctx.fillRect(x, y + sh * 2 - t, sw, t);
  if (on[4]) ctx.fillRect(x, y + sh, t, sh);
  if (on[5]) ctx.fillRect(x, y, t, sh);
  if (on[6]) ctx.fillRect(x, y + sh - t / 2, sw, t);
}

/**
 * Two premiere searchlights sweeping the sky from the bottom corners, the
 * classic opening-night beacon. High-contrast by construction: the beams
 * are accent-colored light over whatever the palette's sky is.
 */
function paintSearchlights(ctx: CanvasRenderingContext2D, w: number, h: number, second: number, color: string): void {
  ctx.fillStyle = color;
  for (let i = 0; i < 2; i++) {
    const baseX = i === 0 ? w * 0.24 : w * 0.76;
    const sweep = Math.sin(second * 0.6 + i * 1.9) * 0.5;
    const tipX = baseX + Math.sin(sweep) * h * 1.4;
    const tipY = h - 12 - Math.cos(sweep) * h * 1.4;
    ctx.globalAlpha = 0.17;
    ctx.beginPath();
    ctx.moveTo(baseX - 4, h - 10);
    ctx.lineTo(tipX - 24, tipY);
    ctx.lineTo(tipX + 24, tipY);
    ctx.lineTo(baseX + 4, h - 10);
    ctx.closePath();
    ctx.fill();
    // The projector housing at the base.
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(baseX, h - 10, 5, Math.PI, 0);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
