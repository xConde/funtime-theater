import { beatAt, generateFilm } from './film-generator';
import { FILM_GENRES } from './film.model';
import { createRng, pick } from './seeded-rng';

describe('Film generator', () => {
  const SAMPLE_SEEDS = Array.from({ length: 250 }, (_, i) => i * 7919 + 1);

  describe('determinism', () => {
    it('produces an identical film for the same seed', () => {
      expect(generateFilm(123)).toEqual(generateFilm(123));
    });

    it('produces an identical film for the same seed, runtime, and genre', () => {
      expect(generateFilm(42, 120, 'noir')).toEqual(generateFilm(42, 120, 'noir'));
    });

    it('varies titles across seeds', () => {
      const titles = new Set(SAMPLE_SEEDS.slice(0, 50).map((s) => generateFilm(s).title));
      expect(titles.size).toBeGreaterThan(20);
    });
  });

  describe('beat timeline integrity', () => {
    it('opens on a title card and closes on credits, contiguously covering the runtime', () => {
      for (const seed of SAMPLE_SEEDS) {
        const film = generateFilm(seed, 90);
        const beats = film.beats;

        expect(beats[0].kind).toBe('title-card');
        expect(beats[0].startsAt).toBe(0);
        expect(beats[beats.length - 1].kind).toBe('credits');

        let cursor = 0;
        for (const beat of beats) {
          expect(beat.startsAt).toBeCloseTo(cursor, 1);
          expect(beat.duration).toBeGreaterThan(0);
          expect(beat.intensity).toBeGreaterThanOrEqual(0);
          expect(beat.intensity).toBeLessThanOrEqual(1);
          expect(beat.label.length).toBeGreaterThan(0);
          cursor += beat.duration;
        }
        expect(cursor).toBeCloseTo(film.runtimeSeconds, 1);
      }
    });

    it('grants long runtimes an extended second act', () => {
      const short = generateFilm(7, 60, 'horror');
      const long = generateFilm(7, 120, 'horror');
      expect(long.beats.length).toBeGreaterThan(short.beats.length);
    });

    it('clamps absurdly short runtimes to the minimum', () => {
      const film = generateFilm(7, 5);
      expect(film.runtimeSeconds).toBe(30);
    });
  });

  describe('copy rules', () => {
    it('never emits em dashes, template residue, or broken interpolation', () => {
      for (const seed of SAMPLE_SEEDS) {
        const film = generateFilm(seed);
        const copy = [film.title, film.tagline, film.starring, film.directedBy, ...film.beats.map((b) => b.label)].join(
          ' | '
        );

        expect(copy).not.toMatch(/—|–/);
        expect(copy).not.toContain('{');
        expect(copy).not.toContain('}');
        expect(copy).not.toContain('undefined');
        expect(copy).not.toContain('  ');
      }
    });
  });

  describe('genre handling', () => {
    it('respects an explicit genre', () => {
      for (const genre of FILM_GENRES) {
        expect(generateFilm(99, 90, genre).genre).toBe(genre);
      }
    });

    it('selects every genre across enough seeds', () => {
      const seen = new Set(SAMPLE_SEEDS.map((s) => generateFilm(s).genre));
      expect([...seen].sort()).toEqual([...FILM_GENRES].sort());
    });

    it('keeps poster palette and motif within the genre identity', () => {
      for (const seed of SAMPLE_SEEDS.slice(0, 60)) {
        const film = generateFilm(seed);
        expect(film.poster.palette.length).toBe(3);
        expect(film.poster.grain).toBeGreaterThanOrEqual(0.2);
        expect(film.poster.grain).toBeLessThanOrEqual(0.7);
      }
    });
  });

  describe('beatAt', () => {
    const film = generateFilm(1234, 90);

    it('returns the title card at second zero', () => {
      expect(beatAt(film, 0)?.kind).toBe('title-card');
    });

    it('returns credits just before the end', () => {
      expect(beatAt(film, film.runtimeSeconds - 0.5)?.kind).toBe('credits');
    });

    it('returns null outside the runtime', () => {
      expect(beatAt(film, -1)).toBeNull();
      expect(beatAt(film, film.runtimeSeconds)).toBeNull();
    });

    it('resolves every second of the film to exactly one beat', () => {
      for (let s = 0; s < film.runtimeSeconds; s += 0.5) {
        const beat = beatAt(film, s);
        expect(beat).not.toBeNull();
        if (beat) {
          expect(s).toBeGreaterThanOrEqual(beat.startsAt - 0.05);
          expect(s).toBeLessThan(beat.startsAt + beat.duration + 0.05);
        }
      }
    });
  });

  describe('seeded rng primitives', () => {
    it('pick throws loudly on an empty bank', () => {
      const rng = createRng(1);
      expect(() => pick(rng, [])).toThrowError(/empty list/);
    });

    it('streams identically from identical seeds', () => {
      const a = createRng(555);
      const b = createRng(555);
      for (let i = 0; i < 20; i++) {
        expect(a()).toBe(b());
      }
    });
  });
});
