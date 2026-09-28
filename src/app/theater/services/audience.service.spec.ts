import { TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { applauseBonus, AudienceService, reactionForBeat, seatHash } from './audience.service';
import { APPLAUSE, AUDIENCE_MOOD } from '../theater.constants';
import { FilmShowtimeService } from '../film/film-showtime.service';
import type { BeatKind, Film, FilmBeat } from '../film/film.model';

function beat(kind: BeatKind, intensity: number): FilmBeat {
  return { kind, intensity, startsAt: 0, duration: 10, label: kind };
}

function filmWithSeed(seed: number): Film {
  return { seed } as unknown as Film;
}

describe('reactionForBeat (the audience grammar)', () => {
  it('jumps the house on a spike or a climax', () => {
    expect(reactionForBeat('spike', 0.9)).toBe('flinch');
    expect(reactionForBeat('climax', 1)).toBe('flinch');
  });

  it('leans the house in for a chase, and for a build once it has caught', () => {
    expect(reactionForBeat('chase', 0.8)).toBe('lean-in');
    expect(reactionForBeat('build', 0.5)).toBe('lean-in');
    expect(reactionForBeat('build', 0.49)).toBe('idle');
  });

  it('sets the room murmuring at a twist', () => {
    expect(reactionForBeat('twist', 0.6)).toBe('murmur');
  });

  it('gets restless in the quiet beats (where phones light up)', () => {
    expect(reactionForBeat('calm', 0.2)).toBe('restless');
    expect(reactionForBeat('title-card', 0.05)).toBe('restless');
  });

  it('settles for the credits', () => {
    expect(reactionForBeat('credits', 0.05)).toBe('settle');
  });
});

describe('seatHash', () => {
  it('is deterministic for identical inputs', () => {
    expect(seatHash(123, 'left', 2, 3, 0xabc)).toBe(seatHash(123, 'left', 2, 3, 0xabc));
  });

  it('always falls within 0..1', () => {
    for (let s = 0; s < 80; s++) {
      const v = seatHash(s * 7919, s % 2 ? 'left' : 'right', (s % 8) + 1, (s % 5) + 1, 0x1234);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('decorrelates the same seat by salt', () => {
    expect(seatHash(42, 'left', 1, 1, 0x1)).not.toBe(seatHash(42, 'left', 1, 1, 0x2));
  });

  it('distinguishes the two sides of the same seat coordinate', () => {
    expect(seatHash(42, 'left', 1, 1, 0x9)).not.toBe(seatHash(42, 'right', 1, 1, 0x9));
  });
});

describe('AudienceService', () => {
  let currentFilm: WritableSignal<Film | null>;
  let currentBeat: WritableSignal<FilmBeat | null>;
  let filmSecond: WritableSignal<number>;

  beforeEach(() => {
    currentFilm = signal<Film | null>(null);
    currentBeat = signal<FilmBeat | null>(null);
    filmSecond = signal(0);
    TestBed.configureTestingModule({
      providers: [{ provide: FilmShowtimeService, useValue: { currentFilm, currentBeat, filmSecond } }],
    });
  });

  it('idles with no film and reports no screening', () => {
    const svc = TestBed.inject(AudienceService);
    expect(svc.houseReaction()).toBe('idle');
    expect(svc.screening()).toBe(false);
    expect(svc.intensity()).toBe(0);
  });

  it('tracks the live beat as it changes', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(7));
    currentBeat.set(beat('spike', 0.9));
    expect(svc.screening()).toBe(true);
    expect(svc.houseReaction()).toBe('flinch');
    expect(svc.intensity()).toBe(0.9);

    currentBeat.set(beat('calm', 0.2));
    expect(svc.houseReaction()).toBe('restless');
  });

  it('seats a stable crowd keyed to the film seed', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(7));
    const before = svc.isOccupied('left', 1, 1);
    const phoneBefore = svc.hasPhone('right', 2, 3);
    const phaseBefore = svc.reactionPhase('left', 1, 1);

    currentFilm.set(filmWithSeed(7));
    expect(svc.isOccupied('left', 1, 1)).toBe(before);
    expect(svc.hasPhone('right', 2, 3)).toBe(phoneBefore);
    expect(svc.reactionPhase('left', 1, 1)).toBe(phaseBefore);
  });

  it('turns the house over when the seed changes (a new feature, a new crowd)', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(1));
    const crowdA = Array.from({ length: 12 }, (_, i) => svc.isOccupied('left', (i % 4) + 1, (i % 3) + 1));
    currentFilm.set(filmWithSeed(999));
    const crowdB = Array.from({ length: 12 }, (_, i) => svc.isOccupied('left', (i % 4) + 1, (i % 3) + 1));
    expect(crowdA).not.toEqual(crowdB);
  });

  it('draws a deterministic, restrained rear-view style for every seat', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(47));
    const first = svc.patronStyle('left', 2, 3);

    expect(svc.patronStyle('left', 2, 3)).toEqual(first);
    expect(first.size).toBeGreaterThanOrEqual(0.94);
    expect(first.size).toBeLessThan(1.04);
    expect(first.headWidth).toBeGreaterThanOrEqual(0.4);
    expect(first.headWidth).toBeLessThan(0.46);
    expect(['narrow', 'regular', 'broad']).toContain(first.build);
    expect(['upright', 'slouch', 'lean-left', 'lean-right']).toContain(first.posture);
  });

  it('keeps patron colors out of the gold and parchment reserved for the target chair', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(91));
    const reservedTargetColors = ['#dcc77f', '#b78932', '#ffe06b', '#f4c542'];

    for (let row = 1; row <= 8; row++) {
      for (let seat = 1; seat <= 5; seat++) {
        const style = svc.patronStyle(row % 2 === 0 ? 'left' : 'right', row, seat);
        expect(reservedTargetColors).not.toContain(style.skinColor.toLowerCase());
        expect(reservedTargetColors).not.toContain(style.coatColor.toLowerCase());
        expect(reservedTargetColors).not.toContain(style.wearColor.toLowerCase());
      }
    }
  });

  it('opens each screening at the starting mood and resets on demand', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(7));
    svc.reset();
    expect(svc.mood()).toBe(AUDIENCE_MOOD.START);
    currentBeat.set(beat('spike', 1));
    svc.registerHit();
    expect(svc.mood()).toBeGreaterThan(AUDIENCE_MOOD.START);
    svc.reset();
    expect(svc.mood()).toBe(AUDIENCE_MOOD.START);
  });

  it('warms the crowd more for a high-intensity catch than a quiet one', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(7));

    svc.reset();
    currentBeat.set(beat('calm', 0.1));
    filmSecond.set(0);
    svc.registerHit();
    const quietGain = svc.mood() - AUDIENCE_MOOD.START;

    svc.reset();
    currentBeat.set(beat('climax', 1));
    filmSecond.set(0);
    svc.registerHit();
    const loudGain = svc.mood() - AUDIENCE_MOOD.START;

    expect(loudGain).toBeGreaterThan(quietGain);
  });

  it('cools toward the baseline when catches are far apart, never below it', () => {
    const svc = TestBed.inject(AudienceService);
    currentFilm.set(filmWithSeed(7));
    svc.reset();
    currentBeat.set(beat('calm', 0.2));
    filmSecond.set(0);
    svc.registerHit();
    const warm = svc.mood();
    filmSecond.set(30); // a long stall: decay outweighs one small gain
    svc.registerHit();
    expect(svc.mood()).toBeLessThan(warm);
    expect(svc.mood()).toBeGreaterThanOrEqual(AUDIENCE_MOOD.BASELINE);
  });
});

describe('applauseBonus', () => {
  it('pays nothing for a scoreless or invalid round', () => {
    expect(applauseBonus(0, 1)).toBe(0);
    expect(applauseBonus(-100, 1)).toBe(0);
    expect(applauseBonus(NaN, 1)).toBe(0);
  });

  it('is a floored fraction of the tickets, scaled by mood', () => {
    expect(applauseBonus(1000, 1)).toBe(Math.floor(1000 * APPLAUSE.FRACTION));
    expect(applauseBonus(1000, 1)).toBeGreaterThan(applauseBonus(1000, 0.5));
  });

  it('never exceeds the hard cap, even on a huge mood-1 round', () => {
    expect(applauseBonus(10_000_000, 1)).toBe(APPLAUSE.BONUS_MAX);
  });

  it('clamps mood above 1 so it cannot amplify the bonus', () => {
    expect(applauseBonus(1000, 5)).toBe(Math.min(Math.floor(1000 * APPLAUSE.FRACTION), APPLAUSE.BONUS_MAX));
  });
});
