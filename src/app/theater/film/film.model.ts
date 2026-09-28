/**
 * Film engine data model.
 *
 * A Film is pure data generated from a seed. Nothing here renders or plays
 * anything; the beat timeline is the contract the rest of the game consumes:
 *   - the screen animates whatever beat is current,
 *   - the score follows beat intensity and fires stingers on spikes,
 *   - the audience simulation schedules disruptions against beats,
 *   - the morning review quotes beat labels that the player lived through.
 */

export const FILM_GENRES = ['horror', 'kaiju', 'noir', 'scifi', 'western', 'romance'] as const;
export type FilmGenre = (typeof FILM_GENRES)[number];

export const BEAT_KINDS = ['title-card', 'calm', 'build', 'spike', 'chase', 'twist', 'climax', 'credits'] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];

export interface FilmBeat {
  readonly kind: BeatKind;
  /** Seconds from the start of the film. Beats are contiguous and ordered. */
  readonly startsAt: number;
  /** Seconds. */
  readonly duration: number;
  /** 0..1. Drives score energy, screen activity, and audience event pressure. */
  readonly intensity: number;
  /** Short in-fiction description of what is on screen ("the music stops"). */
  readonly label: string;
}

export const POSTER_MOTIFS = [
  'claw',
  'staring-eye',
  'crooked-house',
  'monster-skyline',
  'silhouette-hat',
  'flying-saucer',
  'ringed-planet',
  'cactus-sunset',
  'facing-profiles',
] as const;
export type PosterMotif = (typeof POSTER_MOTIFS)[number];

export interface PosterSpec {
  /** [background, primary, accent] hex colors. */
  readonly palette: readonly [string, string, string];
  readonly motif: PosterMotif;
  readonly layout: 'tall' | 'burst' | 'split';
  /** 0..1 film-grain amount for the renderer. */
  readonly grain: number;
}

export interface Film {
  readonly seed: number;
  readonly genre: FilmGenre;
  readonly title: string;
  readonly tagline: string;
  readonly starring: string;
  readonly directedBy: string;
  /** In-fiction release year, B-movie golden age. */
  readonly year: number;
  readonly runtimeSeconds: number;
  /** Contiguous, ordered, covers [0, runtimeSeconds]. First beat is the title card, last is credits. */
  readonly beats: readonly FilmBeat[];
  readonly poster: PosterSpec;
}
