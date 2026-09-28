import {
  generateBeatLabel,
  generateDirectorName,
  generateStarName,
  generateTagline,
  generateTitle,
  GENRE_MOTIFS,
  POSTER_PALETTES,
} from './film-content';
import { BeatKind, Film, FILM_GENRES, FilmBeat, FilmGenre, PosterSpec } from './film.model';
import { chance, createRng, pick, pickInt, pickRange, Rng } from './seeded-rng';

// 5 seconds: long enough to read a five-word title plus billing. The first
// 3 seconds host the countdown leader, the rest the title itself.
const TITLE_CARD_SECONDS = 5;
export const LEADER_SECONDS = 3;
const CREDITS_SECONDS = 6;
const MIN_RUNTIME_SECONDS = 30;

/** Relative screen-time weight of each beat kind inside the body of the film. */
const KIND_WEIGHTS: Record<BeatKind, number> = {
  'title-card': 0,
  calm: 0.8,
  build: 0.85,
  spike: 0.45,
  chase: 0.9,
  twist: 0.7,
  climax: 1.0,
  credits: 0,
};

const KIND_INTENSITY: Record<BeatKind, readonly [number, number]> = {
  'title-card': [0.05, 0.05],
  calm: [0.1, 0.3],
  build: [0.35, 0.6],
  spike: [0.8, 1.0],
  chase: [0.7, 0.9],
  twist: [0.5, 0.75],
  climax: [0.85, 1.0],
  credits: [0.05, 0.05],
};

/**
 * Each genre tells its story in a recognizable dramatic shape. The body
 * sequence is the genre's arc between title card and credits; longer runtimes
 * earn an extra scare/chase cycle where the genre supports one.
 */
const GENRE_ARCS: Record<FilmGenre, readonly BeatKind[]> = {
  horror: ['calm', 'build', 'spike', 'calm', 'twist', 'spike', 'chase', 'climax'],
  kaiju: ['calm', 'build', 'spike', 'calm', 'chase', 'spike', 'climax'],
  noir: ['calm', 'build', 'twist', 'calm', 'chase', 'climax'],
  scifi: ['calm', 'build', 'spike', 'twist', 'chase', 'climax'],
  western: ['calm', 'build', 'calm', 'spike', 'chase', 'climax'],
  romance: ['calm', 'build', 'twist', 'chase', 'climax'],
};

/** Cycle inserted after the first spike/twist when the runtime supports it. */
const GENRE_EXTENSION: Record<FilmGenre, readonly BeatKind[]> = {
  horror: ['calm', 'build', 'spike'],
  kaiju: ['build', 'chase', 'spike'],
  noir: ['calm', 'build', 'twist'],
  scifi: ['calm', 'build', 'spike'],
  western: ['calm', 'build', 'spike'],
  romance: ['calm', 'build', 'spike'],
};

const EXTENSION_RUNTIME_THRESHOLD = 100;

export function generateFilm(seed: number, runtimeSeconds = 90, genre?: FilmGenre): Film {
  const rng = createRng(seed);
  const runtime = Math.max(MIN_RUNTIME_SECONDS, Math.round(runtimeSeconds));
  const filmGenre = genre ?? pick(rng, FILM_GENRES);

  const title = generateTitle(rng, filmGenre);
  const tagline = generateTagline(rng, filmGenre);
  const starring = generateStarName(rng);
  const directedBy = generateDirectorName(rng);
  const year = pickInt(rng, 1948, 1979);
  const beats = buildBeats(rng, filmGenre, runtime);
  const poster = buildPoster(rng, filmGenre);

  return {
    seed,
    genre: filmGenre,
    title,
    tagline,
    starring,
    directedBy,
    year,
    runtimeSeconds: runtime,
    beats,
    poster,
  };
}

function buildBeats(rng: Rng, genre: FilmGenre, runtime: number): FilmBeat[] {
  const sequence: BeatKind[] = [...GENRE_ARCS[genre]];
  if (runtime >= EXTENSION_RUNTIME_THRESHOLD) {
    // Splice the extension cycle in after the arc's midpoint so the extra
    // material lands in the second act, where B-movies pad anyway.
    const midpoint = Math.floor(sequence.length / 2);
    sequence.splice(midpoint, 0, ...GENRE_EXTENSION[genre]);
  }

  const bodySeconds = runtime - TITLE_CARD_SECONDS - CREDITS_SECONDS;

  // Jittered weights, normalized to fill the body exactly.
  const weights = sequence.map((kind) => KIND_WEIGHTS[kind] * pickRange(rng, 0.8, 1.2));
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  const beats: FilmBeat[] = [
    {
      kind: 'title-card',
      startsAt: 0,
      duration: TITLE_CARD_SECONDS,
      intensity: KIND_INTENSITY['title-card'][0],
      label: generateBeatLabel(rng, genre, 'title-card'),
    },
  ];

  let cursor = TITLE_CARD_SECONDS;
  sequence.forEach((kind, i) => {
    const isLast = i === sequence.length - 1;
    // The last body beat absorbs rounding drift so the timeline stays exact.
    const duration = isLast
      ? runtime - CREDITS_SECONDS - cursor
      : roundToTenth((weights[i] / totalWeight) * bodySeconds);
    const [minI, maxI] = KIND_INTENSITY[kind];
    beats.push({
      kind,
      startsAt: roundToTenth(cursor),
      duration: roundToTenth(duration),
      intensity: roundToTenth(pickRange(rng, minI, maxI)),
      label: generateBeatLabel(rng, genre, kind),
    });
    cursor = roundToTenth(cursor + duration);
  });

  beats.push({
    kind: 'credits',
    startsAt: roundToTenth(runtime - CREDITS_SECONDS),
    duration: CREDITS_SECONDS,
    intensity: KIND_INTENSITY.credits[0],
    label: generateBeatLabel(rng, genre, 'credits'),
  });

  return beats;
}

function buildPoster(rng: Rng, genre: FilmGenre): PosterSpec {
  return {
    palette: pick(rng, POSTER_PALETTES[genre]),
    motif: pick(rng, GENRE_MOTIFS[genre]),
    layout: chance(rng, 0.5) ? 'tall' : chance(rng, 0.5) ? 'burst' : 'split',
    grain: roundToTenth(pickRange(rng, 0.2, 0.7)),
  };
}

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** The beat whose window contains the given second of the film, or null after the end. */
export function beatAt(film: Film, second: number): FilmBeat | null {
  if (second < 0 || second >= film.runtimeSeconds) return null;
  // Beats are contiguous and ordered; the last matching start wins on boundaries.
  let current: FilmBeat | null = null;
  for (const beat of film.beats) {
    if (beat.startsAt <= second) current = beat;
    else break;
  }
  return current;
}
