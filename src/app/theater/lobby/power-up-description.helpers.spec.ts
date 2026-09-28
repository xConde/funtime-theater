import { GAME_MECHANICS, POWER_UP_FORMULAS, SPECIAL_EFFECTS } from '../theater.constants';
import { CONCESSION_IDS, concessionDescription, concessionLevelCap } from './power-up-description.helpers';

describe('concessionDescription', () => {
  it('covers every permanent concession at level zero, one, and its cap', () => {
    for (const id of CONCESSION_IDS) {
      expect(concessionDescription(id, 0)).withContext(`${id} level 0`).toBeTruthy();
      expect(concessionDescription(id, 1)).withContext(`${id} level 1`).toBeTruthy();
      expect(concessionDescription(id, concessionLevelCap(id)))
        .withContext(`${id} cap`)
        .toBeTruthy();
    }
  });

  it('uses the gameplay multiplier and jackpot constants', () => {
    expect(concessionDescription('ticketMultiplier', 1)).toContain(`×${POWER_UP_FORMULAS.TICKET_MULTIPLIER_BASE}`);
    expect(concessionDescription('luckyStreak', concessionLevelCap('luckyStreak'))).toContain(
      `${GAME_MECHANICS.LUCKY_STREAK_MULTIPLIER}×`
    );
    expect(concessionDescription('luckyStreak', concessionLevelCap('luckyStreak'))).toContain(
      `Current: ${POWER_UP_FORMULAS.LUCKY_STREAK_MAX_CHANCE}%`
    );
    expect(concessionDescription('criticalHit', concessionLevelCap('criticalHit'))).toContain(
      `${GAME_MECHANICS.CRITICAL_HIT_MULTIPLIER}×`
    );
    expect(concessionDescription('criticalHit', concessionLevelCap('criticalHit'))).toContain(
      `${POWER_UP_FORMULAS.CRITICAL_HIT_MAX_CHANCE}%`
    );
  });

  it('matches the exact first-level and capped Usher runtime', () => {
    expect(concessionDescription('autoClicker', 1)).toContain('25% value');
    expect(concessionDescription('autoClicker', 1)).toContain(
      `when ${POWER_UP_FORMULAS.USHER_LIFELINE_THRESHOLD} seconds remain`
    );
    expect(concessionDescription('autoClicker', 1)).toContain('10-second cooldown');
    expect(concessionDescription('autoClicker', concessionLevelCap('autoClicker'))).toContain('125% value');
    expect(concessionDescription('autoClicker', concessionLevelCap('autoClicker'))).toContain('2-second cooldown');
  });

  it('uses the configured Ticket Storm interval and payout', () => {
    const description = concessionDescription('ticketStorm', 1);

    expect(description).toContain(`${POWER_UP_FORMULAS.TICKET_STORM_PER_LEVEL} bonus tickets`);
    expect(description).toContain(`every ${SPECIAL_EFFECTS.TICKET_STORM_INTERVAL / 1000} seconds`);
  });

  it('reports current rather than next-level seat, spotlight, and timer effects', () => {
    expect(concessionDescription('magneticField', 1)).toContain('within 1 row');
    expect(concessionDescription('seatUpgrade', 1)).toContain('Adds 5 tickets');
    expect(concessionDescription('comboMaster', concessionLevelCap('comboMaster'))).toContain('Adds 4 seconds');
  });
});
