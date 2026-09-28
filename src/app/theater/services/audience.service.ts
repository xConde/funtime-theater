import { computed, inject, Injectable, signal } from '@angular/core';
import { FilmShowtimeService } from '../film/film-showtime.service';
import { APPLAUSE, AUDIENCE_MOOD, PATRON_ANIMATION } from '../theater.constants';
import type { BeatKind } from '../film/film.model';

/**
 * What the whole house is doing right now, driven by the film's current beat.
 *  - idle:     watching, the slow breathing of a settled room
 *  - lean-in:  drawn forward by a chase or a building scene
 *  - flinch:   the recoil of a jump scare or the climax
 *  - restless: the quiet beats, when phones light up and people shift
 *  - murmur:   the lean-to-your-neighbor of a twist
 *  - settle:   the calm of the credits
 */
export type HouseReaction = 'idle' | 'lean-in' | 'flinch' | 'restless' | 'murmur' | 'settle';

/**
 * Map a beat to the reaction the room gives it. This is the grammar that ties
 * the audience to the film: a spike makes the house jump, the quiet makes it
 * restless, a twist sets it whispering. Intensity decides whether a build has
 * pulled the room in yet.
 */
export function reactionForBeat(kind: BeatKind, intensity: number): HouseReaction {
  switch (kind) {
    case 'spike':
    case 'climax':
      return 'flinch';
    case 'chase':
      return 'lean-in';
    case 'twist':
      return 'murmur';
    case 'build':
      return intensity >= 0.5 ? 'lean-in' : 'idle';
    case 'calm':
    case 'title-card':
      return 'restless';
    case 'credits':
      return 'settle';
    default: {
      // Exhaustiveness guard: adding a BeatKind without a reaction fails the
      // build here. At runtime an unknown kind degrades to idle breathing.
      const _never: never = kind;
      return _never;
    }
  }
}

/**
 * Stable 0..1 hash of a seat against the screening seed. The salt lets one seat
 * produce several independent-looking values (occupancy, phone, stagger) from
 * the same identity without any of them lining up.
 */
export function seatHash(
  seed: number,
  side: 'left' | 'right',
  rowIndex: number,
  seatIndex: number,
  salt: number
): number {
  let h = (seed ^ salt) >>> 0;
  h = Math.imul(h ^ rowIndex, 0x85ebca77);
  h = Math.imul(h ^ seatIndex, 0xc2b2ae3d);
  h ^= side === 'left' ? 0x165667b1 : 0x27d4eb2f;
  h = Math.imul(h ^ (h >>> 13), 0x9e3779b1);
  h = (h ^ (h >>> 16)) >>> 0;
  // Divide by 2^32 for a canonical half-open [0, 1) range.
  return h / 0x100000000;
}

const SALT_OCCUPANCY = 0x1b873593;
const SALT_PHONE = 0xcc9e2d51;
const SALT_PHASE = 0x6c078965;
const SALT_SIZE = 0x2545f491;
const SALT_HEAD = 0x94d049bb;
const SALT_SKIN = 0x7feb352d;
const SALT_COAT = 0xa24baed4;
const SALT_WEAR = 0x846ca68b;
const SALT_WEARCOLOR = 0x2c1b3d4f;
const SALT_BUILD = 0x31415927;
const SALT_POSTURE = 0x6a09e667;

/** Skin under the cool spill of the movie screen. Kept warm, muted, and distinct from the target's parchment gold. */
const SKIN_TONES = ['#6c473a', '#875b48', '#a87156', '#bd8667', '#765044'] as const;
/** Coat backs are the largest patron shapes, so they stay in the theater's navy/tobacco/olive/plum supporting range. */
const COAT_TONES = ['#273840', '#493236', '#35433c', '#3d3748', '#493a31'] as const;
/** Hair shades (back of the head): dark brown, near-black, auburn, ash brown, cool dark. */
const HAIR_TONES = ['#241c14', '#15131a', '#4a3324', '#6a5037', '#3a2630'] as const;
/**
 * Hat / cap fabric tones, muted: navy, maroon, forest, charcoal, tobacco. None
 * enter the yellow-gold range reserved for the target chair.
 */
const FABRIC_TONES = ['#304452', '#543238', '#34473e', '#3e3d49', '#594638'] as const;

/** What a patron has on their head, seen from behind. */
export type PatronWear = 'bare' | 'short' | 'long' | 'cap' | 'hat' | 'beanie';
/** Three authored shoulder silhouettes, varied separately from overall scale. */
export type PatronBuild = 'narrow' | 'regular' | 'broad';
/** A settled audience varies more by posture than by height. */
export type PatronPosture = 'upright' | 'slouch' | 'lean-left' | 'lean-right';

/**
 * Per-seat appearance so the house reads as individuals, not clones. All
 * deterministic from the screening seed, so the same film always draws the same
 * patrons, and they stay stable across re-renders.
 */
export interface PatronStyle {
  /** Overall scale 0.94..1.04 — deliberately restrained adult height variation. */
  readonly size: number;
  /** Head width as a fraction of the figure 0.4..0.46 — round vs narrow, kept close. */
  readonly headWidth: number;
  /** Skin, coat, hair, and headwear are separate print channels instead of one glossy tone bucket. */
  readonly skinColor: string;
  readonly coatColor: string;
  /** Hair/headwear seen from behind: bald, short hair, long hair, cap, hat, beanie. */
  readonly wear: PatronWear;
  /** The hair or fabric colour for that wear. */
  readonly wearColor: string;
  readonly build: PatronBuild;
  readonly posture: PatronPosture;
}

/**
 * Map a 0..1 hash to a headwear type — a grounded mix of a moviegoing crowd:
 * bare 18% / short 31% / long 16% / cap 15% / hat 10% / beanie 10%. Hair and
 * bare crowns lead; hats remain punctuation instead of becoming the house style.
 */
function pickWear(h: number): PatronWear {
  if (h < 0.18) return 'bare';
  if (h < 0.49) return 'short';
  if (h < 0.65) return 'long';
  if (h < 0.8) return 'cap';
  if (h < 0.9) return 'hat';
  return 'beanie';
}

function pickBuild(h: number): PatronBuild {
  if (h < 0.24) return 'narrow';
  if (h < 0.76) return 'regular';
  return 'broad';
}

function pickPosture(h: number): PatronPosture {
  if (h < 0.38) return 'upright';
  if (h < 0.62) return 'slouch';
  if (h < 0.81) return 'lean-left';
  return 'lean-right';
}

/** Clamp to the unit interval. */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * The applause a round earns: a share of the tickets scaled by the final mood,
 * floored and hard-capped. Pure so the balance is testable and the cap is the
 * single guarantee that applause can never reopen the asymptote — it is never
 * folded into the score and never multiplies per click.
 */
export function applauseBonus(tickets: number, mood: number): number {
  if (!Number.isFinite(tickets) || tickets <= 0) return 0;
  const raw = Math.floor(tickets * clamp01(mood) * APPLAUSE.FRACTION);
  return Math.min(raw, APPLAUSE.BONUS_MAX);
}

/**
 * The audience as agents. A single root service that reads the live film beat
 * and tells the patron layer how the room should react, and who is in it.
 *
 * It owns no DOM and no timers: the reaction is a pure projection of the
 * current beat, and the crowd is a pure function of the screening seed, so the
 * whole thing is a set of computed signals the view binds to directly.
 */
@Injectable({ providedIn: 'root' })
export class AudienceService {
  private readonly showtime = inject(FilmShowtimeService);

  /** The collective reaction, recomputed as each beat takes over. */
  readonly houseReaction = computed<HouseReaction>(() => {
    const beat = this.showtime.currentBeat();
    if (!beat) return 'idle';
    return reactionForBeat(beat.kind, beat.intensity);
  });

  /** 0..1 energy of the current beat; scales how hard the room reacts. */
  readonly intensity = computed(() => this.showtime.currentBeat()?.intensity ?? 0);

  /** True only while a film is on the screen. */
  readonly screening = computed(() => this.showtime.currentFilm() !== null);

  private lastCrowdSeed = 0;
  /**
   * Seed for the crowd: the current film's, latched so the same house persists
   * through the credits and the game-over screen after the film clears. Reading
   * currentFilm keeps it reactive; the latch is a plain field, no async effect.
   */
  private crowdSeed(): number {
    const seed = this.showtime.currentFilm()?.seed;
    if (seed != null) this.lastCrowdSeed = seed;
    return this.lastCrowdSeed;
  }

  /** Whether a patron is sitting in this seat for the current screening. */
  isOccupied(side: 'left' | 'right', rowIndex: number, seatIndex: number): boolean {
    return seatHash(this.crowdSeed(), side, rowIndex, seatIndex, SALT_OCCUPANCY) < PATRON_ANIMATION.OCCUPANCY_RATE;
  }

  /** Whether this patron is one of the few who light a phone in the quiet. */
  hasPhone(side: 'left' | 'right', rowIndex: number, seatIndex: number): boolean {
    return seatHash(this.crowdSeed(), side, rowIndex, seatIndex, SALT_PHONE) < PATRON_ANIMATION.PHONE_FRACTION;
  }

  /** 0..1 stagger phase so reactions ripple across the room instead of snapping. */
  reactionPhase(side: 'left' | 'right', rowIndex: number, seatIndex: number): number {
    return seatHash(this.crowdSeed(), side, rowIndex, seatIndex, SALT_PHASE);
  }

  /** Per-seat appearance so no two patrons are quite the same. */
  patronStyle(side: 'left' | 'right', rowIndex: number, seatIndex: number): PatronStyle {
    const seed = this.crowdSeed();
    // Keep adult height and head width close. The crowd's authored variety comes
    // from shoulder build, posture, coat, and hair rather than giant/small scale.
    const size = 0.94 + seatHash(seed, side, rowIndex, seatIndex, SALT_SIZE) * 0.1;
    const headWidth = 0.4 + seatHash(seed, side, rowIndex, seatIndex, SALT_HEAD) * 0.06;
    const skinIndex = Math.floor(seatHash(seed, side, rowIndex, seatIndex, SALT_SKIN) * SKIN_TONES.length);
    const coatIndex = Math.floor(seatHash(seed, side, rowIndex, seatIndex, SALT_COAT) * COAT_TONES.length);
    const wear = pickWear(seatHash(seed, side, rowIndex, seatIndex, SALT_WEAR));
    const palette = wear === 'short' || wear === 'long' ? HAIR_TONES : FABRIC_TONES;
    const colorIndex = Math.floor(seatHash(seed, side, rowIndex, seatIndex, SALT_WEARCOLOR) * palette.length);
    return {
      size,
      headWidth,
      skinColor: SKIN_TONES[skinIndex],
      coatColor: COAT_TONES[coatIndex],
      wear,
      wearColor: palette[colorIndex],
      build: pickBuild(seatHash(seed, side, rowIndex, seatIndex, SALT_BUILD)),
      posture: pickPosture(seatHash(seed, side, rowIndex, seatIndex, SALT_POSTURE)),
    };
  }

  // --- Mood: how lively the house is, 0..1. Drives the round-end applause. ---
  private readonly _mood = signal<number>(AUDIENCE_MOOD.START);
  private lastHitSecond = 0;

  /** How warm the crowd is right now (0..1), for the HUD meter and the payout. */
  readonly mood = this._mood.asReadonly();

  /** Open a fresh screening's house at the starting mood. Call at round start. */
  reset(): void {
    this._mood.set(AUDIENCE_MOOD.START);
    this.lastHitSecond = 0;
  }

  /**
   * Register a caught seat. The crowd cools by however long it has been since
   * the last catch (floored at the baseline, so it sags but never dies), then
   * warms by a gain that is larger for the high-intensity beats — catching the
   * scares and the climax pleases the house more than the quiet stretches.
   */
  registerHit(): void {
    const second = this.showtime.filmSecond();
    const intensity = this.showtime.currentBeat()?.intensity ?? 0;
    // A double feature resets filmSecond to 0; a backwards jump means a new
    // feature started, so cool from its start rather than skipping the decay.
    const elapsed = second >= this.lastHitSecond ? second - this.lastHitSecond : second;
    const cooled = Math.max(AUDIENCE_MOOD.BASELINE, this._mood() - elapsed * AUDIENCE_MOOD.DECAY_PER_SEC);
    const gain = AUDIENCE_MOOD.HIT_GAIN * (0.6 + 0.8 * intensity);
    this._mood.set(clamp01(cooled + gain));
    this.lastHitSecond = second;
  }
}
