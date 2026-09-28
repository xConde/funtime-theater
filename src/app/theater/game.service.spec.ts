import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { GAME_START_DELAY_MS, GameService, GameState } from './game.service';
import { Seat, TheaterService } from './theater.service';
import { PausedGameState } from './theater.model';
import { SoundService, SoundType } from './sound.service';
import { GAME_OVER_RING_SECONDS } from './theater.constants';
import { AchievementsService } from './achievements.service';
import { ScoringService } from './services/scoring.service';
import { ProgressionService } from './services/progression.service';
import { GameStateMachineService } from './services/game-state-machine.service';
import { ConcessionCacheService } from './services/concession-cache.service';
import { SeatMovementService } from './services/seat-movement.service';
import { PowerUpLifecycleService } from './services/power-up-lifecycle.service';
import { StorageService } from './services/storage.service';
import { FilmShowtimeService } from './film/film-showtime.service';
import { FilmScoreService } from './film/film-score.service';

describe('GameService', () => {
  let service: GameService;
  let scoringService: ScoringService;
  let theaterService: jasmine.SpyObj<TheaterService>;
  let storageService: StorageService;
  let powerUpLifecycle: PowerUpLifecycleService;
  let filmShowtime: FilmShowtimeService;

  let selectedSeatSignal: ReturnType<typeof signal<Seat | null>>;

  const createSeat = (row: number, seat: number, side: 'left' | 'right'): Seat => ({
    rowIndex: row,
    seatIndex: seat,
    side: side,
    showSoda: false,
    showPopcorn: false,
  });

  beforeEach(() => {
    selectedSeatSignal = signal<Seat | null>(null);
    let clickedCount = 0;

    const theaterSpy = jasmine.createSpyObj(
      'TheaterService',
      [
        'setActiveSeat',
        'getSeatsData',
        'getClickedCount',
        'incrementClickedCount',
        'resetClickedCount',
        'restoreClickedCount',
        'getRandomSeat',
        'getActiveSeat',
        'attractSeatsToPosition',
      ],
      {
        selectedSeat: selectedSeatSignal,
      }
    );
    theaterSpy.getClickedCount.and.callFake(() => clickedCount);
    theaterSpy.incrementClickedCount.and.callFake(() => clickedCount++);
    theaterSpy.resetClickedCount.and.callFake(() => {
      clickedCount = 0;
    });
    theaterSpy.restoreClickedCount.and.callFake((value: number) => {
      clickedCount = value;
    });

    const soundSpy = jasmine.createSpyObj('SoundService', [
      'playChairSound',
      'playPowerUpSound',
      'playAchievementSound',
      'playComboSound',
      'playPreset',
      'play',
    ]);

    const filmScoreSpy = jasmine.createSpyObj('FilmScoreService', ['start', 'stop']);

    const achievementsSpy = jasmine.createSpyObj('AchievementsService', ['checkAchievement', 'updateProgress']);

    // Setup default return values
    const seatsData = [];
    for (let row = 1; row <= 8; row++) {
      const leftSeats = [];
      const rightSeats = [];
      for (let s = 1; s <= 4; s++) {
        leftSeats.push(createSeat(row, s, 'left'));
        rightSeats.push(createSeat(row, s, 'right'));
      }
      seatsData.push({ rowIndex: row, seatsPerRow: 8, leftSeats, rightSeats });
    }
    theaterSpy.getSeatsData.and.returnValue(seatsData);

    TestBed.configureTestingModule({
      providers: [
        GameService,
        ScoringService,
        ProgressionService,
        GameStateMachineService,
        ConcessionCacheService,
        SeatMovementService,
        PowerUpLifecycleService,
        { provide: TheaterService, useValue: theaterSpy },
        { provide: SoundService, useValue: soundSpy },
        { provide: FilmScoreService, useValue: filmScoreSpy },
        { provide: AchievementsService, useValue: achievementsSpy },
      ],
    });

    service = TestBed.inject(GameService);
    scoringService = TestBed.inject(ScoringService);
    theaterService = TestBed.inject(TheaterService) as jasmine.SpyObj<TheaterService>;
    storageService = TestBed.inject(StorageService);
    powerUpLifecycle = TestBed.inject(PowerUpLifecycleService);
    filmShowtime = TestBed.inject(FilmShowtimeService);
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe('Game State Management', () => {
    it('should initialize with inactive state', () => {
      expect(service.gameState()).toBe(GameState.Inactive);
    });
  });

  describe('Scoring System', () => {
    it('should calculate score with multipliers correctly', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();
      tick(100);

      scoringService.setScore(10);
      expect(service.score()).toBe(10);

      scoringService.setMultiplier(2);
      scoringService.setScore(20);
      expect(service.score()).toBe(20);
    }));

    it('should calculate base score correctly', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();
      tick(100);

      scoringService.setScore(10);
      expect(service.score()).toBe(10);
    }));
  });

  describe('Power-ups', () => {
    it('should expose power-up activation method', () => {
      expect(service.activatePowerUp).toBeDefined();
    });
  });

  describe('Game Modes', () => {
    it('should set game mode correctly', () => {
      service.setGameMode('classic');
      expect(service['currentGameMode']).toBe('classic');

      service.setGameMode('midnight');
      expect(service['currentGameMode']).toBe('midnight');

      service.setGameMode('carnival');
      expect(service['currentGameMode']).toBe('carnival');
    });

    for (const mode of ['endless', 'finale'] as const) {
      it(`${mode} keeps the no-clock contract after start, a catch, and checkpointing`, fakeAsync(() => {
        const target = createSeat(2, 2, 'right');
        theaterService.getRandomSeat.and.returnValue(target);

        service.setGameMode(mode);
        service.startGame();
        tick(GAME_START_DELAY_MS);

        expect(service.gameState()).toBe(GameState.Playing);
        expect(service.timer()).toBe(-1);

        service.processGameSelection(target);
        tick(12000);

        expect(service.gameState()).toBe(GameState.Playing);
        expect(service.timer()).toBe(-1);

        service.prepareForRouteLeave();
        expect(storageService.loadPausedGameState()).toEqual(
          jasmine.objectContaining({ mode, timer: -1, remainingTime: -1 })
        );
      }));
    }
  });

  describe('Pause and Resume', () => {
    it('should expose save and resume methods', () => {
      expect(service.saveGameState).toBeDefined();
      expect(service.resumeFromSavedState).toBeDefined();
      expect(service.pauseGame).toBeDefined();
      expect(service.resumeGame).toBeDefined();
    });

    // document.hidden → TheaterComponent.onVisibilityChange() → pauseGame()
    // is covered in theater.component.spec.ts's "Visibility auto-pause
    // contract" describe block, which asserts pauseGame() itself gets
    // called. This closes the other half of that chain: pauseGame() must
    // silence the score, and resumeGame() must bring it back.
    it('pauseGame() stops the score and resumeGame() restarts it', fakeAsync(() => {
      const filmScore = service['filmScore'] as jasmine.SpyObj<FilmScoreService>;

      service.setGameMode('classic');
      service.startGame();
      tick(GAME_START_DELAY_MS);

      expect(service.gameState()).toBe(GameState.Playing);
      expect(filmScore.start).toHaveBeenCalledTimes(1);

      service.pauseGame();
      expect(service.gameState()).toBe(GameState.Paused);
      expect(filmScore.stop).toHaveBeenCalledTimes(1);

      service.resumeGame();
      expect(service.gameState()).toBe(GameState.Playing);
      expect(filmScore.start).toHaveBeenCalledTimes(2);

      service.endGame();
    }));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2 — RTG carryover Finding 1 (Sprints 4-14): SPA route-leave during
  // Playing leaves a stale paused checkpoint because GameService is root-DI
  // (its own ngOnDestroy never fires on navigation). The parent's destroy
  // hook calls pauseAndCheckpoint(); pin the contract here.
  // ─────────────────────────────────────────────────────────────────────────
  describe('pauseAndCheckpoint() (Phase 2)', () => {
    it('should be exposed as a public method', () => {
      expect(service.pauseAndCheckpoint).toBeDefined();
    });

    it('should pause the game, persist a checkpoint, and stop auto-save when called during Playing', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();
      tick(GAME_START_DELAY_MS);

      expect(service.gameState()).toBe(GameState.Playing);
      const savePausedSpy = spyOn(service['storageService'], 'savePausedGameState').and.callThrough();
      const stopAutoSaveSpy = spyOn(
        service as unknown as { stopAutoSave: () => void },
        'stopAutoSave'
      ).and.callThrough();

      service.pauseAndCheckpoint();

      expect(service.gameState()).toBe(GameState.Paused);
      expect(savePausedSpy).toHaveBeenCalledTimes(1);
      expect(stopAutoSaveSpy).toHaveBeenCalledTimes(1);

      // Idempotent: calling again from a non-Playing state is a no-op.
      service.pauseAndCheckpoint();
      expect(savePausedSpy).toHaveBeenCalledTimes(1);
      expect(stopAutoSaveSpy).toHaveBeenCalledTimes(1);

      // Tear down the FSM so the game-timer observable stops; otherwise
      // fakeAsync flags pending periodic timers.
      service.endGame();
    }));

    it('should be a no-op when the game is not in Playing', () => {
      expect(service.gameState()).toBe(GameState.Inactive);
      const savePausedSpy = spyOn(service['storageService'], 'savePausedGameState');
      service.pauseAndCheckpoint();
      expect(savePausedSpy).not.toHaveBeenCalled();
    });
  });

  describe('Level Progression', () => {
    it('should expose level signal', () => {
      expect(service.currentLevel()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Cleanup', () => {
    it('should expose endGame method', () => {
      expect(service.endGame).toBeDefined();
    });
  });

  describe('endGame() idempotence', () => {
    it('pays out and records progression only once when endGame is called twice', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();
      tick(GAME_START_DELAY_MS);
      scoringService.setScore(144);

      const saveResultsSpy = spyOn(
        service as unknown as { saveGameResults: (ticketsEarned: number) => void },
        'saveGameResults'
      ).and.callThrough();
      const awardXPSpy = spyOn(service['progressionService'], 'awardXP').and.callThrough();

      service.endGame();
      service.endGame();

      expect(service.gameState()).toBe(GameState.Ended);
      expect(saveResultsSpy).toHaveBeenCalledOnceWith(144);
      expect(awardXPSpy).toHaveBeenCalledTimes(1);
    }));

    it('does not pay out when called before a round is Playing', () => {
      const saveResultsSpy = spyOn(
        service as unknown as { saveGameResults: (ticketsEarned: number) => void },
        'saveGameResults'
      );

      service.endGame();

      expect(service.gameState()).toBe(GameState.Inactive);
      expect(saveResultsSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WS2c fix 3: isNewHighScore compares the round's score against the mode's
  // stored best BEFORE it gets overwritten, using the real StorageService
  // (root-provided, backed by test-environment localStorage — see the
  // module-level afterEach that clears it). A never-played mode has no
  // stored entry, so its implicit best is 0: a scoreless first run is not a
  // "new high score", but any positive first-run score is, since it is in
  // fact the best (only) score on record for that mode.
  // ─────────────────────────────────────────────────────────────────────────
  describe('New high score detection', () => {
    const playRound = (score: number): void => {
      service.setGameMode('classic');
      service.startGame();
      tick(GAME_START_DELAY_MS);
      scoringService.setScore(score);
      service.endGame();
    };

    it('flags a positive first-ever run in a mode as a new high score', fakeAsync(() => {
      playRound(50);
      expect(service.isNewHighScore()).toBeTrue();
    }));

    it('does not flag a scoreless first-ever run', fakeAsync(() => {
      playRound(0);
      expect(service.isNewHighScore()).toBeFalse();
    }));

    it('flags only later runs that beat the stored best for the mode', fakeAsync(() => {
      playRound(100);
      expect(service.isNewHighScore()).toBeTrue();

      service.resetToInactive();
      playRound(60);
      expect(service.isNewHighScore()).toBeFalse();

      service.resetToInactive();
      playRound(150);
      expect(service.isNewHighScore()).toBeTrue();
    }));

    it('resets to false the moment a new game starts', fakeAsync(() => {
      playRound(20);
      expect(service.isNewHighScore()).toBeTrue();

      service.resetToInactive();
      service.setGameMode('classic');
      service.startGame();

      expect(service.isNewHighScore()).toBeFalse();
      tick(GAME_START_DELAY_MS);
      service.endGame();
    }));

    it('plays the LevelUp sting only when a new high score is set', fakeAsync(() => {
      const soundSpy = TestBed.inject(SoundService) as jasmine.SpyObj<SoundService>;
      // ProgressionService is real here and plays this same sting on an actual
      // player XP level-up — unrelated to a mode high score. Stub it out so
      // this assertion isolates the new-high-score trigger specifically.
      spyOn(service['progressionService'], 'awardXP');

      playRound(30);
      // Delayed past GAME_OVER's own ring time so the two cues (already
      // asserted elsewhere) don't pile up on the AudioContext timeline.
      expect(soundSpy.play).toHaveBeenCalledWith(SoundType.LevelUp, GAME_OVER_RING_SECONDS);

      soundSpy.play.calls.reset();

      service.resetToInactive();
      playRound(10); // below the stored best of 30
      expect(soundSpy.play).not.toHaveBeenCalledWith(SoundType.LevelUp, jasmine.any(Number));
    }));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 1: gameStart timer is routed through DisposableTimer so
  // clearGameRound() / timers.clearAll() cancels it on route-leave.
  // If the timer fires when the FSM is no longer Starting (e.g. the user
  // navigated away during the instruction beat), the callback must be
  // a no-op so no ghost game loops are started.
  // ─────────────────────────────────────────────────────────────────────────
  describe('gameStart timer (FIX 1 — ghost-loop prevention)', () => {
    it('threads the film before the starting beat without advancing its clock', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();

      expect(service.gameState()).toBe(GameState.Starting);
      expect(filmShowtime.currentFilm()).not.toBeNull();
      expect(filmShowtime.filmSecond()).toBe(0);

      tick(GAME_START_DELAY_MS - 1);
      expect(filmShowtime.filmSecond()).toBe(0);

      service.prepareForRouteLeave();
    }));

    it('does not thread a film when the FSM rejects Starting', () => {
      const stateMachine = TestBed.inject(GameStateMachineService);
      spyOn(stateMachine, 'transition').and.returnValue(false);

      service.startGame();

      expect(service.gameState()).toBe(GameState.Inactive);
      expect(filmShowtime.currentFilm()).toBeNull();
    });

    it('waits for the full named Starting delay before entering Playing', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();

      tick(GAME_START_DELAY_MS - 1);
      expect(service.gameState()).toBe(GameState.Starting);

      tick(1);
      expect(service.gameState()).toBe(GameState.Playing);

      service.prepareForRouteLeave();
    }));

    it('does not transition or start loops when route teardown cancels Starting', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();

      // State is Starting; timer is armed but has not fired yet.
      expect(service.gameState()).toBe(GameState.Starting);

      const startPassiveIncomeSpy = spyOn(powerUpLifecycle, 'startPassiveIncome');
      const startAutoClickerSpy = spyOn(powerUpLifecycle, 'startAutoClicker');
      const startTicketStormSpy = spyOn(powerUpLifecycle, 'startTicketStorm');

      service.prepareForRouteLeave();

      tick(GAME_START_DELAY_MS + 100);

      expect(service.gameState()).toBe(GameState.Inactive);
      expect(startPassiveIncomeSpy).not.toHaveBeenCalled();
      expect(startAutoClickerSpy).not.toHaveBeenCalled();
      expect(startTicketStormSpy).not.toHaveBeenCalled();
    }));

    it('should NOT start passive income if state is not Starting when the delay fires', fakeAsync(() => {
      service.setGameMode('classic');
      service.startGame();

      expect(service.gameState()).toBe(GameState.Starting);

      // Force FSM out of Starting without clearing the timer, simulating the
      // game already having advanced (e.g. a double-fire) before the delayed
      // callback runs. Starting -> Playing is the only valid edge out of
      // Starting, so use it; the callback's belt-and-suspenders guard
      // (gameState() !== Starting) must then short-circuit.
      service['stateMachine'].transition(GameState.Playing);

      const startPassiveIncomeSpy = spyOn(service['powerUpLifecycle'], 'startPassiveIncome');

      tick(GAME_START_DELAY_MS);

      expect(startPassiveIncomeSpy).not.toHaveBeenCalled();
    }));
  });

  describe('checkpoint resume reliability', () => {
    const checkpoint = (overrides: Partial<PausedGameState> = {}): PausedGameState => ({
      mode: 'timeAttack',
      score: 320,
      multiplier: 4,
      timer: 7,
      remainingTime: 7,
      clickedCount: 11,
      activePowerUps: [['doublePoints', 2]],
      doublePointsActive: true,
      slowTimeActive: false,
      timestamp: Date.now(),
      ...overrides,
    });

    it('restores the exact timer, click difficulty, mode name, and runtime loops once', fakeAsync(() => {
      expect(storageService.savePausedGameState(checkpoint())).toBeTrue();
      theaterService.getRandomSeat.and.returnValue(createSeat(2, 3, 'right'));

      const passiveSpy = spyOn(powerUpLifecycle, 'startPassiveIncome').and.callThrough();
      const autoClickerSpy = spyOn(powerUpLifecycle, 'startAutoClicker').and.callThrough();
      const ticketStormSpy = spyOn(powerUpLifecycle, 'startTicketStorm').and.callThrough();
      const autoSaveSpy = spyOn(service as unknown as { startAutoSave: () => void }, 'startAutoSave').and.callThrough();

      expect(service.resumeFromSavedState()).toBeTrue();

      expect(service.gameState()).toBe(GameState.Playing);
      expect(service.timer()).toBe(7);
      expect(theaterService.setActiveSeat).toHaveBeenCalledWith(
        jasmine.objectContaining({ rowIndex: 2, seatIndex: 3, side: 'right' })
      );
      expect(service.currentGameModeName()).toBe('Time Attack');
      expect(scoringService.getScore()).toBe(320);
      expect(scoringService.getMultiplier()).toBe(4);
      expect(theaterService.restoreClickedCount).toHaveBeenCalledOnceWith(11);
      expect(passiveSpy).toHaveBeenCalledTimes(1);
      expect(autoClickerSpy).toHaveBeenCalledTimes(1);
      expect(ticketStormSpy).toHaveBeenCalledTimes(1);
      expect(autoSaveSpy).toHaveBeenCalledTimes(1);
      expect(storageService.loadPausedGameState()).toBeNull();

      service.prepareForRouteLeave();
    }));

    it('restarts Midnight blackouts and Carnival movement state', () => {
      const scheduleBlackoutsSpy = spyOn(
        service as unknown as { scheduleBlackouts: () => void },
        'scheduleBlackouts'
      ).and.callThrough();
      const carnivalSpy = spyOn(service['seatMovementService'], 'setCarnivalMode').and.callThrough();

      expect(storageService.savePausedGameState(checkpoint({ mode: 'midnight' }))).toBeTrue();
      expect(service.resumeFromSavedState()).toBeTrue();
      expect(scheduleBlackoutsSpy).toHaveBeenCalledTimes(1);
      service.prepareForRouteLeave();

      expect(storageService.savePausedGameState(checkpoint({ mode: 'carnival' }))).toBeTrue();
      expect(service.resumeFromSavedState()).toBeTrue();
      expect(carnivalSpy).toHaveBeenCalledWith(true);
      service.prepareForRouteLeave();
    });

    it('keeps a valid checkpoint when runtime startup fails', () => {
      expect(storageService.savePausedGameState(checkpoint())).toBeTrue();
      const filmScore = service['filmScore'] as jasmine.SpyObj<FilmScoreService>;
      filmScore.start.and.throwError('audio unavailable');

      expect(service.resumeFromSavedState()).toBeFalse();

      expect(service.gameState()).toBe(GameState.Inactive);
      expect(scoringService.getScore()).toBe(0);
      expect(service.currentGameModeName()).toBe('');
      expect(storageService.loadPausedGameState()).toEqual(jasmine.objectContaining({ mode: 'timeAttack', timer: 7 }));
    });

    it('clears a legacy Memory checkpoint instead of pretending to resume it', () => {
      expect(storageService.savePausedGameState(checkpoint({ mode: 'memory' }))).toBeTrue();

      expect(service.resumeFromSavedState()).toBeFalse();

      expect(service.gameState()).toBe(GameState.Inactive);
      expect(storageService.loadPausedGameState()).toBeNull();
    });

    it('saves the displayed timer as the resumable remaining time', fakeAsync(() => {
      theaterService.getRandomSeat.and.returnValue(createSeat(1, 1, 'left'));
      service.setGameMode('classic');
      service.startGame();
      tick(GAME_START_DELAY_MS + 3000);
      const displayedTimer = service.timer();
      expect(displayedTimer).toBe(7);

      service.prepareForRouteLeave();

      const saved = storageService.loadPausedGameState();
      expect(saved).not.toBeNull();
      expect(saved?.timer).toBe(displayedTimer);
      expect(saved?.remainingTime).toBe(saved?.timer);
    }));
  });
});
