import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { PowerUpLifecycleService } from './power-up-lifecycle.service';
import { ConcessionCacheService } from './concession-cache.service';
import { StorageService } from './storage.service';
import { ScoringService } from './scoring.service';
import { SoundService, SoundType } from '../sound.service';
import { Seat, TheaterService } from '../theater.service';
import { PowerUpEventsService } from './power-up-events.service';
import { SeatMovementService } from './seat-movement.service';
import { GameStateMachineService } from './game-state-machine.service';
import { GameMode, GameState } from '../game.service';
import { POWER_UP_FORMULAS, SPECIAL_EFFECTS } from '../theater.constants';

describe('PowerUpLifecycleService', () => {
  let service: PowerUpLifecycleService;
  let concessionCacheSpy: jasmine.SpyObj<ConcessionCacheService>;
  let storageSpy: jasmine.SpyObj<StorageService>;
  let scoringServiceSpy: jasmine.SpyObj<ScoringService>;
  let soundServiceSpy: jasmine.SpyObj<SoundService>;
  let theaterServiceSpy: jasmine.SpyObj<TheaterService>;
  let powerUpEventsService: PowerUpEventsService;
  let seatMovementSpy: jasmine.SpyObj<SeatMovementService>;
  let stateMachine: GameStateMachineService;

  const makeSeat = (
    row: number,
    seat: number,
    side: 'left' | 'right',
    showSoda = false,
    showPopcorn = false
  ): Seat => ({ rowIndex: row, seatIndex: seat, side, showSoda, showPopcorn });

  beforeEach(() => {
    concessionCacheSpy = jasmine.createSpyObj('ConcessionCacheService', [
      'getOwned',
      'getCount',
      'refresh',
      'invalidate',
    ]);
    storageSpy = jasmine.createSpyObj('StorageService', ['loadGameData', 'saveGameData']);
    scoringServiceSpy = jasmine.createSpyObj('ScoringService', ['addScore', 'updateMultiplier', 'getMultiplier']);
    soundServiceSpy = jasmine.createSpyObj('SoundService', ['play', 'playPreset']);
    theaterServiceSpy = jasmine.createSpyObj('TheaterService', [
      'getActiveSeat',
      'getSeatsData',
      'incrementClickedCount',
    ]);
    // Use real PowerUpEventsService — event subjects need to be real for subscriptions

    seatMovementSpy = jasmine.createSpyObj('SeatMovementService', ['setSlowTimeActive', 'clearSeatMovement']);

    // Default return values
    concessionCacheSpy.getOwned.and.returnValue(0);
    concessionCacheSpy.getCount.and.returnValue(0);
    storageSpy.loadGameData.and.returnValue({
      coins: 0,
      name: 'Player',
      totalGamesPlayed: 0,
      totalXP: 0,
      gameModes: [],
      powerUps: [],
    });
    storageSpy.saveGameData.and.returnValue(true);
    scoringServiceSpy.getMultiplier.and.returnValue(1);

    // Build seatsData for getSeatData lookups
    const seatsData: ReturnType<TheaterService['getSeatsData']> = [];
    for (let row = 1; row <= 4; row++) {
      const leftSeats = [1, 2, 3].map((s) => makeSeat(row, s, 'left'));
      const rightSeats = [1, 2, 3].map((s) => makeSeat(row, s, 'right'));
      seatsData.push({ rowIndex: row, seatsPerRow: 6, leftSeats, rightSeats });
    }
    theaterServiceSpy.getSeatsData.and.returnValue(seatsData);

    TestBed.configureTestingModule({
      providers: [
        PowerUpLifecycleService,
        GameStateMachineService,
        { provide: ConcessionCacheService, useValue: concessionCacheSpy },
        { provide: StorageService, useValue: storageSpy },
        { provide: ScoringService, useValue: scoringServiceSpy },
        { provide: SoundService, useValue: soundServiceSpy },
        { provide: TheaterService, useValue: theaterServiceSpy },
        PowerUpEventsService,
        { provide: SeatMovementService, useValue: seatMovementSpy },
      ],
    });

    service = TestBed.inject(PowerUpLifecycleService);
    stateMachine = TestBed.inject(GameStateMachineService);
    powerUpEventsService = TestBed.inject(PowerUpEventsService);

    // Wire up minimal timer callbacks
    let fakeTimer = 20;
    service.setTimerCallbacks(
      () => fakeTimer,
      (v) => {
        fakeTimer = v;
      },
      (_delta) => {
        /* remaining time adjusted */
      }
    );
  });

  afterEach(() => {
    service.clearAll();
    window.localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // =========================================================================
  // activatePowerUp
  // =========================================================================

  describe('activatePowerUp', () => {
    it('activatePowerUp("doublePoints") sets active map and decrements storage', () => {
      concessionCacheSpy.getCount.and.returnValue(3);
      storageSpy.loadGameData.and.returnValue({
        coins: 0,
        name: 'Player',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [{ id: 'doublePoints', owned: 3 }],
      });

      service.activatePowerUp('doublePoints');

      expect(service.activePowerUpsSignal().get('doublePoints')).toBe(5);
      expect(service.isDoublePointsActive()).toBeTrue();
      expect(storageSpy.saveGameData).toHaveBeenCalled();
    });

    it('activatePowerUp("doublePoints") does nothing when count is 0', () => {
      concessionCacheSpy.getCount.and.returnValue(0);
      service.activatePowerUp('doublePoints');
      expect(service.activePowerUpsSignal().has('doublePoints')).toBeFalse();
    });

    it('activatePowerUp("slowTime") sets active, calls setSlowTimeActive, deactivates after 10s', fakeAsync(() => {
      concessionCacheSpy.getCount.and.returnValue(1);
      storageSpy.loadGameData.and.returnValue({
        coins: 0,
        name: 'Player',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [{ id: 'slowTime', owned: 1 }],
      });

      service.activatePowerUp('slowTime');

      expect(service.activePowerUpsSignal().get('slowTime')).toBe(10);
      expect(service.isSlowTimeActive()).toBeTrue();
      expect(seatMovementSpy.setSlowTimeActive).toHaveBeenCalledWith(true);

      tick(10000);

      expect(service.isSlowTimeActive()).toBeFalse();
      expect(seatMovementSpy.setSlowTimeActive).toHaveBeenCalledWith(false);
      expect(service.activePowerUpsSignal().has('slowTime')).toBeFalse();
    }));

    it('activatePowerUp("extraTime") adds 15 to timer when not Endless mode', () => {
      concessionCacheSpy.getCount.and.returnValue(1);
      storageSpy.loadGameData.and.returnValue({
        coins: 0,
        name: 'Player',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [{ id: 'extraTime', owned: 1 }],
      });

      let timerValue = 10;
      let remaining = 10;
      service.setTimerCallbacks(
        () => timerValue,
        (v) => {
          timerValue = v;
        },
        (delta) => {
          remaining += delta;
        }
      );
      service.setCurrentGameMode(GameMode.Classic);

      service.activatePowerUp('extraTime');

      expect(timerValue).toBe(25); // 10 + 15
      expect(remaining).toBe(25); // 10 + 15
    });

    it('activatePowerUp("extraTime") does NOT add time in Endless mode', () => {
      concessionCacheSpy.getCount.and.returnValue(1);
      storageSpy.loadGameData.and.returnValue({
        coins: 0,
        name: 'Player',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [{ id: 'extraTime', owned: 1 }],
      });

      let timerValue = 10;
      service.setTimerCallbacks(
        () => timerValue,
        (v) => {
          timerValue = v;
        },
        () => {}
      );
      service.setCurrentGameMode(GameMode.Endless);

      service.activatePowerUp('extraTime');

      expect(timerValue).toBe(10); // Unchanged
    });

    it('plays PowerUp sound on activation', () => {
      concessionCacheSpy.getCount.and.returnValue(1);
      storageSpy.loadGameData.and.returnValue({
        coins: 0,
        name: 'Player',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [{ id: 'multiSelect', owned: 1 }],
      });

      service.activatePowerUp('multiSelect');

      expect(soundServiceSpy.play).toHaveBeenCalledWith(SoundType.PowerUp);
    });
  });

  // =========================================================================
  // decrementPowerUp
  // =========================================================================

  describe('decrementPowerUp', () => {
    it('decrements count by 1 when count > 1', () => {
      // Seed the map directly via restoreState
      service.restoreState(new Map([['doublePoints', 3]]), true, false);

      service.decrementPowerUp('doublePoints');

      expect(service.activePowerUpsSignal().get('doublePoints')).toBe(2);
    });

    it('removes entry and clears doublePointsActive when count reaches 0', () => {
      service.restoreState(new Map([['doublePoints', 1]]), true, false);

      service.decrementPowerUp('doublePoints');

      expect(service.activePowerUpsSignal().has('doublePoints')).toBeFalse();
      expect(service.isDoublePointsActive()).toBeFalse();
    });

    it('removes entry for non-doublePoints power-up at count 1', () => {
      service.restoreState(new Map([['multiSelect', 1]]), false, false);

      service.decrementPowerUp('multiSelect');

      expect(service.activePowerUpsSignal().has('multiSelect')).toBeFalse();
    });
  });

  // =========================================================================
  // updatePermanentPowerUps
  // =========================================================================

  describe('updatePermanentPowerUps', () => {
    it('populates permanent power-ups from cache using data-driven loop', () => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => {
        if (id === 'ticketMultiplier') return 2;
        if (id === 'passiveIncome') return 1;
        if (id === 'autoClicker') return 3;
        return 0;
      });

      service.updatePermanentPowerUps();

      const signal = service.activePowerUpsSignal();
      expect(signal.get('ticketMultiplier')).toBe(2);
      expect(signal.get('passiveIncome')).toBe(1);
      expect(signal.get('autoClicker')).toBe(3);
      expect(signal.has('magneticField')).toBeFalse();
    });

    it('does not add permanent power-up with 0 owned', () => {
      concessionCacheSpy.getOwned.and.returnValue(0);

      service.updatePermanentPowerUps();

      expect(service.activePowerUpsSignal().size).toBe(0);
    });

    it('preserves temporary power-ups when updating permanent ones', () => {
      // Seed temporary power-ups
      service.restoreState(
        new Map([
          ['doublePoints', 5],
          ['slowTime', 10],
        ]),
        true,
        true
      );

      // Make one permanent power-up available
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'ticketMultiplier' ? 1 : 0));

      service.updatePermanentPowerUps();

      const signal = service.activePowerUpsSignal();
      // Temporary ones preserved
      expect(signal.get('doublePoints')).toBe(5);
      expect(signal.get('slowTime')).toBe(10);
      // Permanent one added
      expect(signal.get('ticketMultiplier')).toBe(1);
    });

    it('does NOT preserve non-temporary power-ups across update', () => {
      service.restoreState(new Map([['luckyStreak', 2]]), false, false);

      // Make luckyStreak NOT owned (owned = 0)
      concessionCacheSpy.getOwned.and.returnValue(0);

      service.updatePermanentPowerUps();

      // luckyStreak is permanent — should be removed since owned=0
      expect(service.activePowerUpsSignal().has('luckyStreak')).toBeFalse();
    });
  });

  // =========================================================================
  // startPassiveIncome
  // =========================================================================

  describe('startPassiveIncome', () => {
    it('does not start interval when passiveIncome owned = 0', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.returnValue(0);

      service.startPassiveIncome();
      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);

      tick(1000);

      expect(scoringServiceSpy.addScore).not.toHaveBeenCalled();
      service.clearAll();
    }));

    it('adds score every second when Playing and passiveIncome > 0', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'passiveIncome' ? 2 : 0));

      service.startPassiveIncome();
      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);

      tick(3000);

      // income = 2 * 5 = 10 per second, 3 ticks
      expect(scoringServiceSpy.addScore).toHaveBeenCalledWith(10);
      expect(scoringServiceSpy.addScore).toHaveBeenCalledTimes(3);
      service.clearAll();
    }));

    it('does not add score when state is not Playing', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'passiveIncome' ? 1 : 0));

      service.startPassiveIncome();
      // state stays Inactive

      tick(3000);

      expect(scoringServiceSpy.addScore).not.toHaveBeenCalled();
      service.clearAll();
    }));
  });

  // =========================================================================
  // startAutoClicker (usher)
  // =========================================================================

  describe('startAutoClicker', () => {
    it('fires when timer <= 3 and usherCooldown is 0', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'autoClicker' ? 1 : 0));
      scoringServiceSpy.getMultiplier.and.returnValue(1);

      // Timer returns 3
      const timerVal = 3;
      service.setTimerCallbacks(
        () => timerVal,
        () => {},
        () => {}
      );

      // Subscribe to event-based seat selection (replaces callback)
      const selectNextSeatSpy = jasmine.createSpy('selectNextSeat');
      powerUpEventsService.selectNextSeat$.subscribe(selectNextSeatSpy);

      // Set active seat
      const activeSeatPos = { rowIndex: 1, seatIndex: 1, side: 'left' as const };
      theaterServiceSpy.getActiveSeat.and.returnValue(activeSeatPos);

      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);
      service.startAutoClicker();

      tick(100);

      expect(theaterServiceSpy.incrementClickedCount).toHaveBeenCalled();
      expect(scoringServiceSpy.addScore).toHaveBeenCalled();
      expect(selectNextSeatSpy).toHaveBeenCalled();
      service.clearAll();
    }));

    it('does not fire when timer > 3', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'autoClicker' ? 1 : 0));

      const timerVal = 10; // > 3
      service.setTimerCallbacks(
        () => timerVal,
        () => {},
        () => {}
      );

      theaterServiceSpy.getActiveSeat.and.returnValue({ rowIndex: 1, seatIndex: 1, side: 'left' as const });

      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);
      service.startAutoClicker();

      tick(500);

      expect(theaterServiceSpy.incrementClickedCount).not.toHaveBeenCalled();
      service.clearAll();
    }));

    it('does not fire when autoClicker owned = 0', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.returnValue(0);

      service.startAutoClicker();
      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);

      tick(500);

      expect(theaterServiceSpy.incrementClickedCount).not.toHaveBeenCalled();
      service.clearAll();
    }));
  });

  // =========================================================================
  // Usher value percent curve
  // =========================================================================

  describe('getUsherValuePercent', () => {
    it('returns 0.25 at level 1', () => {
      expect(service.getUsherValuePercent(1)).toBe(0.25);
    });

    it('returns correct value at level 5', () => {
      // 0.25 + (5-1) * 0.125 = 0.25 + 0.5 = 0.75
      expect(service.getUsherValuePercent(5)).toBeCloseTo(0.75, 3);
    });

    it('returns correct value at level 7', () => {
      // 1.0 + (7-7) * 0.083 = 1.0
      expect(service.getUsherValuePercent(7)).toBeCloseTo(1.0, 3);
    });

    it('returns 1.25 at level 10', () => {
      expect(service.getUsherValuePercent(10)).toBe(1.25);
    });

    it('returns 1.25 for level > 10', () => {
      expect(service.getUsherValuePercent(15)).toBe(1.25);
    });
  });

  // =========================================================================
  // Usher cooldown values
  // =========================================================================

  describe('getUsherCooldown', () => {
    it('returns 10 at level 1', () => {
      expect(service.getUsherCooldown(1)).toBe(10);
    });

    it('returns 8 at level 2', () => {
      expect(service.getUsherCooldown(2)).toBe(8);
    });

    it('returns 6 at level 3', () => {
      expect(service.getUsherCooldown(3)).toBe(6);
    });

    it('returns 4 at level 4', () => {
      expect(service.getUsherCooldown(4)).toBe(4);
    });

    it('returns 2 at level 5 and above', () => {
      expect(service.getUsherCooldown(5)).toBe(2);
      expect(service.getUsherCooldown(10)).toBe(2);
    });
  });

  // =========================================================================
  // clearAll
  // =========================================================================

  describe('clearAll', () => {
    it('clears all intervals and resets signals', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'passiveIncome' ? 1 : 0));
      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);
      service.startPassiveIncome();

      service.clearAll();

      tick(5000);

      // addScore should not have been called after clearAll
      expect(scoringServiceSpy.addScore).not.toHaveBeenCalled();
    }));

    it('resets all power-up state to defaults', () => {
      service.restoreState(new Map([['doublePoints', 5]]), true, true);

      service.clearAll();

      expect(service.activePowerUpsSignal().size).toBe(0);
      expect(service.isDoublePointsActive()).toBeFalse();
      expect(service.isSlowTimeActive()).toBeFalse();
      expect(service.usherCooldown()).toBe(0);
      expect(service.usherReady()).toBeTrue();
    });
  });

  // =========================================================================
  // restoreState
  // =========================================================================

  describe('restoreState', () => {
    it('restores saved power-up map and flags', () => {
      const savedMap = new Map<string, number>([
        ['doublePoints', 3],
        ['ticketMultiplier', 2],
      ]);
      service.restoreState(savedMap, true, false);

      const sig = service.activePowerUpsSignal();
      expect(sig.get('doublePoints')).toBe(3);
      expect(sig.get('ticketMultiplier')).toBe(2);
      expect(service.isDoublePointsActive()).toBeTrue();
      expect(service.isSlowTimeActive()).toBeFalse();
    });
  });

  // =========================================================================
  // getActivePowerUps
  // =========================================================================

  describe('getActivePowerUps', () => {
    it('returns the current active power-ups map', () => {
      service.restoreState(new Map([['multiSelect', 3]]), false, false);

      const map = service.getActivePowerUps();
      expect(map.get('multiSelect')).toBe(3);
    });
  });

  // =========================================================================
  // passiveIncomeTick$ event emission
  // =========================================================================

  describe('passiveIncomeTick$ emission', () => {
    it('emits passiveIncomeTick$ with correct amount when game is Playing', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'passiveIncome' ? 2 : 0));
      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);

      const emitted: number[] = [];
      powerUpEventsService.passiveIncomeTick$.subscribe((e) => emitted.push(e.amount));

      service.startPassiveIncome();
      tick(1000);

      // PASSIVE_INCOME_PER_LEVEL * owned = income per tick
      expect(emitted.length).toBeGreaterThanOrEqual(1);
      expect(emitted[0]).toBeGreaterThan(0);

      service.clearAll();
      stateMachine.reset();
    }));

    it('does not emit passiveIncomeTick$ when game is not Playing', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'passiveIncome' ? 1 : 0));
      // State machine left in initial (non-Playing) state

      const emitted: number[] = [];
      powerUpEventsService.passiveIncomeTick$.subscribe((e) => emitted.push(e.amount));

      service.startPassiveIncome();
      tick(2000);

      expect(emitted.length).toBe(0);

      service.clearAll();
    }));
  });

  // =========================================================================
  // ticketStormFire$ event emission
  // =========================================================================

  describe('ticketStormFire$ emission', () => {
    it('emits ticketStormFire$ with correct amount when game is Playing', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'ticketStorm' ? 3 : 0));
      stateMachine.transition(GameState.Starting);
      stateMachine.transition(GameState.Playing);

      const emitted: number[] = [];
      powerUpEventsService.ticketStormFire$.subscribe((e) => emitted.push(e.amount));

      service.startTicketStorm();
      tick(SPECIAL_EFFECTS.TICKET_STORM_INTERVAL - 1);
      expect(emitted).toEqual([]);
      tick(1);

      expect(emitted).toEqual([3 * POWER_UP_FORMULAS.TICKET_STORM_PER_LEVEL]);

      service.clearAll();
      stateMachine.reset();
    }));

    it('does not emit ticketStormFire$ when game is not Playing', fakeAsync(() => {
      concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'ticketStorm' ? 1 : 0));
      // Non-Playing state

      const emitted: number[] = [];
      powerUpEventsService.ticketStormFire$.subscribe((e) => emitted.push(e.amount));

      service.startTicketStorm();
      tick(SPECIAL_EFFECTS.TICKET_STORM_INTERVAL * 2);

      expect(emitted.length).toBe(0);

      service.clearAll();
    }));
  });
});
