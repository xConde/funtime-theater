import { Injectable, OnDestroy, Signal, signal, WritableSignal } from '@angular/core';
import { environment } from 'environments/environment';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable, Subscription, timer } from 'rxjs';
import { Seat, SeatPosition, TheaterService } from './theater.service';
import { SoundService, SoundType } from './sound.service';
import { AchievementsService } from './achievements.service';
import { PausedGameState, SavedGameMode } from './theater.model';
import {
  effectivePowerUpLevel,
  GAME_DURATIONS,
  GAME_MECHANICS,
  GAME_OVER_RING_SECONDS,
  POST_ROUND_ACHIEVEMENT_STING_OFFSET_SECONDS,
  POWER_UP_FORMULAS,
  SPECIAL_EFFECTS,
  XP_FROM_TICKETS_SQRT_FACTOR,
} from './theater.constants';
import { StorageService } from './services/storage.service';
import { ConcessionCacheService } from './services/concession-cache.service';
import { PowerUpEventsService } from './services/power-up-events.service';
import { ScoringService } from './services/scoring.service';
import { ProgressionService } from './services/progression.service';
import { GameStateMachineService } from './services/game-state-machine.service';
import { SeatMovementService } from './services/seat-movement.service';
import { PowerUpLifecycleService } from './services/power-up-lifecycle.service';
import { BaseGameMode, GameModeContext } from './game-modes/base-game-mode';
import { ClassicMode } from './game-modes/classic-mode';
import { TimeAttackMode } from './game-modes/time-attack-mode';
import { EndlessMode } from './game-modes/endless-mode';
import { MemoryMode } from './game-modes/memory-mode';
import { MidnightMode } from './game-modes/midnight-mode';
import { CarnivalMode } from './game-modes/carnival-mode';
import { FinaleMode } from './game-modes/finale-mode';
import { DisposableTimer } from './utils/disposable-timer';
import { FilmShowtimeService, INFINITE_MODE_RUNTIME } from './film/film-showtime.service';
import { FilmScoreService } from './film/film-score.service';
import { applauseBonus, AudienceService } from './services/audience.service';

export enum GameState {
  Inactive = 1,
  Playing = 2,
  Ended = 3,
  Starting = 4,
  Paused = 5,
}

export enum GameMode {
  Classic = 'classic',
  TimeAttack = 'timeAttack',
  Endless = 'endless',
  Memory = 'memory',
  Midnight = 'midnight',
  Carnival = 'carnival',
  Finale = 'finale',
}

/** Lets the starting instruction card read before the house lights go down. */
export const GAME_START_DELAY_MS = 1800;

const RESUMABLE_GAME_MODES: ReadonlySet<GameMode> = new Set<GameMode>([
  GameMode.Classic,
  GameMode.TimeAttack,
  GameMode.Endless,
  GameMode.Midnight,
  GameMode.Carnival,
  GameMode.Finale,
]);

const UNTIMED_GAME_MODES: ReadonlySet<GameMode> = new Set<GameMode>([GameMode.Endless, GameMode.Finale]);

@Injectable({
  providedIn: 'root',
})
export class GameService implements OnDestroy {
  /** Delegates to the FSM — preserves signal-read API for all consumers. */
  readonly gameState: Signal<GameState>;
  readonly timer = signal(20);
  private remainingTime = 0;

  private gameTimerSubscription: Subscription | null = null;
  private autoSaveSubscription: Subscription | null = null;
  private theaterSubscription: Subscription;
  private usherEventSubscriptions: Subscription[] = [];
  private timers = new DisposableTimer();

  // Delegated to PowerUpLifecycleService
  get usherCooldown(): Signal<number> {
    return this.powerUpLifecycle.usherCooldown;
  }
  get usherReady(): Signal<boolean> {
    return this.powerUpLifecycle.usherReady;
  }
  get activePowerUpsSignal(): Signal<Map<string, number>> {
    return this.powerUpLifecycle.activePowerUpsSignal;
  }

  private rapidClickTimestamps: number[] = [];
  private consecutiveHits = 0;

  private currentGameMode: GameMode = GameMode.Classic;
  private memorySequence: SeatPosition[] = [];
  private memoryPlayerIndex = 0;
  private pendingTriggerCounts: Map<string, number> = new Map();
  readonly coinsEarned = signal(0);
  /** The round-end applause bonus the crowd's mood earned (separate from coinsEarned). */
  readonly appBonusEarned = signal(0);
  /** True when the round just ended beat the stored best for the current mode. */
  readonly isNewHighScore = signal(false);
  /**
   * True from the moment a checkpoint resume is chosen until resumeFromSavedState()
   * settles (success or failure). TheaterComponent defers that call by 500ms so the
   * lobby unmount animation can commit, but gameState stays whatever it already was
   * (Paused for a same-route resume, Inactive after a route remount) for the whole
   * window — during which the pause-exit affordances (click, keypress, LOBBY) would
   * otherwise race the still-un-rebuilt runtime. resumeGame() and TheaterComponent's
   * openLobby() both short-circuit while this is true.
   */
  readonly isResumePending = signal(false);

  readonly currentGameModeName = signal('');
  /** Gates the Starting card's "how to play" copy to the first round of the
   *  session. Root-provided ⇒ session-scoped memory: returning players skip
   *  the lecture on later rounds without needing storage. */
  readonly showStartHint = signal(true);

  // Game mode strategies
  private gameModes: Map<string, BaseGameMode>;

  constructor(
    private theaterService: TheaterService,
    private soundService: SoundService,
    private achievementsService: AchievementsService,
    private storageService: StorageService,
    private concessionCache: ConcessionCacheService,
    private powerUpEventsService: PowerUpEventsService,
    private scoringService: ScoringService,
    private progressionService: ProgressionService,
    private stateMachine: GameStateMachineService,
    private seatMovementService: SeatMovementService,
    private powerUpLifecycle: PowerUpLifecycleService,
    private filmShowtime: FilmShowtimeService,
    private filmScore: FilmScoreService,
    private audienceService: AudienceService
  ) {
    this.gameState = this.stateMachine.state;

    // Wire up timer callbacks for ExtraTime power-up
    this.powerUpLifecycle.setTimerCallbacks(
      () => this.timer(),
      (v) => this.timer.set(v),
      (delta) => {
        this.remainingTime += delta;
      }
    );

    // Subscribe to usher events (replaces callback bridge for seat operations)
    this.usherEventSubscriptions.push(
      this.powerUpEventsService.selectNextSeat$.subscribe(() => this.selectRandomSeatForGame()),
      this.powerUpEventsService.clearSeatMovement$.subscribe(() => this.clearSeatMovement())
    );

    this.theaterSubscription = toObservable(this.theaterService.selectedSeat).subscribe((selectedSeat) => {
      if (selectedSeat) {
        this.handleSeatSelection(selectedSeat as Seat);
      }
    });

    // Initialize game mode strategies
    const context: GameModeContext = {
      setTimer: (seconds: number) => this.timer.set(seconds),
      selectRandomSeat: () => this.selectRandomSeatForGame(),
      startGameTimer: (seconds?: number) => this.startGameTimer(seconds),
      startSeatMovement: () => this.seatMovementService.startSeatMovement(),
      showMemorySequence: () => this.showMemorySequence(),
      scheduleBlackouts: () => this.scheduleBlackouts(),
      setEndlessSpeedMultiplier: (multiplier: number) => this.seatMovementService.setEndlessSpeedMultiplier(multiplier),
      setCarnivalMode: (enabled: boolean) => this.seatMovementService.setCarnivalMode(enabled),
    };

    this.gameModes = new Map<string, BaseGameMode>([
      [GameMode.Classic, new ClassicMode(context)],
      [GameMode.TimeAttack, new TimeAttackMode(context)],
      [GameMode.Endless, new EndlessMode(context)],
      [GameMode.Memory, new MemoryMode(context)],
      [GameMode.Midnight, new MidnightMode(context)],
      [GameMode.Carnival, new CarnivalMode(context)],
      [GameMode.Finale, new FinaleMode(context)],
    ]);
  }

  // Delegated signals from ScoringService
  public get score(): WritableSignal<number> {
    return this.scoringService.score;
  }
  public get scoreIncrement$(): Observable<number> {
    return this.scoringService.scoreIncrement$;
  }
  public get multiplier(): WritableSignal<number> {
    return this.scoringService.multiplier;
  }
  public get multiplierIncrement$(): Observable<number> {
    return this.scoringService.multiplierIncrement$;
  }

  // Delegated signals from ProgressionService
  public get currentLevel(): WritableSignal<number> {
    return this.progressionService.currentLevel;
  }
  public get levelProgress(): WritableSignal<number> {
    return this.progressionService.levelProgress;
  }
  public get totalXP(): WritableSignal<number> {
    return this.progressionService.totalXP;
  }

  ngOnDestroy(): void {
    // If game is still active on destroy (e.g., SPA navigation),
    // save checkpoint so player can resume, then clean up.
    if (this.gameState() === GameState.Playing) {
      this.flushPowerUpTriggerCounts();
      this.saveGameState();
    }
    this.clearGameRound();
    if (this.theaterSubscription) {
      this.theaterSubscription.unsubscribe();
    }
    this.usherEventSubscriptions.forEach((sub) => sub.unsubscribe());
    this.usherEventSubscriptions = [];
    this.timers.clearAll();
  }

  setGameMode(mode: string): void {
    this.currentGameMode = mode as GameMode;
  }

  startGame(): void {
    this.concessionCache.refresh();
    this.scoringService.reset();
    this.theaterService.resetClickedCount();
    this.audienceService.reset();
    this.coinsEarned.set(0);
    this.appBonusEarned.set(0);
    this.isNewHighScore.set(false);
    this.seatMovementService.setEndlessSpeedMultiplier(1);
    this.memorySequence = [];
    this.memoryPlayerIndex = 0;

    this.rapidClickTimestamps = [];
    this.consecutiveHits = 0;
    this.pendingTriggerCounts.clear();

    const gameModeName = this.getGameModeName(this.currentGameMode);
    this.currentGameModeName.set(gameModeName);

    // A rejected transition must not leave a generated film sitting behind an
    // inactive/ended FSM. The caller can remain in the lobby and try again.
    if (!this.stateMachine.transition(GameState.Starting)) return;

    // Thread the reel and seed the audience before the house-lights beat. The
    // showtime clock is FSM-bound, so it remains parked at frame zero until
    // Playing begins; meanwhile the room can settle instead of flashing from
    // an empty auditorium to a populated one after the delay.
    this.filmShowtime.startShow(this.runtimeForMode(this.currentGameMode));

    this.timers.setTimeout(
      'gameStart',
      () => {
        if (this.gameState() !== GameState.Starting) return;
        this.stateMachine.transition(GameState.Playing);
        this.showStartHint.set(false);
        this.filmScore.start();

        this.startPowerUpRuntime();

        // Ensure power-ups are displayed after component initialization.
        // Keep this in the shared timer registry so route teardown cancels it.
        this.timers.setTimeout('powerUpNotification', () => this.powerUpLifecycle.notifyPowerUpsChanged(), 100);

        // Sync seat movement service with current game mode before starting
        this.seatMovementService.setGameMode(this.currentGameMode);

        // Start game mode using Strategy Pattern
        const gameMode = this.gameModes.get(this.currentGameMode);
        if (gameMode) {
          gameMode.start();
        } else {
          // Fallback to classic mode
          this.selectRandomSeatForGame();
          this.startGameTimer();
        }

        this.startAutoSave();
        // The instruction card owns this short pre-show beat. Keeping the delay
        // in DisposableTimer makes it cancellable during SPA route teardown.
      },
      GAME_START_DELAY_MS
    );
  }

  private startPowerUpRuntime(): void {
    this.powerUpLifecycle.setCurrentGameMode(this.currentGameMode);
    this.powerUpLifecycle.updatePermanentPowerUps();
    this.powerUpLifecycle.startPassiveIncome();
    this.powerUpLifecycle.startAutoClicker();
    this.powerUpLifecycle.startTicketStorm();
  }

  private startAutoSave(): void {
    this.stopAutoSave();
    // Checkpoint every 30 seconds during active gameplay
    this.autoSaveSubscription = timer(GAME_MECHANICS.AUTO_SAVE_INTERVAL, GAME_MECHANICS.AUTO_SAVE_INTERVAL).subscribe(
      () => {
        if (this.gameState() === GameState.Playing) {
          this.saveGameState();
        }
      }
    );
  }

  private stopAutoSave(): void {
    if (this.autoSaveSubscription) {
      this.autoSaveSubscription.unsubscribe();
      this.autoSaveSubscription = null;
    }
  }

  private getGameModeName(mode: GameMode): string {
    const gameMode = this.gameModes.get(mode);
    return gameMode ? gameMode.getName() : 'Classic Mode';
  }

  private showMemorySequence(): void {
    const sequenceLength = Math.min(3 + Math.floor(this.theaterService.getClickedCount() / 2), 10);
    this.memorySequence = [];

    // Building the sequence borrows the shared picker; snapshot its no-repeat
    // bookkeeping so the build does not bleed into the next round's selection.
    const savedPreviousSeat = this.theaterService.previousActiveSeat;
    for (let i = 0; i < sequenceLength; i++) {
      const seat = this.theaterService.getRandomSeat();
      if (seat) {
        this.memorySequence.push(seat);
      }
    }
    this.theaterService.previousActiveSeat = savedPreviousSeat;

    if (this.memorySequence.length === 0) {
      this.endGame();
      return;
    }

    let index = 0;
    const showNext = (): void => {
      if (index < this.memorySequence.length) {
        this.theaterService.setActiveSeat(this.memorySequence[index]);
        this.timers.setTimeout(
          'memoryShow',
          () => {
            this.theaterService.setActiveSeat(null);
            index++;
            this.timers.setTimeout('memoryGap', showNext, 500);
          },
          1000
        );
      } else {
        this.memoryPlayerIndex = 0;
        this.timer.set(30);
        this.startGameTimer(30);
      }
    };
    showNext();
  }

  private scheduleBlackouts(): void {
    this.timers.clearInterval('blackout');

    this.timers.setInterval(
      'blackout',
      () => {
        if (this.gameState() === GameState.Playing && this.currentGameMode === GameMode.Midnight) {
          this.powerUpEventsService.triggerBlackout(SPECIAL_EFFECTS.BLACKOUT_DURATION);
        }
      },
      SPECIAL_EFFECTS.BLACKOUT_INTERVAL
    );
  }

  endGame(): void {
    const state = this.gameState();
    if (state !== GameState.Playing && state !== GameState.Paused) {
      return;
    }

    // Order matters: onExit(Playing) fires during transition() and stops the film clock.
    // endShow() then clears film state (currentFilm → null, filmSecond → 0).
    // Nothing between these two calls may rely on currentFilm being non-null.
    if (!this.stateMachine.transition(GameState.Ended)) {
      return;
    }
    this.filmShowtime.endShow();
    this.clearGameRound();
    // Clear auto-save checkpoint so completed games don't show as paused
    this.storageService.clearPausedGameState();
    this.filmScore.stop();
    this.soundService.play(SoundType.GameOver);

    const ticketsEarned = this.scoringService.getScore();
    this.coinsEarned.set(ticketsEarned);
    // The crowd's mood claps back a separate, hard-capped coin bonus. It goes
    // straight to the balance, never through saveGameResults, so it cannot
    // inflate the high score, the per-mode earnings, or the sqrt XP curve.
    const appBonus = applauseBonus(ticketsEarned, this.audienceService.mood());
    this.appBonusEarned.set(appBonus);
    if (appBonus > 0) {
      this.storageService.addCoins(appBonus);
    }
    this.flushPowerUpTriggerCounts();

    const xpMultiplier = this.progressionService.getXPMultiplier(this.currentGameMode);
    // Square-root scaling keeps levels meaningful as ticket totals inflate.
    const xpEarned = Math.max(1, Math.floor(Math.sqrt(ticketsEarned) * XP_FROM_TICKETS_SQRT_FACTOR * xpMultiplier));
    this.progressionService.awardXP(xpEarned);

    const isNewBest = this.saveGameResults(ticketsEarned);
    this.isNewHighScore.set(isNewBest);
    if (isNewBest) {
      // Reuse the existing achievement-unlock sting rather than adding new
      // synth code — beating your best is the same class of moment. Delayed
      // past GameOver's own ring time so the two cues don't pile up on top
      // of each other.
      this.soundService.play(SoundType.LevelUp, GAME_OVER_RING_SECONDS);
    }

    // Every achievement check below can unlock in this same call — most
    // plausibly on a brand-new player's first scoring round (GameOver +
    // first_game both fire here). Stagger their sting the same distance past
    // GameOver, plus a bit more when the high-score sting is also playing at
    // that mark, so nothing piles up. See GAME_OVER_RING_SECONDS's doc.
    const achievementStingDelay =
      GAME_OVER_RING_SECONDS + (isNewBest ? POST_ROUND_ACHIEVEMENT_STING_OFFSET_SECONDS : 0);

    this.achievementsService.checkAchievement('first_game', undefined, achievementStingDelay);
    this.achievementsService.checkAchievement('score_100', ticketsEarned, achievementStingDelay);
    this.achievementsService.checkAchievement('score_500', ticketsEarned, achievementStingDelay);
    this.achievementsService.checkAchievement('score_1000', ticketsEarned, achievementStingDelay);

    if (this.currentGameMode === GameMode.Memory && this.memoryPlayerIndex > 3) {
      this.achievementsService.checkAchievement('perfect_memory', undefined, achievementStingDelay);
    }

    if (this.currentGameMode === GameMode.Endless && ticketsEarned > 500) {
      this.achievementsService.checkAchievement('endless_warrior', undefined, achievementStingDelay);
    }

    this.checkAllModesAchievement(achievementStingDelay);

    const data = this.storageService.loadGameData();
    this.achievementsService.updateProgress('coin_collector', data.coins || 0, achievementStingDelay);
    this.achievementsService.updateProgress('game_master', data.totalGamesPlayed || 0, achievementStingDelay);
  }

  pauseGame(): void {
    if (this.gameState() === GameState.Playing) {
      this.stateMachine.transition(GameState.Paused);
      this.stopGameTimer();
      this.clearSeatMovement();
      this.filmScore.stop();
    }
  }

  /**
   * Call before scheduling the deferred resumeFromSavedState() so the
   * pause-exit affordances cannot race the rebuild. Cleared by
   * resumeFromSavedState() itself once it settles.
   */
  markResumePending(): void {
    this.isResumePending.set(true);
  }

  resumeGame(): void {
    if (this.isResumePending()) return;
    if (this.gameState() === GameState.Paused) {
      this.concessionCache.refresh();
      this.stateMachine.transition(GameState.Playing);
      this.startGameTimer(this.remainingTime);
      this.seatMovementService.startSeatMovement();
      this.filmScore.start();

      // Re-notify power-ups when resuming
      this.powerUpLifecycle.notifyPowerUpsChanged();
    }
  }

  /**
   * Pause the game, persist a checkpoint, and stop the 30s auto-save interval.
   *
   * GameService is `providedIn: 'root'`, so `ngOnDestroy` only fires on full
   * app teardown — never on SPA route-leave. Without this method, navigating
   * away mid-Playing leaves the auto-save subscription ticking forever and
   * the FSM stuck in Playing, producing a stale paused-checkpoint that
   * misleads the lobby's Resume button on next theater visit.
   *
   * Idempotent: guarded by gameState() === Playing.
   */
  pauseAndCheckpoint(): void {
    if (this.gameState() === GameState.Playing) {
      this.pauseGame();
      this.flushPowerUpTriggerCounts();
      this.saveGameState();
      this.stopAutoSave();
    }
  }

  /**
   * Stop every root-scoped game runtime when the Theater route unmounts.
   *
   * A Playing round is checkpointed before cleanup. A Starting round has not
   * begun and is simply cancelled. Resetting the FSM matters because this
   * service survives SPA navigation and a later resume must start from a clean
   * Inactive state.
   */
  prepareForRouteLeave(): void {
    const state = this.gameState();

    if (state === GameState.Playing) {
      this.pauseGame();
      this.flushPowerUpTriggerCounts();
      this.saveGameState();
    } else if (state === GameState.Paused) {
      this.flushPowerUpTriggerCounts();
      this.saveGameState();
    }

    this.filmShowtime.endShow();
    this.clearGameRound();
    this.filmScore.stop();

    if (this.gameState() !== GameState.Inactive) {
      this.stateMachine.reset();
    }

    // If the route unmounts before the deferred resumeFromSavedState() fires
    // (its scheduleTimer is cancelled by TheaterComponent's own destroy hook),
    // that settle-point never runs. Clear defensively so the flag cannot leak
    // into a later mount and permanently block resumeGame()/openLobby().
    this.isResumePending.set(false);
  }

  /**
   * Persist round results and report whether this run beat the stored best
   * for the current mode.
   *
   * The comparison reads the previous best BEFORE it is overwritten. A mode
   * played for the first time has no prior entry, so `previousBest` is 0 —
   * the same default `saveGameData` would have used for `highScore` — which
   * means a scoreless first run (0 tickets) is not flagged as a new best,
   * but any positive first-run score is.
   */
  private saveGameResults(ticketsEarned: number): boolean {
    try {
      const data = this.storageService.loadGameData();

      this.storageService.addCoins(ticketsEarned);
      this.storageService.incrementGamesPlayed();

      if (!data.gameModes) {
        data.gameModes = [];
      }

      let modeData = data.gameModes.find((m: SavedGameMode) => m.id === (this.currentGameMode as string));
      if (!modeData) {
        modeData = {
          id: this.currentGameMode,
          unlocked: true,
          highScore: 0,
        };
        data.gameModes.push(modeData);
      }

      const finalScore = this.scoringService.getScore();
      const previousBest = modeData.highScore || 0;
      const isNewBest = finalScore > previousBest;

      modeData.highScore = Math.max(previousBest, finalScore);
      modeData.gamesPlayed = (modeData.gamesPlayed ?? 0) + 1;
      modeData.totalEarnings = (modeData.totalEarnings ?? 0) + ticketsEarned;
      modeData.bestMultiplier = Math.max(modeData.bestMultiplier ?? 0, this.scoringService.getMultiplier());

      this.storageService.saveGameData({ gameModes: data.gameModes });
      return isNewBest;
    } catch (error) {
      if (!environment.production) {
        console.error('Failed to save game results:', error);
      }
      return false;
    }
  }

  private startGameTimer(startTime?: number): void {
    this.stopGameTimer();

    const timeToUse = Math.floor(startTime ?? Math.max(5, 10 - this.theaterService.getClickedCount() * 0.15));
    this.timer.set(timeToUse);
    this.remainingTime = timeToUse;

    if (timeToUse < 0) {
      return;
    }

    this.gameTimerSubscription = timer(0, 1000).subscribe({
      next: (tickCount) => {
        if (tickCount > 0) {
          this.remainingTime = Math.max(0, this.remainingTime - 1);
        }
        this.timer.set(this.remainingTime);
        if (this.remainingTime === 0) {
          this.endGame();
        }
      },
      error: () => this.endGame(),
    });
  }

  private stopGameTimer(): void {
    if (this.gameTimerSubscription) {
      this.gameTimerSubscription.unsubscribe();
      this.gameTimerSubscription = null;
    }
  }

  private clearGameRound(): void {
    this.clearSeatMovement();
    this.stopGameTimer();
    this.stopAutoSave();
    this.timers.clearAll();
    this.timer.set(0);
    this.theaterService.setActiveSeat(null);
    this.theaterService.selectedSeat.set(null);
    this.theaterService.resetClickedCount();
    this.seatMovementService.setCarnivalMode(false);
    this.powerUpLifecycle.clearAll();
  }

  private selectRandomSeatForGame(startTimer = true): void {
    // The target is usually a seated patron, so catching it reads as ushering a
    // restless guest rather than a blind reflex hit. Falls back to any seat when
    // the crowd is sparse; Memory mode builds its own sequence and is unaffected.
    const seat = this.theaterService.getRandomSeat((s) =>
      this.audienceService.isOccupied(s.side, s.rowIndex, s.seatIndex)
    );
    if (seat) {
      this.theaterService.setActiveSeat(seat);
      if (startTimer && !UNTIMED_GAME_MODES.has(this.currentGameMode)) {
        this.startGameTimer();
      } else if (UNTIMED_GAME_MODES.has(this.currentGameMode)) {
        // -1 is the durable/display sentinel for a no-clock round. Keep the
        // backing remainingTime in sync so pause/resume cannot resurrect the
        // per-seat countdown that used to end Finale after ten seconds.
        this.startGameTimer(-1);
      }
      this.seatMovementService.startSeatMovement();
    }
  }

  processGameSelection(seat: Seat): void {
    this.clearSeatMovement();
    this.theaterService.incrementClickedCount();
    this.scoringService.updateMultiplier(seat);

    this.consecutiveHits++;

    const now = Date.now();
    this.rapidClickTimestamps.push(now);
    this.rapidClickTimestamps = this.rapidClickTimestamps.filter((time) => now - time <= 5000);

    if (this.rapidClickTimestamps.length >= 10) {
      this.achievementsService.checkAchievement('speed_demon');
    }

    if (this.consecutiveHits >= 200) {
      this.achievementsService.checkAchievement('no_miss');
    }

    const basePoints = this.scoringService.calculateBasePoints(seat);
    const goldenPopcornMultiplier = Math.pow(
      POWER_UP_FORMULAS.TICKET_MULTIPLIER_BASE,
      effectivePowerUpLevel('ticketMultiplier', this.powerUpLifecycle.getConcessionsOwned('ticketMultiplier'))
    );
    const luckyStreakChance = Math.min(
      POWER_UP_FORMULAS.LUCKY_STREAK_BASE_CHANCE +
        this.powerUpLifecycle.getConcessionsOwned('luckyStreak') * POWER_UP_FORMULAS.LUCKY_STREAK_PER_LEVEL,
      POWER_UP_FORMULAS.LUCKY_STREAK_MAX_CHANCE
    );
    const seatUpgradeOwned = effectivePowerUpLevel(
      'seatUpgrade',
      this.powerUpLifecycle.getConcessionsOwned('seatUpgrade')
    );
    const criticalHitOwned = this.powerUpLifecycle.getConcessionsOwned('criticalHit');

    const {
      points: ticketsEarned,
      wasLucky,
      wasCritical,
    } = this.scoringService.calculateFinalPoints(basePoints, {
      multiplier: this.scoringService.getMultiplier(),
      goldenPopcornMultiplier,
      luckyStreakChance,
      doublePointsActive: this.powerUpLifecycle.isDoublePointsActive(),
      seatUpgradeBonus: seatUpgradeOwned > 0 ? POWER_UP_FORMULAS.SEAT_UPGRADE_BONUS_PER_LEVEL * seatUpgradeOwned : 0,
      criticalHitChance:
        criticalHitOwned > 0
          ? Math.min(
              POWER_UP_FORMULAS.CRITICAL_HIT_BASE_CHANCE + criticalHitOwned * POWER_UP_FORMULAS.CRITICAL_HIT_PER_LEVEL,
              POWER_UP_FORMULAS.CRITICAL_HIT_MAX_CHANCE
            )
          : 0,
      criticalHitMultiplier: GAME_MECHANICS.CRITICAL_HIT_MULTIPLIER,
    });

    if (wasLucky || wasCritical) {
      this.soundService.playPreset('pickupCoin');
      if (wasLucky) this.incrementPowerUpTrigger('luckyStreak');
      if (wasCritical) this.incrementPowerUpTrigger('criticalHit');
    }

    if (this.powerUpLifecycle.isDoublePointsActive()) {
      this.powerUpLifecycle.decrementPowerUp('doublePoints');
    }

    this.scoringService.addScore(ticketsEarned);
    // A caught seat pleases the house; the mood it builds pays out at the credits.
    this.audienceService.registerHit();

    if (this.currentGameMode === GameMode.Endless) {
      this.seatMovementService.setEndlessSpeedMultiplier(
        Math.min(
          POWER_UP_FORMULAS.ENDLESS_MAX_SPEED,
          1 + this.theaterService.getClickedCount() * POWER_UP_FORMULAS.ENDLESS_SPEED_INCREMENT
        )
      );
    }

    this.selectRandomSeatForGame();

    // Hot Streak (comboMaster): extend timer AFTER selectRandomSeatForGame sets the new timer.
    // Must come after because startGameTimer() overwrites remainingTime from its formula.
    const comboMasterOwned = this.powerUpLifecycle.getConcessionsOwned('comboMaster');
    if (comboMasterOwned > 0 && !UNTIMED_GAME_MODES.has(this.currentGameMode)) {
      const bonusSeconds = Math.min(comboMasterOwned, POWER_UP_FORMULAS.COMBO_MASTER_MAX_BONUS_SECONDS);
      // The ceiling guarantees every round ends; uncapped extension made
      // long runs mathematically unendable.
      this.startGameTimer(Math.min(this.remainingTime + bonusSeconds, POWER_UP_FORMULAS.MAX_ROUND_TIMER_SECONDS));
    }
  }

  private handleSeatSelection(seat: Seat): void {
    if (this.gameState() !== GameState.Playing) {
      return;
    }

    if (this.currentGameMode === GameMode.Memory) {
      this.handleMemoryModeSelection(seat);
      return;
    }

    const activeSeat = this.theaterService.getActiveSeat();

    if (
      activeSeat &&
      activeSeat.side === seat.side &&
      activeSeat.seatIndex === seat.seatIndex &&
      activeSeat.rowIndex === seat.rowIndex
    ) {
      const seatData = this.getSeatData(activeSeat);
      if (seatData) {
        this.processGameSelection(seatData);

        // Single sound per click — combo sound evolves with streak, provides all feedback
        this.soundService.playComboSound(this.consecutiveHits, this.scoringService.getMultiplier());
      }
    } else if (this.currentGameMode === GameMode.Endless) {
      // Wrong click in endless mode = game over with dissonant sound
      this.soundService.playWrongClick();
      this.endGame();
    } else {
      // Wrong click in other modes - reset combo with dissonant sound
      this.soundService.playWrongClick();
      this.consecutiveHits = 0;
    }
  }

  private handleMemoryModeSelection(seat: Seat): void {
    const expectedSeat = this.memorySequence[this.memoryPlayerIndex];

    if (
      expectedSeat &&
      expectedSeat.side === seat.side &&
      expectedSeat.seatIndex === seat.seatIndex &&
      expectedSeat.rowIndex === seat.rowIndex
    ) {
      // Correct memory sequence
      this.soundService.playComboSound(this.memoryPlayerIndex + 1, 1);
      this.soundService.playSeatSound(seat, 'success', this.getTotalRows(), this.getSeatsPerRow());
      this.scoringService.addScore(5);
      this.memoryPlayerIndex++;

      if (this.memoryPlayerIndex >= this.memorySequence.length) {
        // Completed sequence - play level up preset
        this.soundService.playPreset('powerUp');
        this.theaterService.incrementClickedCount();
        this.timers.setTimeout(
          'memoryNextRound',
          () => {
            this.showMemorySequence();
          },
          1000
        );
      }
    } else {
      // Wrong sequence - game over with dissonant sound
      this.soundService.playWrongClick();
      this.endGame();
    }
  }

  private getSeatData(activeSeat: SeatPosition): Seat | null {
    const seatsData = this.theaterService.getSeatsData();

    const row = seatsData[activeSeat.rowIndex - 1];
    if (!row) return null;

    const sideSeats = activeSeat.side === 'left' ? row.leftSeats : row.rightSeats;
    if (!sideSeats || sideSeats.length === 0) return null;

    const seat = sideSeats[activeSeat.seatIndex - 1];
    return seat ? seat : null;
  }

  clearSeatMovement(): void {
    this.seatMovementService.clearSeatMovement();
  }

  activatePowerUp(powerUpId: string): void {
    this.powerUpLifecycle.activatePowerUp(powerUpId);
  }

  getActivePowerUps(): Map<string, number> {
    return this.powerUpLifecycle.getActivePowerUps();
  }

  getCurrentGameState(): GameState {
    return this.gameState();
  }

  resetToInactive(): void {
    this.stateMachine.reset();
  }

  getCurrentGameTickets(): number {
    if (this.gameState() === GameState.Playing || this.gameState() === GameState.Paused) {
      return this.scoringService.getScore();
    }
    return 0;
  }

  saveGameState(): void {
    if (this.gameState() === GameState.Paused || this.gameState() === GameState.Playing) {
      // Memory checkpoints need the reveal/input phase and sequence cursor to
      // resume honestly. Until that state is serialized, do not advertise a
      // checkpoint that would end on the player's next selection.
      if (this.currentGameMode === GameMode.Memory) {
        this.storageService.clearPausedGameState();
        return;
      }

      const gameState: PausedGameState = {
        mode: this.currentGameMode,
        score: this.scoringService.getScore(),
        multiplier: this.scoringService.getMultiplier(),
        timer: this.timer(),
        remainingTime: this.timer(),
        clickedCount: this.theaterService.getClickedCount(),
        activePowerUps: Array.from(this.powerUpLifecycle.getActivePowerUps().entries()),
        doublePointsActive: this.powerUpLifecycle.isDoublePointsActive(),
        slowTimeActive: this.powerUpLifecycle.isSlowTimeActive(),
        timestamp: Date.now(),
      };
      this.storageService.savePausedGameState(gameState);
    }
  }

  hasPausedGame(): boolean {
    return this.storageService.hasPausedGame();
  }

  getPausedGameMode(): string | null {
    return this.storageService.getPausedGameMode();
  }

  /**
   * Clears isResumePending on every exit path (success, rejected checkpoint,
   * and the caught-failure path) via the outer finally — see the field's
   * doc comment for why this guard exists.
   */
  resumeFromSavedState(): boolean {
    try {
      const state = this.storageService.loadPausedGameState();
      if (!state) {
        return false;
      }

      const mode = this.parseGameMode(state.mode);
      if (!mode || !RESUMABLE_GAME_MODES.has(mode)) {
        // Old Memory/unknown checkpoints cannot be resumed faithfully. Remove
        // them and return to the lobby instead of presenting a broken round.
        this.abortResumeAttempt();
        this.storageService.clearPausedGameState();
        return false;
      }

      try {
        this.concessionCache.refresh();

        // A checkpoint can be resumed either in-place from Paused or after the
        // root service survived route navigation. Clear dormant runtime pieces
        // first, then rebuild them from the checkpoint as one transaction.
        this.abortResumeAttempt();

        this.currentGameMode = mode;
        this.currentGameModeName.set(this.getGameModeName(mode));
        this.scoringService.setScore(state.score);
        this.scoringService.setMultiplier(state.multiplier);
        this.theaterService.restoreClickedCount(state.clickedCount);
        const restoredTimer = UNTIMED_GAME_MODES.has(mode) ? -1 : state.timer;
        this.timer.set(restoredTimer);
        this.remainingTime = restoredTimer;
        this.powerUpLifecycle.restoreState(
          new Map(state.activePowerUps),
          state.doublePointsActive,
          state.slowTimeActive
        );
        this.seatMovementService.setGameMode(mode);
        this.seatMovementService.setSlowTimeActive(state.slowTimeActive);
        this.coinsEarned.set(0);
        this.appBonusEarned.set(0);
        this.isNewHighScore.set(false);
        this.rapidClickTimestamps = [];
        this.consecutiveHits = state.clickedCount;
        this.pendingTriggerCounts.clear();

        this.filmShowtime.startShow(this.runtimeForMode(mode));
        if (!this.stateMachine.transition(GameState.Playing)) {
          throw new Error('Could not enter Playing while resuming checkpoint');
        }
        this.filmScore.start();
        this.restoreModeRuntime(mode, state.clickedCount);
        this.selectRandomSeatForGame(false);
        this.startGameTimer(restoredTimer);
        this.startPowerUpRuntime();
        this.powerUpLifecycle.notifyPowerUpsChanged();
        this.startAutoSave();

        // Commit only after every runtime system has started successfully. Any
        // exception above leaves the durable checkpoint available for retry.
        this.storageService.clearPausedGameState();
        return true;
      } catch {
        this.abortResumeAttempt();
        return false;
      }
    } finally {
      this.isResumePending.set(false);
    }
  }

  private parseGameMode(mode: string): GameMode | null {
    return Object.values(GameMode).includes(mode as GameMode) ? (mode as GameMode) : null;
  }

  private restoreModeRuntime(mode: GameMode, clickedCount: number): void {
    if (mode === GameMode.Midnight) {
      this.scheduleBlackouts();
    } else if (mode === GameMode.Carnival) {
      this.seatMovementService.setCarnivalMode(true);
    } else if (mode === GameMode.Endless) {
      this.seatMovementService.setEndlessSpeedMultiplier(
        Math.min(POWER_UP_FORMULAS.ENDLESS_MAX_SPEED, 1 + clickedCount * POWER_UP_FORMULAS.ENDLESS_SPEED_INCREMENT)
      );
    } else if (mode === GameMode.Finale) {
      this.seatMovementService.setEndlessSpeedMultiplier(GAME_MECHANICS.ENDLESS_BASE_SPEED);
    }
  }

  private abortResumeAttempt(): void {
    this.filmShowtime.endShow();
    this.clearGameRound();
    this.filmScore.stop();
    this.scoringService.reset();
    this.audienceService.reset();
    this.currentGameModeName.set('');
    this.coinsEarned.set(0);
    this.appBonusEarned.set(0);
    this.isNewHighScore.set(false);
    this.rapidClickTimestamps = [];
    this.consecutiveHits = 0;
    this.pendingTriggerCounts.clear();
    if (this.gameState() !== GameState.Inactive) {
      this.stateMachine.reset();
    }
  }

  public getPulseLevel(pointsScored: number): number {
    return this.scoringService.getPulseLevel(pointsScored);
  }

  public updateCursorPosition(x: number, y: number): void {
    this.seatMovementService.updateCursorPosition(x, y);
  }

  private checkAllModesAchievement(delaySeconds = 0): void {
    const data = this.storageService.loadGameData();
    if (data.gameModes) {
      const modesPlayed = data.gameModes.filter((m: SavedGameMode) => (m.highScore || 0) > 0);
      if (modesPlayed.length >= 4) {
        this.achievementsService.checkAchievement('all_modes', undefined, delaySeconds);
      }
    }
  }

  /**
   * Get total number of rows in theater
   */
  private getTotalRows(): number {
    const seatsData = this.theaterService.getSeatsData();
    return seatsData.length;
  }

  /**
   * Get number of seats per row
   */
  private getSeatsPerRow(): number {
    const seatsData = this.theaterService.getSeatsData();
    if (seatsData.length > 0) {
      return seatsData[0].leftSeats.length + seatsData[0].rightSeats.length;
    }
    return 12; // Default fallback
  }

  /**
   * Accumulate power-up trigger counts in memory (flushed on game end)
   */
  private incrementPowerUpTrigger(powerUpId: string): void {
    this.pendingTriggerCounts.set(powerUpId, (this.pendingTriggerCounts.get(powerUpId) ?? 0) + 1);
  }

  /**
   * Flush accumulated trigger counts to storage (called on game end)
   */
  private flushPowerUpTriggerCounts(): void {
    if (this.pendingTriggerCounts.size === 0) return;
    const data = this.storageService.loadGameData();
    for (const [id, count] of this.pendingTriggerCounts) {
      const powerUp = data.powerUps?.find((p) => p.id === id);
      if (powerUp) {
        powerUp.timesTriggered = (powerUp.timesTriggered ?? 0) + count;
      }
    }
    this.storageService.saveGameData({ powerUps: data.powerUps });
    this.pendingTriggerCounts.clear();
  }

  /**
   * Map a game mode to its fixed runtime in seconds.
   *
   * Timed modes use their configured GAME_DURATIONS value. Infinite modes
   * (endless, finale) and classic (per-seat timer, no fixed total) use
   * INFINITE_MODE_RUNTIME so the film generator has a meaningful runtime.
   */
  private runtimeForMode(mode: GameMode): number {
    switch (mode) {
      case GameMode.TimeAttack:
        return GAME_DURATIONS.timeAttack;
      case GameMode.Midnight:
        return GAME_DURATIONS.midnight;
      case GameMode.Carnival:
        return GAME_DURATIONS.carnival;
      case GameMode.Memory:
        return GAME_DURATIONS.memory;
      default:
        // Classic, Endless, Finale — use the shared infinite-mode runtime.
        return INFINITE_MODE_RUNTIME;
    }
  }
}
