/**
 * Theater Feature Constants
 * Centralized constants for the Funtime Theater application
 *
 * Design Philosophy:
 * - All magic numbers should be defined here
 * - Constants should be grouped by feature/component
 * - Use descriptive names that explain the purpose
 * - Type constants where possible for better type safety
 */

// UI Animation Constants
export const ANIMATION_CONSTANTS = {
  DEFAULT_DURATION: 600,
  NOTIFICATION_DURATION: 4000,
  TYPING_SPEED_MIN: 80, // Slower base typing speed
  TYPING_SPEED_VARIANCE: 40, // More variance for natural feel
  SUBTITLE_WAIT_TIME: 5000, // Longer wait between subtitles
  PURCHASE_DIALOGUE_DURATION: 4000,
} as const;

// Game Balance Constants
export const GAME_BALANCE = {
  STARTING_COINS: 500,
  BASE_POWER_UP_DURATION: 10000,
  COMBO_WINDOW: 2000,
  MIN_GAME_SPEED: 1000,
  MAX_GAME_SPEED: 100,
  SPEED_INCREASE_RATE: 0.95,
} as const;

// Achievement Thresholds
export const ACHIEVEMENT_THRESHOLDS = {
  SCORE_100: 100,
  SCORE_500: 500,
  SCORE_1000: 1000,
  LEVEL_5: 5,
  LEVEL_10: 10,
  LEVEL_25: 25,
  COIN_COLLECTOR: 1000,
  POWER_USER: 50,
  GAME_MASTER: 100,
  NO_MISS: 200,
  SPEED_DEMON_COUNT: 10,
  SPEED_DEMON_TIME: 5000,
} as const;

// Power-Up Scaling (gentler curves for better progression)
export const POWER_UP_SCALING = {
  ticketMultiplier: 1.9,
  magneticField: 1.7,
  passiveIncome: 2.0,
  autoClicker: 1.5,
  luckyStreak: 1.5,
  comboMaster: 1.4,
  ticketStorm: 1.7,
  seatUpgrade: 1.5,
  criticalHit: 1.6,
  default: 1.6,
} as const;

// Initial Power-Up Costs (more accessible with 500 starting tickets)
export const INITIAL_POWER_UP_COSTS = {
  ticketMultiplier: 300,
  magneticField: 400,
  passiveIncome: 500,
  autoClicker: 350,
  luckyStreak: 250,
  comboMaster: 150,
  ticketStorm: 400,
  seatUpgrade: 200,
  criticalHit: 350,
} as const;

/**
 * Maximum purchasable level per concession. Set where the effect caps out
 * (no dead purchases past the cap) or where compounding must stay finite.
 */
export const MAX_POWER_UP_LEVELS: Record<string, number> = {
  ticketMultiplier: 8,
  magneticField: 7,
  luckyStreak: 5,
  criticalHit: 4,
  comboMaster: 4,
  autoClicker: 10,
  passiveIncome: 20,
  ticketStorm: 20,
  seatUpgrade: 10,
} as const;

/**
 * The level cap for a concession, or Infinity when cost alone gates it.
 */
export function powerUpLevelCap(powerUpId: string): number {
  return MAX_POWER_UP_LEVELS[powerUpId] ?? Number.POSITIVE_INFINITY;
}

/**
 * The level whose effect actually applies. Purchases are capped going
 * forward, but saves from before the caps can own more: their EFFECT
 * clamps here too, or the old broken economy survives the rebalance.
 */
export function effectivePowerUpLevel(powerUpId: string, owned: number): number {
  return Math.min(owned, powerUpLevelCap(powerUpId));
}

/**
 * Calculate the current cost of a power-up based on how many are owned.
 * Always derives cost from base cost + scaling — never store computed costs.
 */
export function calculatePowerUpCost(powerUpId: string, owned: number): number {
  const baseCost = INITIAL_POWER_UP_COSTS[powerUpId as keyof typeof INITIAL_POWER_UP_COSTS];
  if (baseCost === undefined) {
    return 0;
  }
  const scalingFactor = POWER_UP_SCALING[powerUpId as keyof typeof POWER_UP_SCALING] ?? POWER_UP_SCALING.default;
  let cost: number = baseCost;
  for (let i = 0; i < owned; i++) {
    cost = Math.floor(cost * scalingFactor);
  }
  return cost;
}

// Game Mode Entry Fees
export const GAME_MODE_FEES = {
  classic: 0,
  midnight: 500,
  carnival: 6000,
  finale: 60000,
} as const;

// Game Mode Level Requirements (in addition to entry fees)
export const GAME_MODE_LEVEL_REQUIREMENTS = {
  classic: 1,
  midnight: 3,
  carnival: 7,
  finale: 14,
} as const;

// Game Mode Ticket Multipliers
export const GAME_MODE_MULTIPLIERS = {
  classic: 1,
  midnight: 3,
  carnival: 8,
  finale: 20,
} as const;

/**
 * XP from a round = sqrt(tickets) * this factor * the mode's XP multiplier.
 * Square root keeps levels meaningful across the whole economy; linear XP
 * once produced level 3.9 billion in the balance sim.
 */
export const XP_FROM_TICKETS_SQRT_FACTOR = 12;

// Game Durations (in seconds)
export const GAME_DURATIONS = {
  timeAttack: 120,
  midnight: 60,
  carnival: 90,
  memory: 30,
} as const;

// Sound Volume Defaults
export const SOUND_DEFAULTS = {
  MASTER_VOLUME: 0.5,
  SFX_VOLUME: 0.6,
  MUSIC_VOLUME: 0.3,
  /**
   * Time constant for a bus gain change. Ramping rather than stepping is what
   * keeps a mute toggle or a volume change from landing as a click on whatever
   * is already sounding.
   */
  BUS_RAMP_SECONDS: 0.02,
} as const;

// Local Storage Keys
export const STORAGE_KEYS = {
  GAME_DATA: 'funtimeTheaterData',
  ACHIEVEMENTS: 'funtimeTheaterAchievements',
  SOUND_SETTINGS: 'theaterSoundSettings',
  PAUSED_GAME: 'funtimeTheaterPausedGame',
  BACKUP: 'funtimeTheaterBackup',
} as const;

// Special Effects
export const SPECIAL_EFFECTS = {
  BLACKOUT_INTERVAL: 15000,
  BLACKOUT_DURATION: 2000,
  TICKET_STORM_INTERVAL: 15000,
  PASSIVE_INCOME_INTERVAL: 1000,
  SEAT_MOVEMENT_TICK: 600,
  MIN_TICK_SPEED: 200,
} as const;

// Game Mechanics (buffed for more satisfying gameplay)
export const GAME_MECHANICS = {
  BASE_POINTS: 10,
  LUCKY_STREAK_MULTIPLIER: 8,
  CRITICAL_HIT_MULTIPLIER: 10,
  MEMORY_BASE_LENGTH: 3,
  XP_PER_LEVEL_BASE: 100,
  XP_LEVEL_EXPONENT: 1.5,
  DIFFICULTY_INCREASE_PER_LEVEL: 0.05,
  MIN_MOVEMENT_CHANCE: 0.05,
  MAX_MOVEMENT_CHANCE: 0.85,
  MAX_MULTIPLIER_FOR_MAX_CHANCE: 70,
  MAGNETIC_MOVE_CHANCE: 0.4,
  ENDLESS_BASE_SPEED: 1.5,
  MIDNIGHT_SPEED_MULTIPLIER: 2,
  CARNIVAL_SPEED_MULTIPLIER: 1.5,
  AUTO_SAVE_INTERVAL: 30000,
} as const;

// Sound Intensity Types
export const SEAT_SOUND_INTENSITY = {
  HOVER: 'hover',
  SELECT: 'select',
  SUCCESS: 'success',
} as const;

export type SeatSoundIntensity = (typeof SEAT_SOUND_INTENSITY)[keyof typeof SEAT_SOUND_INTENSITY];

// Power-Up Formula Constants
export const POWER_UP_FORMULAS = {
  // Ticket multiplier: base^owned
  TICKET_MULTIPLIER_BASE: 1.5,

  // Passive income: owned * rate per second
  PASSIVE_INCOME_PER_LEVEL: 5,

  // Ticket storm: tickets per level per interval
  TICKET_STORM_PER_LEVEL: 25,

  // Lucky streak: base% + owned * increment%, capped at max%
  LUCKY_STREAK_BASE_CHANCE: 10,
  LUCKY_STREAK_PER_LEVEL: 10,
  // A guaranteed jackpot is not a jackpot: capped below certainty.
  LUCKY_STREAK_MAX_CHANCE: 60,

  // Seat upgrade: bonus per owned level
  SEAT_UPGRADE_BONUS_PER_LEVEL: 5,

  // Critical hit: base% + owned * increment%, capped at max%
  CRITICAL_HIT_BASE_CHANCE: 15,
  CRITICAL_HIT_PER_LEVEL: 10,
  CRITICAL_HIT_MAX_CHANCE: 50,

  // Hot Streak: bonus seconds per click are capped, and the round timer
  // itself has a ceiling, so rounds always end. Uncapped, 22 levels made
  // rounds mathematically unendable (the balance sim diverged to 1.5
  // quadrillion coins in two simulated hours).
  COMBO_MASTER_MAX_BONUS_SECONDS: 4,
  MAX_ROUND_TIMER_SECONDS: 24,

  // Usher (auto-clicker)
  USHER_VALUE_PERCENTS: {
    BASE: 0.25,
    PER_LEVEL: 0.125,
    HIGH_TIER_BASE: 1.0, // level >= 7
    HIGH_TIER_PER_LEVEL: 0.083,
    MAX_VALUE: 1.25, // level >= 10
    HIGH_TIER_THRESHOLD: 7,
    MAX_TIER_THRESHOLD: 10,
  },
  USHER_COOLDOWNS: [10, 8, 6, 4, 2] as readonly number[],
  USHER_LIFELINE_THRESHOLD: 3, // seconds remaining to trigger auto-click

  // Endless mode speed scaling
  ENDLESS_SPEED_INCREMENT: 0.1,
  ENDLESS_MAX_SPEED: 3,

  // Double points: clicks remaining when activated
  DOUBLE_POINTS_CLICKS: 5,

  // Slow time: duration in ms, active power-up ticks
  SLOW_TIME_DURATION_MS: 10000,
  SLOW_TIME_TICKS: 10,

  // Multi-select: clicks remaining when activated
  MULTI_SELECT_CLICKS: 3,

  // Extra time: seconds added
  EXTRA_TIME_SECONDS: 15,
} as const;

/** Exact value paid by the Usher at a purchased level (1 = full seat value). */
export function usherValueFraction(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  const { BASE, PER_LEVEL, HIGH_TIER_BASE, HIGH_TIER_PER_LEVEL, MAX_VALUE, HIGH_TIER_THRESHOLD, MAX_TIER_THRESHOLD } =
    POWER_UP_FORMULAS.USHER_VALUE_PERCENTS;

  if (safeLevel <= 1) return BASE;
  if (safeLevel >= MAX_TIER_THRESHOLD) return MAX_VALUE;
  if (safeLevel >= HIGH_TIER_THRESHOLD) {
    return HIGH_TIER_BASE + (safeLevel - HIGH_TIER_THRESHOLD) * HIGH_TIER_PER_LEVEL;
  }
  return BASE + (safeLevel - 1) * PER_LEVEL;
}

/** Exact cooldown, in seconds, used by the Usher at a purchased level. */
export function usherCooldownSeconds(level: number): number {
  const index = Math.max(0, Math.min(Math.floor(level) - 1, POWER_UP_FORMULAS.USHER_COOLDOWNS.length - 1));
  return POWER_UP_FORMULAS.USHER_COOLDOWNS[index];
}

// Progression Milestones — ticket bonuses at key levels
export const PROGRESSION_MILESTONES = [
  { level: 5, ticketBonus: 500 },
  { level: 10, ticketBonus: 1500 },
  { level: 15, ticketBonus: 3000 },
  { level: 20, ticketBonus: 7500 },
  { level: 25, ticketBonus: 15000 },
  { level: 30, ticketBonus: 30000 },
] as const;

// Staff Animation Durations (milliseconds)
export const STAFF_ANIMATION = {
  /** Time the usher takes to dash from entry to the target row. */
  USHER_DASH_MS: 350,
  /** Time the usher spends in the catching/flashlight phase. */
  USHER_CATCH_MS: 600,
  /** Time the usher takes to return to the entry position. */
  USHER_RETURN_MS: 350,
  /** Duration of the box-office window glow pulse. */
  BOX_OFFICE_GLOW_MS: 400,
  /** Duration of the confetti-cannon firing animation. */
  CONFETTI_MS: 700,
} as const;

// Beat agitation: how the film's current beat drives the seat. The active seat
// hops more during the intense beats (spike, climax) and settles during the
// quiet ones, so the floor follows the screen. Bounded, and the movement chance
// stays under its own hard cap, so a seat is never made unhittable.
export const BEAT_AGITATION = {
  /** Movement-chance multiplier at the calmest beat (a breather). */
  MIN_FACTOR: 0.65,
  /** Extra multiplier added across 0..1 beat intensity (0.5 intensity is neutral). */
  INTENSITY_SPAN: 0.7,
} as const;

// Audience mood: a 0..1 read on how lively the house is. It rises when the
// player catches seats (more for the big beats) and cools toward a baseline
// when they stall, so it rewards sharp, sustained play without touching the
// in-round score. Tuning lives here.
export const AUDIENCE_MOOD = {
  /** Mood every screening opens on. */
  START: 0.5,
  /** Floor a cooling crowd sags toward; the room never fully dies mid-show. */
  BASELINE: 0.4,
  /** Base mood added per caught seat, before the beat-intensity weighting. */
  HIT_GAIN: 0.06,
  /** Mood lost per second since the last catch — the crowd cools when you stall. */
  DECAY_PER_SEC: 0.05,
} as const;

// Applause: the round-end payout the mood earns. It is a separate, hard-capped
// coin bonus (never folded into the score that drives high-score / XP, never a
// per-click multiplier), so it can reward a lively run without reopening the
// balance asymptote the overhaul closed.
export const APPLAUSE = {
  /** Share of the round's tickets the house can clap back, scaled by mood. */
  FRACTION: 0.4,
  /** Absolute ceiling on the bonus, regardless of mood, tickets, or mode. */
  BONUS_MAX: 3000,
} as const;

// The audience: patrons who sit in the chairs and react to the film. Occupancy,
// the phone-glow subset, and reaction stagger are all deterministic per
// screening so the same film always draws the same crowd.
export const PATRON_ANIMATION = {
  /** Fraction of seats that hold a patron each screening — a realistically
   *  partial house, with visible empty seats, not a sellout. */
  OCCUPANCY_RATE: 0.45,
  /** Fraction of the seated crowd that lights a phone during the quiet beats. */
  PHONE_FRACTION: 0.16,
  /** Idle breathing cycle for a seated patron (ms). */
  IDLE_BREATH_MS: 3400,
  /** Recoil duration when the house flinches at a scare (ms). */
  FLINCH_MS: 540,
  /** Spread of reaction onsets across the house so it reads as a wave (ms). */
  REACTION_STAGGER_MS: 460,
} as const;

// The master limiter every bus passes through on its way to the speakers.
// It sits after the music bus and the SFX bus, so any level it acts on pulls
// BOTH down together: a loud effect that reaches it ducks the film score with
// it, right at the moments meant to feel biggest. Set as a safety net against a
// pathological pile-up of voices rather than as a mix tool, so ordinary play
// never reaches it and the two buses stay independent.
export const MASTER_LIMITER = {
  THRESHOLD_DB: -6,
  KNEE_DB: 6,
  RATIO: 8,
  ATTACK_SECONDS: 0.003,
  RELEASE_SECONDS: 0.25,
} as const;

// The struck-mallet voice every theater sound is built from.
//
// A theater sound is a struck object, not a held tone, and the difference lives
// almost entirely in the envelope: a strike has an attack and then nothing but
// decay. Anything with a flat middle reads as a beep no matter which waveform
// carries it.
export const MALLET_VOICE = {
  /**
   * Partials of one strike, fundamental first. Each upper partial is quieter
   * and decays faster than the one below it, which is what separates a struck
   * instrument from a stack of tones. The twelfth sits slightly wide of a true
   * 3:1 so the strike reads as a physical object rather than as arithmetic.
   */
  PARTIALS: [
    { ratio: 1, gain: 1, decayScale: 1, waveType: 'sine' },
    { ratio: 2, gain: 0.3, decayScale: 0.45, waveType: 'sine' },
    { ratio: 3.01, gain: 0.1, decayScale: 0.22, waveType: 'triangle' },
  ],
  /** Sub-octave body partial, for voices whose pitch needs weight under it. */
  SUB_RATIO: 0.5,
  /** The body outlasts the strike that produced it, so the sub rings longest. */
  SUB_DECAY_SCALE: 1.3,
  /**
   * Where a decay ends, as a fraction of that partial's own peak. Being
   * relative is the whole point: an absolute floor is above a quiet voice's
   * level, so a quiet voice would ramp UP into it and grow louder as it ends.
   */
  ENVELOPE_FLOOR: 0.0015,
  /**
   * Final ramp from the floor to true zero. An oscillator stopped on a live
   * sample is a step discontinuity, which is heard as a click regardless of how
   * quiet the sample was.
   */
  ENVELOPE_ZERO_SECONDS: 0.006,
} as const;

// The seat grid, played as an instrument. Row selects octave, seat selects
// scale degree, side selects stereo position.
export const SEAT_SOUND = {
  /**
   * Both sides of the aisle read the same pentatonic set. A scale carrying
   * half-steps turns a fast cursor sweep along a row into a sour run, and the
   * two sides are already told apart by where they sit in the stereo field.
   */
  SCALE_SEMITONES: [0, 2, 4, 7, 9, 12],
  MIN_OCTAVE: 3,
  /** Top of the grid. Higher, and the octave partial climbs into the ear's most sensitive band. */
  MAX_OCTAVE: 5,
  /** Stereo spread of a seat. Narrow: the grid is wide and the cursor crosses it fast. */
  STEREO_SPREAD: 0.3,

  HOVER_GAIN_ACTIVE: 0.17,
  HOVER_GAIN_INACTIVE_FACTOR: 0.32,
  HOVER_SECONDS: 0.09,
  HOVER_ATTACK_SECONDS: 0.008,
  /** Fundamental only. The most repeated sound in the game stays the plainest. */
  HOVER_PARTIAL_COUNT: 1,
  /**
   * Onset spacing a hover needs to sound at full gain. Hovers arrive one per
   * seat the cursor crosses, so a sweep can fire a dozen inside a few hundred
   * milliseconds. Fading the ones that land close together turns that burst
   * into a shimmer, and it stops cursor jitter on a seat boundary from
   * re-striking one pitch at full level, which is the form of repetition that
   * tires an ear fastest.
   */
  HOVER_CROWD_SECONDS: 0.14,
  HOVER_CROWD_FLOOR: 0.3,

  SELECT_GAIN: 0.26,
  SELECT_SECONDS: 0.16,
  SELECT_ATTACK_SECONDS: 0.006,
  SELECT_PARTIAL_COUNT: 2,
  /**
   * Octaves below the seat's own note. A press and the reward it earns land
   * within a frame of each other, so they are kept apart by register instead of
   * by timing: the press is felt low, the reward is heard high.
   */
  SELECT_OCTAVE_OFFSET: -1,

  /** Root, fifth, octave: the figure a completed memory step plays. */
  SUCCESS_SEMITONES: [0, 7, 12],
  SUCCESS_GAIN: 0.26,
  SUCCESS_SECONDS: 0.16,
  SUCCESS_FINAL_SECONDS: 0.42,
  SUCCESS_GAP_SECONDS: 0.06,
  SUCCESS_ATTACK_SECONDS: 0.01,
  SUCCESS_PARTIAL_COUNT: 2,

  /**
   * Ring-time multiplier for a seat holding a treat. Expressing the difference
   * as decay rather than as an added partial keeps every seat in the grid at
   * one loudness, which matters most on hover: a level that jumps around the
   * grid is heard as a fault rather than as decoration.
   */
  TREAT_DECAY_FACTOR: 1.15,
} as const;

// The streak reward. This is the sound a player hears more than any other
// during good play, and the one that has to survive being heard hundreds of
// times in a row.
export const COMBO_SOUND = {
  /** Pentatonic degrees the streak climbs, so no rung of the ladder is a wrong note. */
  LADDER_SEMITONES: [0, 2, 4, 7, 9],
  LADDER_ROOT_OCTAVE: 4,
  /** Top rung is C6. Higher, and the octave partial enters the ear's most sensitive band. */
  LADDER_MAX_STEP: 10,
  /**
   * Peak gain, flat across the entire ladder. A streak is paid in pitch, ring
   * time and body; paying it in level as well is what turns a long streak from
   * exciting into tiring, and it is the one lever that must not move.
   */
  GAIN: 0.42,
  ATTACK_SECONDS: 0.008,
  SECONDS_MIN: 0.22,
  SECONDS_SPAN: 0.16,
  /**
   * Sub-octave gain at the top of the ladder, scaled from zero at the bottom.
   * The high rungs thin out on their own; the sub is what keeps the top of a
   * long climb warm instead of glassy.
   */
  SUB_GAIN_MAX: 0.45,
} as const;

// The jackpot layer, played only on a lucky or critical catch. Its root is
// fixed rather than following the streak, because every rung of the combo
// ladder sits inside this key: a root-fifth-octave figure is consonant with all
// of them, which makes the two sounds one chord without either needing to know
// what the other just played.
export const REWARD_SOUND = {
  ARPEGGIO_SEMITONES: [0, 7, 12],
  ROOT_OCTAVE: 5,
  ARPEGGIO_GAP_SECONDS: 0.055,
  GAIN: 0.34,
  ATTACK_SECONDS: 0.01,
  SECONDS: 0.28,
  /** Ring time of the last note, left to sound out under whatever follows it. */
  FINAL_SECONDS: 0.6,
} as const;

// A press that catches nothing. Kept low and free of upper partials so a miss
// reads as a shrug rather than as a buzzer.
export const WRONG_CLICK_SOUND = {
  START_HZ: 200,
  END_HZ: 130,
  GAIN: 0.26,
  SECONDS: 0.26,
  ATTACK_SECONDS: 0.012,
  /** Fundamental only. Upper partials on a falling voice read as a buzzer. */
  PARTIAL_COUNT: 1,
  SUB_GAIN: 0.35,
} as const;

// Short figures for the moments that are not seat presses. Every one of them
// draws from the pentatonic set the seat grid and the combo ladder share, so
// a cue firing over a streak lands in key.
export const CUE_SOUND = {
  /** A press acknowledged outside the seat grid. */
  CLICK: {
    semitones: [0],
    rootOctave: 4,
    gain: 0.16,
    seconds: 0.08,
    finalSeconds: 0.08,
    gapSeconds: 0,
    attack: 0.008,
    partialCount: 1,
  },
  /** A menu confirmation, and a concession bought. The plainest cue in the game. */
  BLIP: {
    semitones: [0],
    rootOctave: 5,
    gain: 0.18,
    seconds: 0.06,
    finalSeconds: 0.06,
    gapSeconds: 0,
    attack: 0.008,
    partialCount: 1,
  },
  /** A catch registered outside the seat grid. */
  SUCCESS: {
    semitones: [0, 7],
    rootOctave: 5,
    gain: 0.26,
    seconds: 0.14,
    finalSeconds: 0.3,
    gapSeconds: 0.06,
    attack: 0.01,
    partialCount: 2,
  },
  /** A concession activating, and a memory sequence completed. */
  POWER_UP: {
    semitones: [0, 4, 7, 12],
    rootOctave: 4,
    gain: 0.3,
    seconds: 0.16,
    finalSeconds: 0.42,
    gapSeconds: 0.07,
    attack: 0.01,
    partialCount: 3,
  },
  /** A level gained. Climbs past the octave so it outranks the concession cue. */
  LEVEL_UP: {
    semitones: [0, 7, 12, 16],
    rootOctave: 4,
    gain: 0.3,
    seconds: 0.15,
    finalSeconds: 0.5,
    gapSeconds: 0.075,
    attack: 0.01,
    partialCount: 3,
  },
  /**
   * The round ending. The only figure in the game that falls, and the only one
   * reaching outside the pentatonic set: the minor third is what makes it read
   * as a loss rather than as one more reward.
   */
  GAME_OVER: {
    semitones: [12, 7, 3, 0],
    rootOctave: 3,
    gain: 0.32,
    seconds: 0.2,
    finalSeconds: 0.7,
    gapSeconds: 0.11,
    attack: 0.014,
    partialCount: 2,
  },
} as const;

/**
 * How long the GAME_OVER figure rings ((notes - 1) * gapSeconds + finalSeconds)
 * before another sting can start on the same round without piling up on it.
 * Every new player's first scoring run can fire GameOver, the new-high-score
 * LevelUp sting, and the first_game achievement's own LevelUp sting all in the
 * same endGame() call — this staggers them onto the AudioContext timeline via
 * SoundService's existing delaySeconds mechanism instead of playing at once.
 */
export const GAME_OVER_RING_SECONDS =
  (CUE_SOUND.GAME_OVER.semitones.length - 1) * CUE_SOUND.GAME_OVER.gapSeconds + CUE_SOUND.GAME_OVER.finalSeconds;

/**
 * Extra offset on top of GAME_OVER_RING_SECONDS so a post-round achievement
 * sting doesn't land directly on top of the new-high-score sting when both
 * fire in the same endGame() call.
 */
export const POST_ROUND_ACHIEVEMENT_STING_OFFSET_SECONDS = 0.15;

// Procedural film score: a synth bed that tracks the film's current beat,
// plus short stingers on the beats that call for them. Tuning lives here so
// the score's dynamics can be adjusted without touching FilmScoreService.
export const FILM_SCORE = {
  /** Bed gain at the calmest beat, before the music bus applies user volume. */
  BED_GAIN_MIN: 0.18,
  /** Extra bed gain added across 0..1 beat intensity. */
  BED_GAIN_SPAN: 0.37,
  /** Lowpass cutoff (Hz) at the calmest beat. A closed filter reads as distant. */
  FILTER_HZ_MIN: 320,
  /** Extra cutoff (Hz) added across 0..1 beat intensity. */
  FILTER_HZ_SPAN: 2300,
  /** Tremolo rate (Hz) at the calmest beat. */
  LFO_HZ_MIN: 0.12,
  /** Extra tremolo rate (Hz) added across 0..1 beat intensity. */
  LFO_HZ_SPAN: 0.5,
  /** Tremolo depth as a fraction of bed gain. */
  LFO_DEPTH: 0.15,
  /** Seconds a beat change takes to reach its new gain/cutoff/voicing. */
  BEAT_GLIDE_SECONDS: 0.8,
  /** Seconds the color voice takes to glide to a new interval. */
  VOICE_GLIDE_SECONDS: 0.5,
  /** Seconds the bed takes to fade in on start and out on stop. */
  FADE_SECONDS: 1.2,
  /** Detune spread (cents) between bed voices, for chorus warmth. */
  DETUNE_CENTS: 5,
  /** Peak gain of a stinger voice. */
  STINGER_GAIN: 0.32,
  /** Seconds between notes of the climax arpeggio. */
  STINGER_ARP_GAP: 0.09,
  /**
   * Floor (Hz) for the spike stinger's low thump. The thump is voiced an octave
   * under the bed root, which for the kaiju key lands near 16 Hz: inaudible on
   * laptop speakers, yet it still burns headroom through the master compressor
   * and moves cones for nothing.
   */
  THUMP_MIN_HZ: 45,
  /** Root voice gain, before the bed's dynamics (bedGain) are applied. */
  VOICE_GAIN_ROOT: 0.5,
  /** Fifth voice gain. Quieter than the root so the fifth colors rather than doubles it. */
  VOICE_GAIN_FIFTH: 0.32,
  /** Color voice gain. The quietest of the three so the interval reads as a tint, not a lead. */
  VOICE_GAIN_COLOR: 0.26,
  /** Lowpass resonance. Low enough to stay a tone-shaping filter, not a whistling peak. */
  FILTER_Q: 0.7,
  /** Seconds each note of the spike stinger's falling-third pair rings for. */
  STINGER_SPIKE_SECONDS: 0.35,
  /** Seconds the spike stinger's low thump rings for — longer than the pair, so it lingers under them. */
  STINGER_THUMP_SECONDS: 0.5,
  /** Seconds the twist stinger's rising note takes to glide and settle. */
  STINGER_TWIST_SECONDS: 0.6,
  /** Seconds each note of the climax arpeggio rings for. */
  STINGER_CLIMAX_SECONDS: 0.4,
  /**
   * Fraction the bed dips to during a double-feature retune, before returning
   * to its pre-retune level. Ducking (not silencing) is what reads as a reel
   * change instead of a dropout.
   */
  RETUNE_DUCK_FACTOR: 0.35,
  /** Minimum attack time (seconds) for any stinger note, so onset is never a click. */
  STINGER_ATTACK_MIN: 0.02,
} as const;
