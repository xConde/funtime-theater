import { Injectable, signal } from '@angular/core';
import { Seat, SeatPosition, TheaterService } from '../theater.service';
import { SoundService, SoundType } from '../sound.service';
import { StorageService } from './storage.service';
import { ConcessionCacheService } from './concession-cache.service';
import { PowerUpEventsService } from './power-up-events.service';
import { ScoringService } from './scoring.service';
import { SeatMovementService } from './seat-movement.service';
import { GameStateMachineService } from './game-state-machine.service';
import { GameMode, GameState } from '../game.service';
import { DisposableTimer } from '../utils/disposable-timer';
import { POWER_UP_FORMULAS, SPECIAL_EFFECTS, usherCooldownSeconds, usherValueFraction } from '../theater.constants';

/**
 * Manages all power-up lifecycle concerns:
 * - Activation / deactivation of consumable power-ups
 * - Permanent (concession-based) power-up updates
 * - Passive income, auto-clicker (usher), and ticket storm intervals
 * - Usher cooldown tracking
 *
 * Extracted from GameService to follow Single Responsibility Principle.
 */
@Injectable({
  providedIn: 'root',
})
export class PowerUpLifecycleService {
  private static readonly PERMANENT_POWER_UP_IDS = [
    'ticketMultiplier',
    'passiveIncome',
    'autoClicker',
    'magneticField',
    'luckyStreak',
    'ticketStorm',
    'seatUpgrade',
    'criticalHit',
    'comboMaster',
  ];

  private static readonly TEMPORARY_POWER_UP_IDS = ['doublePoints', 'slowTime', 'multiSelect', 'extraTime'];

  // --- State ---
  private activePowerUps: Map<string, number> = new Map();
  readonly activePowerUpsSignal = signal<Map<string, number>>(new Map());

  private doublePointsActive = false;
  private slowTimeActive = false;

  private usherCooldownRemaining = 0;
  readonly usherCooldown = signal(0);
  readonly usherReady = signal(true);

  private currentGameMode: GameMode = GameMode.Classic;

  /**
   * Callbacks provided by GameService for timer state access.
   * ExtraTime needs to read and increment the game timer.
   */
  private getTimerValue: (() => number) | null = null;
  private setTimerValue: ((value: number) => void) | null = null;
  private addRemainingTime: ((delta: number) => void) | null = null;

  private timers = new DisposableTimer();

  constructor(
    private concessionCache: ConcessionCacheService,
    private storageService: StorageService,
    private scoringService: ScoringService,
    private soundService: SoundService,
    private theaterService: TheaterService,
    private powerUpEventsService: PowerUpEventsService,
    private seatMovementService: SeatMovementService,
    private stateMachine: GameStateMachineService
  ) {}

  // ---------------------------------------------------------------------------
  // Callback registration (called once from GameService constructor)
  // ---------------------------------------------------------------------------

  setTimerCallbacks(
    getTimer: () => number,
    setTimer: (v: number) => void,
    addRemaining: (delta: number) => void
  ): void {
    this.getTimerValue = getTimer;
    this.setTimerValue = setTimer;
    this.addRemainingTime = addRemaining;
  }

  setCurrentGameMode(mode: GameMode): void {
    this.currentGameMode = mode;
  }

  // ---------------------------------------------------------------------------
  // Public read helpers (used by GameService for scoring calculations)
  // ---------------------------------------------------------------------------

  getConcessionsOwned(concessionId: string): number {
    return this.concessionCache.getOwned(concessionId);
  }

  isDoublePointsActive(): boolean {
    return this.doublePointsActive;
  }

  isSlowTimeActive(): boolean {
    return this.slowTimeActive;
  }

  getActivePowerUps(): Map<string, number> {
    return new Map(this.activePowerUps);
  }

  // ---------------------------------------------------------------------------
  // Activation
  // ---------------------------------------------------------------------------

  activatePowerUp(powerUpId: string): void {
    const powerUpCount = this.concessionCache.getCount(powerUpId);
    if (powerUpCount <= 0) return;

    // Consume from storage FIRST — if save fails, don't apply the effect
    if (!this.usePowerUp(powerUpId)) {
      return;
    }

    this.soundService.play(SoundType.PowerUp);

    switch (powerUpId) {
      case 'doublePoints':
        this.doublePointsActive = true;
        this.activePowerUps.set('doublePoints', POWER_UP_FORMULAS.DOUBLE_POINTS_CLICKS);
        this.activePowerUpsSignal.set(new Map(this.activePowerUps));
        break;

      case 'slowTime':
        this.slowTimeActive = true;
        this.seatMovementService.setSlowTimeActive(true);
        this.activePowerUps.set('slowTime', POWER_UP_FORMULAS.SLOW_TIME_TICKS);
        this.activePowerUpsSignal.set(new Map(this.activePowerUps));
        this.timers.setTimeout(
          'slowTimeDeactivation',
          () => {
            this.slowTimeActive = false;
            this.seatMovementService.setSlowTimeActive(false);
            this.activePowerUps.delete('slowTime');
            this.activePowerUpsSignal.set(new Map(this.activePowerUps));
          },
          POWER_UP_FORMULAS.SLOW_TIME_DURATION_MS
        );
        break;

      case 'multiSelect':
        this.activePowerUps.set('multiSelect', POWER_UP_FORMULAS.MULTI_SELECT_CLICKS);
        this.activePowerUpsSignal.set(new Map(this.activePowerUps));
        break;

      case 'extraTime':
        if (
          this.currentGameMode !== GameMode.Endless &&
          this.getTimerValue &&
          this.setTimerValue &&
          this.addRemainingTime
        ) {
          const currentTime = this.getTimerValue();
          this.setTimerValue(currentTime + POWER_UP_FORMULAS.EXTRA_TIME_SECONDS);
          this.addRemainingTime(POWER_UP_FORMULAS.EXTRA_TIME_SECONDS);
        }
        break;
    }
  }

  decrementPowerUp(powerUpId: string): void {
    const count = this.activePowerUps.get(powerUpId) ?? 0;
    if (count > 1) {
      this.activePowerUps.set(powerUpId, count - 1);
    } else {
      this.activePowerUps.delete(powerUpId);
      if (powerUpId === 'doublePoints') this.doublePointsActive = false;
    }
    this.activePowerUpsSignal.set(new Map(this.activePowerUps));
  }

  // ---------------------------------------------------------------------------
  // Permanent power-up sync (data-driven)
  // ---------------------------------------------------------------------------

  updatePermanentPowerUps(): void {
    // Preserve temporary power-ups
    const tempPowerUps = new Map<string, number>();
    for (const [key, value] of this.activePowerUps) {
      if (PowerUpLifecycleService.TEMPORARY_POWER_UP_IDS.includes(key)) {
        tempPowerUps.set(key, value);
      }
    }
    this.activePowerUps = tempPowerUps;

    for (const id of PowerUpLifecycleService.PERMANENT_POWER_UP_IDS) {
      const owned = this.concessionCache.getOwned(id);
      if (owned > 0) {
        this.activePowerUps.set(id, owned);
      }
    }
    this.activePowerUpsSignal.set(new Map(this.activePowerUps));
  }

  // ---------------------------------------------------------------------------
  // Intervals
  // ---------------------------------------------------------------------------

  startPassiveIncome(): void {
    this.timers.clearInterval('passiveIncome');

    const owned = this.concessionCache.getOwned('passiveIncome');
    if (owned > 0) {
      const income = owned * POWER_UP_FORMULAS.PASSIVE_INCOME_PER_LEVEL;
      this.timers.setInterval(
        'passiveIncome',
        () => {
          if (this.stateMachine.state() === GameState.Playing) {
            this.scoringService.addScore(income);
            this.powerUpEventsService.triggerPassiveIncomeTick(income);
          }
        },
        1000
      );
    }
  }

  startAutoClicker(): void {
    this.timers.clearInterval('autoClicker');

    const owned = this.concessionCache.getOwned('autoClicker');
    if (owned > 0) {
      this.timers.setInterval(
        'autoClicker',
        () => {
          if (this.stateMachine.state() === GameState.Playing && this.usherCooldownRemaining === 0) {
            const activeSeat = this.theaterService.getActiveSeat();
            const remainingTime = this.getTimerValue ? this.getTimerValue() : 0;

            // Usher acts as lifeline when 3 seconds or less remaining on game timer
            if (activeSeat && remainingTime > 0 && remainingTime <= POWER_UP_FORMULAS.USHER_LIFELINE_THRESHOLD) {
              const seatData = this.getSeatData(activeSeat);
              if (seatData) {
                const valuePercent = this.getUsherValuePercent(owned);
                this.processUsherClick(seatData, valuePercent);
                this.startUsherCooldown(owned);
              }
            }
          }
        },
        100
      );
    }
  }

  startTicketStorm(): void {
    this.timers.clearInterval('ticketStorm');

    const owned = this.concessionCache.getOwned('ticketStorm');
    if (owned > 0) {
      const stormTickets = POWER_UP_FORMULAS.TICKET_STORM_PER_LEVEL * owned;

      this.timers.setInterval(
        'ticketStorm',
        () => {
          if (this.stateMachine.state() === GameState.Playing) {
            this.scoringService.addScore(stormTickets);
            this.soundService.playPreset('pickupCoin');
            this.powerUpEventsService.triggerTicketStormFire(stormTickets);
          }
        },
        SPECIAL_EFFECTS.TICKET_STORM_INTERVAL
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Usher helpers
  // ---------------------------------------------------------------------------

  getUsherValuePercent(level: number): number {
    return usherValueFraction(level);
  }

  getUsherCooldown(level: number): number {
    return usherCooldownSeconds(level);
  }

  startUsherCooldown(level: number): void {
    const cooldownSeconds = this.getUsherCooldown(level);
    this.usherCooldownRemaining = cooldownSeconds;
    this.usherCooldown.set(cooldownSeconds);
    this.usherReady.set(false);

    this.timers.clearInterval('usherCooldown');

    // Use elapsed-time calculation to avoid floating-point drift from tick-based decrement
    const startTime = Date.now();
    const cooldownMs = cooldownSeconds * 1000;

    this.timers.setInterval(
      'usherCooldown',
      () => {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, (cooldownMs - elapsed) / 1000);
        // Round to 1 decimal place for clean display
        this.usherCooldownRemaining = Math.round(remaining * 10) / 10;
        this.usherCooldown.set(this.usherCooldownRemaining);

        if (this.usherCooldownRemaining === 0) {
          this.timers.clearInterval('usherCooldown');
          this.usherReady.set(true);
        }
      },
      100
    );
  }

  processUsherClick(seat: Seat, valuePercent: number): void {
    this.powerUpEventsService.requestClearSeatMovement();
    this.theaterService.incrementClickedCount();
    this.scoringService.updateMultiplier(seat);

    let ticketsEarned = 1;
    if (seat.showSoda) ticketsEarned += 1;
    if (seat.showPopcorn) ticketsEarned += 1;

    ticketsEarned *= this.scoringService.getMultiplier();
    const goldenPopcornMultiplier = Math.pow(
      POWER_UP_FORMULAS.TICKET_MULTIPLIER_BASE,
      this.concessionCache.getOwned('ticketMultiplier')
    );
    ticketsEarned *= goldenPopcornMultiplier;

    ticketsEarned *= valuePercent;

    this.scoringService.addScore(Math.floor(ticketsEarned));

    this.soundService.playPreset('blipSelect');

    this.powerUpEventsService.triggerUsherClick(seat, Math.floor(ticketsEarned), valuePercent);
    this.powerUpEventsService.requestNextSeat();
  }

  // ---------------------------------------------------------------------------
  // Storage
  // ---------------------------------------------------------------------------

  private usePowerUp(powerUpId: string): boolean {
    const data = this.storageService.loadGameData();
    const powerUp = data.powerUps?.find((p) => p.id === powerUpId);
    if (powerUp && powerUp.owned > 0) {
      powerUp.owned--;
      const saved = this.storageService.saveGameData({ powerUps: data.powerUps });
      if (saved) {
        this.concessionCache.invalidate();
      }
      return saved;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Seat data lookup (used by autoClicker interval)
  // ---------------------------------------------------------------------------

  private getSeatData(activeSeat: SeatPosition): Seat | null {
    const seatsData = this.theaterService.getSeatsData();

    const row = seatsData[activeSeat.rowIndex - 1];
    if (!row) return null;

    const sideSeats = activeSeat.side === 'left' ? row.leftSeats : row.rightSeats;
    if (!sideSeats || sideSeats.length === 0) return null;

    const seat = sideSeats[activeSeat.seatIndex - 1];
    return seat ? seat : null;
  }

  // ---------------------------------------------------------------------------
  // Restore from saved state
  // ---------------------------------------------------------------------------

  restoreState(activePowerUps: Map<string, number>, doublePointsActive: boolean, slowTimeActive: boolean): void {
    this.activePowerUps = activePowerUps;
    this.doublePointsActive = doublePointsActive;
    this.slowTimeActive = slowTimeActive;
    this.activePowerUpsSignal.set(new Map(this.activePowerUps));
  }

  /**
   * Force-emit the current active power-ups map to all signal subscribers.
   * Used after component initialization or game resume to sync the UI.
   */
  notifyPowerUpsChanged(): void {
    this.activePowerUpsSignal.set(new Map(this.activePowerUps));
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  clearAll(): void {
    this.timers.clearAll();
    this.activePowerUps.clear();
    this.activePowerUpsSignal.set(new Map());
    this.doublePointsActive = false;
    // Ensure slow-time effect is fully removed from seat movement
    if (this.slowTimeActive) {
      this.seatMovementService.setSlowTimeActive(false);
    }
    this.slowTimeActive = false;
    this.usherCooldownRemaining = 0;
    this.usherCooldown.set(0);
    this.usherReady.set(true);
  }
}
