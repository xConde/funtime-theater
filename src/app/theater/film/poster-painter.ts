import { Film, PosterMotif } from './film.model';
import { createRng } from './seeded-rng';

/**
 * One-sheet poster painter: renders a film's PosterSpec onto a portrait
 * canvas for the lobby's Coming Soon wall. Same determinism contract as the
 * scene painter: everything derives from the film, so a poster never
 * changes between visits.
 *
 * Composition follows the spec's layout:
 *   tall  - motif emblem center, title block above, billing at the foot
 *   burst - radial rays behind the emblem, title at the top
 *   split - color field split horizontally, emblem riding the seam
 */

export const POSTER_WIDTH = 150;
export const POSTER_HEIGHT = 225;
export const POSTER_PIXEL_RATIO = 2;

export function paintPoster(ctx: CanvasRenderingContext2D, film: Film): void {
  ctx.setTransform(POSTER_PIXEL_RATIO, 0, 0, POSTER_PIXEL_RATIO, 0, 0);
  const [bg, primary, accent] = film.poster.palette;
  const w = POSTER_WIDTH;
  const h = POSTER_HEIGHT;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  if (film.poster.layout === 'split') {
    ctx.fillStyle = primary;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, h * 0.52, w, h * 0.48);
    ctx.globalAlpha = 1;
  }

  if (film.poster.layout === 'burst') {
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.55);
      ctx.lineTo(w / 2 + Math.cos(angle) * w * 1.2, h * 0.55 + Math.sin(angle) * w * 1.2);
      ctx.lineTo(w / 2 + Math.cos(angle + 0.16) * w * 1.2, h * 0.55 + Math.sin(angle + 0.16) * w * 1.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  paintMotif(ctx, film.poster.motif, w, h, primary, accent);
  paintTitleBlock(ctx, film, w, accent);
  paintBilling(ctx, film, w, h, accent);
  paintGrainAndFrame(ctx, film, w, h, accent);
}

// ---------------------------------------------------------------------------
// Motif emblems
// ---------------------------------------------------------------------------

function paintMotif(
  ctx: CanvasRenderingContext2D,
  motif: PosterMotif,
  w: number,
  h: number,
  primary: string,
  accent: string
): void {
  const cx = w / 2;
  const cy = h * 0.55;
  ctx.fillStyle = primary;
  switch (motif) {
    case 'claw': {
      // Three talons raking down.
      for (let i = 0; i < 3; i++) {
        const x = cx - 24 + i * 24;
        ctx.beginPath();
        ctx.moveTo(x - 7, cy - 38);
        ctx.quadraticCurveTo(x + 9, cy - 6, x + 1, cy + 38);
        ctx.quadraticCurveTo(x - 3, cy - 4, x - 13, cy - 32);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'staring-eye': {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 44, 26, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = primary;
      ctx.beginPath();
      ctx.arc(cx + 4, cy - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'crooked-house': {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.06);
      ctx.fillRect(-30, -10, 60, 46);
      ctx.beginPath();
      ctx.moveTo(-38, -10);
      ctx.lineTo(0, -44);
      ctx.lineTo(38, -10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(8, 4, 12, 14);
      ctx.restore();
      break;
    }
    case 'monster-skyline': {
      for (let i = 0; i < 5; i++) {
        const bw = 16 + (i % 2) * 8;
        ctx.fillRect(cx - 55 + i * 23, cy + 26 - (18 + (i % 3) * 12), bw, 18 + (i % 3) * 12);
      }
      // The neck and head rising behind the blocks.
      ctx.beginPath();
      ctx.moveTo(cx - 14, cy + 26);
      ctx.quadraticCurveTo(cx - 6, cy - 30, cx + 16, cy - 38);
      ctx.lineTo(cx + 34, cy - 30);
      ctx.lineTo(cx + 14, cy - 24);
      ctx.quadraticCurveTo(cx + 6, cy - 2, cx + 8, cy + 26);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(cx + 18, cy - 35, 4, 4);
      break;
    }
    case 'silhouette-hat': {
      // Venetian light bars behind the man who knows too much.
      ctx.globalAlpha = 0.12;
      for (let y = cy - 56; y < cy + 62; y += 14) {
        ctx.fillRect(cx - 58, y, 116, 5);
      }
      ctx.globalAlpha = 1;
      // Trench shoulders rising to a popped collar.
      ctx.beginPath();
      ctx.moveTo(cx - 46, cy + 64);
      ctx.quadraticCurveTo(cx - 40, cy + 10, cx - 16, cy + 2);
      ctx.lineTo(cx + 16, cy + 2);
      ctx.quadraticCurveTo(cx + 40, cy + 10, cx + 46, cy + 64);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - 17, cy + 2);
      ctx.lineTo(cx - 5, cy + 17);
      ctx.lineTo(cx - 26, cy + 20);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + 17, cy + 2);
      ctx.lineTo(cx + 5, cy + 17);
      ctx.lineTo(cx + 26, cy + 20);
      ctx.closePath();
      ctx.fill();
      // Head and the tilted fedora.
      ctx.beginPath();
      ctx.arc(cx, cy - 14, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(cx, cy - 26);
      ctx.rotate(-0.12);
      ctx.fillRect(-27, -3, 54, 6);
      ctx.fillRect(-15, -19, 30, 17);
      ctx.restore();
      // A few streaks of rain in the key light.
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const rx = cx - 44 + i * 28;
        ctx.moveTo(rx + 6, cy - 60 + (i % 2) * 18);
        ctx.lineTo(rx, cy - 36 + (i % 2) * 18);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'flying-saucer': {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 46, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx, cy - 10, 19, 10, 0, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy + 8);
      ctx.lineTo(cx - 30, cy + 56);
      ctx.lineTo(cx + 30, cy + 56);
      ctx.lineTo(cx + 9, cy + 8);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'ringed-planet': {
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 50, 14, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'cactus-sunset': {
      // The big low sun the whole genre rides off into.
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy + 26, 36, Math.PI, 0);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = primary;
      ctx.fillRect(cx - 58, cy + 26, 116, 5);
      // A saguaro with proper arms: trunk, then each arm runs out and up.
      ctx.fillRect(cx - 7, cy - 38, 14, 64);
      ctx.beginPath();
      ctx.arc(cx, cy - 38, 7, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx - 25, cy - 6, 18, 8);
      ctx.fillRect(cx - 25, cy - 28, 8, 26);
      ctx.beginPath();
      ctx.arc(cx - 21, cy - 28, 4, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx + 7, cy + 4, 18, 8);
      ctx.fillRect(cx + 17, cy - 16, 8, 24);
      ctx.beginPath();
      ctx.arc(cx + 21, cy - 16, 4, Math.PI, 0);
      ctx.fill();
      // A tumbleweed minding its own business.
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx + 42, cy + 20, 6, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'facing-profiles': {
      // A bold heart: the two lobes lean into each other like the kiss,
      // with the spark at the seam.
      ctx.beginPath();
      ctx.moveTo(cx, cy + 46);
      ctx.bezierCurveTo(cx - 54, cy + 6, cx - 46, cy - 38, cx - 12, cy - 31);
      ctx.bezierCurveTo(cx - 5, cy - 29, cx - 1, cy - 23, cx, cy - 17);
      ctx.bezierCurveTo(cx + 1, cy - 23, cx + 5, cy - 29, cx + 12, cy - 31);
      ctx.bezierCurveTo(cx + 46, cy - 38, cx + 54, cy + 6, cx, cy + 46);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

function paintTitleBlock(ctx: CanvasRenderingContext2D, film: Film, w: number, accent: string): void {
  ctx.fillStyle = accent;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '700 13px "Arial Black", Arial, sans-serif';
  const words = film.title.toUpperCase().split(' ');
  const maxWidth = w - 20;
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  // Posters with long titles drop to a smaller cut rather than overflowing.
  if (lines.length > 3) {
    ctx.font = '700 11px "Arial Black", Arial, sans-serif';
  }
  const y0 = 16;
  lines.forEach((entry, i) => {
    ctx.fillText(entry, w / 2, y0 + i * 15, maxWidth);
  });
}

function paintBilling(ctx: CanvasRenderingContext2D, film: Film, w: number, h: number, accent: string): void {
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.75;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'italic 8px Georgia, serif';
  ctx.fillText(`starring ${film.starring}`, w / 2, h - 22, w - 16);
  ctx.font = '8px Georgia, serif';
  ctx.fillText(`${film.year}`, w / 2, h - 11, w - 16);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

function paintGrainAndFrame(ctx: CanvasRenderingContext2D, film: Film, w: number, h: number, accent: string): void {
  const rng = createRng(film.seed ^ 0x90513);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  const dots = 30 + Math.floor(film.poster.grain * 40);
  for (let i = 0; i < dots; i++) {
    ctx.fillRect(rng() * w, rng() * h, 1, 1);
  }
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(4.5, 4.5, w - 9, h - 9);
  ctx.globalAlpha = 1;
}
