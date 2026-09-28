import { generateFilm } from './film-generator';
import { Film } from './film.model';

/**
 * The published catalog: hand-picked seeds whose generated films earned a
 * marquee spot. A seed IS the film (the generator is deterministic), so this
 * list is the studio's back catalog; the snapshot spec locks every title so
 * a content-bank edit can never silently recast a published picture.
 *
 * Current slate (titles locked in featured-films.spec.ts):
 *   seed 53  horror   "Whatever You Do, Avoid the Balcony" (1978)
 *   seed 7   horror   "The Hungry House" (1971)
 *   seed 15  kaiju    "Attack of the Regrettably Large Houseplant" (1959)
 *   seed 27  noir     "The Long Refund" (1964)
 *   seed 1   scifi    "Planet of the Lizard Accountants" (1979)
 *   seed 57  western  "A Fistful of Popcorn" (1962)
 *   seed 44  romance  "Love in the Time of Previews" (1972)
 */
export const FEATURED_FILM_SEEDS: readonly number[] = [53, 7, 15, 27, 1, 57, 44];

/** All featured films use the standard 90 second house runtime. */
export const FEATURED_RUNTIME_SECONDS = 90;

export function featuredFilms(): Film[] {
  return FEATURED_FILM_SEEDS.map((seed) => generateFilm(seed, FEATURED_RUNTIME_SECONDS));
}

/** Tonight's premiere rotates daily through the catalog. */
export function tonightsPremiereIndex(date: Date): number {
  const startOfYear = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000);
  return dayOfYear % FEATURED_FILM_SEEDS.length;
}

let sessionProgram: Film[] | null = null;

/**
 * The evening's program: tonight's premiere leads, and the rest of the bill
 * is shuffled once per visit so the marquee loop and the Coming Soon wall
 * never run in the same canned order twice. The marquee and the wall must
 * both read this so they agree on what plays next.
 */
export function lobbyProgram(): readonly Film[] {
  if (!sessionProgram) {
    const films = featuredFilms();
    const premiereIndex = tonightsPremiereIndex(new Date());
    const rest = films.filter((_, i) => i !== premiereIndex);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    sessionProgram = [films[premiereIndex], ...rest];
  }
  return sessionProgram;
}
