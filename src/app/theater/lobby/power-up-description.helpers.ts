import { PowerUpId } from '../theater.model';
import {
  effectivePowerUpLevel,
  GAME_MECHANICS,
  POWER_UP_FORMULAS,
  powerUpLevelCap,
  SPECIAL_EFFECTS,
  usherCooldownSeconds,
  usherValueFraction,
} from '../theater.constants';

export type ConcessionId = Exclude<PowerUpId, 'doublePoints' | 'slowTime' | 'multiSelect' | 'extraTime'>;

function readableNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function cappedLevel(id: ConcessionId, owned: number): number {
  return effectivePowerUpLevel(id, Math.max(0, Math.floor(owned)));
}

/**
 * Player-facing concession terms, derived from the same balance constants as
 * gameplay. Keeping this pure gives the menu a contract test instead of a
 * second, hand-maintained set of formulas.
 */
export function concessionDescription(id: ConcessionId, owned: number): string {
  const level = cappedLevel(id, owned);

  switch (id) {
    case 'ticketMultiplier': {
      const multiplier = POWER_UP_FORMULAS.TICKET_MULTIPLIER_BASE ** level;
      return `Each level multiplies every payout by ${POWER_UP_FORMULAS.TICKET_MULTIPLIER_BASE}. Current: ×${readableNumber(multiplier)}.`;
    }
    case 'magneticField':
      return level === 0
        ? 'When the target moves, the first level can pull it within 1 row of your cursor.'
        : `When the target moves, it can pull within ${level} row${level === 1 ? '' : 's'} of your cursor.`;
    case 'passiveIncome': {
      const ticketsPerSecond = Math.max(1, level) * POWER_UP_FORMULAS.PASSIVE_INCOME_PER_LEVEL;
      return level === 0
        ? `The first level adds ${ticketsPerSecond} tickets a second while a show is running.`
        : `Adds ${ticketsPerSecond} tickets a second while a show is running.`;
    }
    case 'autoClicker': {
      const displayLevel = Math.max(1, level);
      const valuePercent = readableNumber(usherValueFraction(displayLevel) * 100);
      const cooldown = usherCooldownSeconds(displayLevel);
      const prefix = level === 0 ? 'The first level catches' : 'Catches';
      return `${prefix} the target at ${valuePercent}% value when ${POWER_UP_FORMULAS.USHER_LIFELINE_THRESHOLD} seconds remain; ${cooldown}-second cooldown.`;
    }
    case 'luckyStreak': {
      const chance = Math.min(
        POWER_UP_FORMULAS.LUCKY_STREAK_BASE_CHANCE + level * POWER_UP_FORMULAS.LUCKY_STREAK_PER_LEVEL,
        POWER_UP_FORMULAS.LUCKY_STREAK_MAX_CHANCE
      );
      return `Raises the ${GAME_MECHANICS.LUCKY_STREAK_MULTIPLIER}× payout chance by ${POWER_UP_FORMULAS.LUCKY_STREAK_PER_LEVEL} points per level. Current: ${chance}%; maximum: ${POWER_UP_FORMULAS.LUCKY_STREAK_MAX_CHANCE}%.`;
    }
    case 'comboMaster': {
      const seconds = Math.max(1, Math.min(level, POWER_UP_FORMULAS.COMBO_MASTER_MAX_BONUS_SECONDS));
      return level === 0
        ? 'The first level adds 1 second after a catch in timed shows.'
        : `Adds ${seconds} second${seconds === 1 ? '' : 's'} after a catch in timed shows.`;
    }
    case 'ticketStorm': {
      const tickets = Math.max(1, level) * POWER_UP_FORMULAS.TICKET_STORM_PER_LEVEL;
      const intervalSeconds = SPECIAL_EFFECTS.TICKET_STORM_INTERVAL / 1000;
      return level === 0
        ? `The first level drops ${tickets} bonus tickets every ${intervalSeconds} seconds during a show.`
        : `Drops ${tickets} bonus tickets every ${intervalSeconds} seconds during a show.`;
    }
    case 'seatUpgrade': {
      const tickets = Math.max(1, level) * POWER_UP_FORMULAS.SEAT_UPGRADE_BONUS_PER_LEVEL;
      return level === 0
        ? `The first level adds ${tickets} tickets to every correct catch.`
        : `Adds ${tickets} tickets to every correct catch.`;
    }
    case 'criticalHit': {
      const displayLevel = Math.max(1, level);
      const chance = Math.min(
        POWER_UP_FORMULAS.CRITICAL_HIT_BASE_CHANCE + displayLevel * POWER_UP_FORMULAS.CRITICAL_HIT_PER_LEVEL,
        POWER_UP_FORMULAS.CRITICAL_HIT_MAX_CHANCE
      );
      const prefix = level === 0 ? 'The first level gives' : 'Gives';
      return `${prefix} a ${chance}% chance at a ${GAME_MECHANICS.CRITICAL_HIT_MULTIPLIER}× payout; maximum chance: ${POWER_UP_FORMULAS.CRITICAL_HIT_MAX_CHANCE}%.`;
    }
  }
}

/** Compile-time exhaustiveness and a useful test input for every concession. */
export const CONCESSION_IDS: readonly ConcessionId[] = [
  'ticketMultiplier',
  'magneticField',
  'passiveIncome',
  'autoClicker',
  'luckyStreak',
  'comboMaster',
  'ticketStorm',
  'seatUpgrade',
  'criticalHit',
];

export function concessionLevelCap(id: ConcessionId): number {
  return powerUpLevelCap(id);
}
