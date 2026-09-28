import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { CommonModule } from '@angular/common';
import { TheaterComponent } from './theater.component';
import { Seat, SeatPosition, TheaterService } from './theater.service';
import { GAME_START_DELAY_MS, GameService, GameState } from './game.service';
import { SoundService } from './sound.service';
import { Achievement, AchievementsService } from './achievements.service';
import { ThemeService } from '@services/theme.service';
import { ScrollLockService } from '@services/scroll-lock.service';
import { StorageService } from './services/storage.service';
import { ScoringService } from './services/scoring.service';
import { ProgressionService } from './services/progression.service';
import { GameStateMachineService } from './services/game-state-machine.service';
import { ConcessionCacheService } from './services/concession-cache.service';
import { SeatMovementService } from './services/seat-movement.service';
import { PowerUpLifecycleService } from './services/power-up-lifecycle.service';
import { FilmScoreService } from './film/film-score.service';
import { CUSTOM_ELEMENTS_SCHEMA, signal, WritableSignal } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';

describe('TheaterComponent', () => {
  let component: TheaterComponent;
  let fixture: ComponentFixture<TheaterComponent>;
  let theaterServiceSpy: jasmine.SpyObj<TheaterService>;
  let gameServiceSpy: jasmine.SpyObj<GameService>;
  let soundServiceSpy: jasmine.SpyObj<SoundService>;
  let scrollLockSpy: jasmine.SpyObj<ScrollLockService>;
  let isDayModeSubject: BehaviorSubject<boolean>;

  let gameStateSignal: ReturnType<typeof signal<GameState>>;
  let scoreSignal: ReturnType<typeof signal<number>>;
  let activeSeatSignal: WritableSignal<SeatPosition | null>;
  let achievementUnlockedSignal: WritableSignal<Achievement | null>;

  beforeEach(async () => {
    gameStateSignal = signal<GameState>(GameState.Inactive);
    scoreSignal = signal(0);
    activeSeatSignal = signal<SeatPosition | null>(null);
    achievementUnlockedSignal = signal<Achievement | null>(null);
    isDayModeSubject = new BehaviorSubject<boolean>(false);

    const theaterSpy = jasmine.createSpyObj(
      'TheaterService',
      [
        'getSeatsData',
        'setActiveSeat',
        'clearHover',
        'resetClickedCount',
        'attractSeatsToPosition',
        'hoverSeat',
        'selectSeat',
      ],
      {
        activeSeat: activeSeatSignal,
        hoverEvent$: of(null),
        selectedSeat: signal(null),
        seatsData: signal([]),
      }
    );

    const gameSpy = jasmine.createSpyObj(
      'GameService',
      [
        'setGameMode',
        'startGame',
        'endGame',
        'pauseGame',
        'resumeGame',
        'resumeFromSavedState',
        'markResumePending',
        'getCurrentGameState',
        'activatePowerUp',
        'applyMagneticField',
        'saveGameState',
        'hasPausedGame',
        'resetToInactive',
        'updateCursorPosition',
        'pauseAndCheckpoint',
        'prepareForRouteLeave',
      ],
      {
        gameState: gameStateSignal,
        score: scoreSignal,
        timer: signal(0),
        multiplier: signal(1),
        currentLevel: signal(1),
        totalXP: signal(0),
        coinsEarned: signal(0),
        currentGameModeName: signal(''),
        activePowerUpsSignal: signal(new Map()),
        usherCooldown: signal(0),
        usherReady: signal(true),
        theaterBlackout$: of(null),
        isResumePending: signal(false),
      }
    );

    const soundSpy = jasmine.createSpyObj('SoundService', ['toggleMute', 'playChairSound'], {
      isSoundMuted: false,
    });

    const themeSpy = jasmine.createSpyObj('ThemeService', ['toggleDayMode', 'setDayMode'], {
      isDayMode$: isDayModeSubject.asObservable(),
    });

    const achievementsSpy = jasmine.createSpyObj('AchievementsService', ['getUnlockedCount', 'getTotalCount'], {
      achievements: signal<Achievement[]>([]),
      achievementUnlocked: achievementUnlockedSignal,
    });

    const scrollLockSpyInstance = jasmine.createSpyObj('ScrollLockService', ['lock', 'unlock', 'isLocked']);
    const storageSpyInstance = jasmine.createSpyObj('StorageService', ['loadGameData'], {
      storageQuotaExceeded: signal(false),
    });

    await TestBed.configureTestingModule({
      imports: [TheaterComponent],
      providers: [
        { provide: TheaterService, useValue: theaterSpy },
        { provide: GameService, useValue: gameSpy },
        { provide: SoundService, useValue: soundSpy },
        { provide: ThemeService, useValue: themeSpy },
        { provide: AchievementsService, useValue: achievementsSpy },
        { provide: ScrollLockService, useValue: scrollLockSpyInstance },
        { provide: StorageService, useValue: storageSpyInstance },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(TheaterComponent, {
        set: { imports: [CommonModule], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(TheaterComponent);
    component = fixture.componentInstance;
    theaterServiceSpy = TestBed.inject(TheaterService) as jasmine.SpyObj<TheaterService>;
    gameServiceSpy = TestBed.inject(GameService) as jasmine.SpyObj<GameService>;
    gameServiceSpy.resumeFromSavedState.and.returnValue(true);
    soundServiceSpy = TestBed.inject(SoundService) as jasmine.SpyObj<SoundService>;
    scrollLockSpy = TestBed.inject(ScrollLockService) as jasmine.SpyObj<ScrollLockService>;

    const createSeat = (row: number, seat: number, side: 'left' | 'right'): Seat => ({
      rowIndex: row,
      seatIndex: seat,
      side: side,
      showSoda: false,
      showPopcorn: false,
    });

    theaterServiceSpy.getSeatsData.and.returnValue([
      {
        rowIndex: 1,
        seatsPerRow: 4,
        leftSeats: [createSeat(1, 1, 'left'), createSeat(1, 2, 'left')],
        rightSeats: [createSeat(1, 1, 'right'), createSeat(1, 2, 'right')],
      },
    ]);
    gameServiceSpy.hasPausedGame.and.returnValue(false);
    gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Inactive);
  });

  describe('Component Initialization', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should initialize with lobby shown', () => {
      fixture.detectChanges();
      expect(component.showLobby()).toBe(true);
    });

    it('should expose seats data via the theater service signal', () => {
      fixture.detectChanges();
      expect(component.theaterService.seatsData()).toBeDefined();
    });

    it('should expose GameState enum to template', () => {
      expect(component.GameState).toBe(GameState);
    });

    it('should mirror themeService.isDayMode$ via toSignal()', () => {
      fixture.detectChanges();
      expect(component.isDayMode()).toBe(false);
      isDayModeSubject.next(true);
      fixture.detectChanges();
      expect(component.isDayMode()).toBe(true);
    });

    it('renders a visually-hidden h1 with the project title (projects-detail unmounts its own on demo launch)', () => {
      fixture.detectChanges();
      const h1 = (fixture.nativeElement as HTMLElement).querySelector('h1.sr-only');
      expect(h1?.textContent?.trim()).toBe('Funtime Theater');
    });
  });

  describe('Game State Management', () => {
    it('should handle game state changes', () => {
      fixture.detectChanges();

      gameStateSignal.set(GameState.Playing);
      expect(component.gameService.gameState()).toBe(GameState.Playing);

      gameStateSignal.set(GameState.Paused);
      expect(component.gameService.gameState()).toBe(GameState.Paused);

      gameStateSignal.set(GameState.Ended);
      expect(component.gameService.gameState()).toBe(GameState.Ended);
    });

    it('should update score from game service', () => {
      fixture.detectChanges();

      scoreSignal.set(100);
      expect(component.gameService.score()).toBe(100);

      scoreSignal.set(250);
      expect(component.gameService.score()).toBe(250);
    });
  });

  describe('Seat Click Handling', () => {
    beforeEach(() => {
      fixture.detectChanges();
    });

    it('should handle seat selection when game is active', () => {
      gameStateSignal.set(GameState.Playing);
      const event = { seat: { rowIndex: 1, seatIndex: 1, side: 'left' } as unknown as Seat };

      component.handleSeatSelection(event);

      expect(theaterServiceSpy.selectSeat).toHaveBeenCalledWith(event.seat);
    });

    it('does not carry keyboard-follow intent into a later pointer-started game', fakeAsync(() => {
      const caughtSeat: Seat = {
        rowIndex: 1,
        seatIndex: 1,
        side: 'left',
        showSoda: false,
        showPopcorn: false,
      };
      const nextTarget = document.createElement('div');
      nextTarget.className = 'seat-wrapper';
      nextTarget.setAttribute('aria-current', 'true');
      (fixture.nativeElement as HTMLElement).appendChild(nextTarget);
      const focusSpy = spyOn(nextTarget, 'focus');

      component.showLobby.set(false);
      activeSeatSignal.set(caughtSeat);
      fixture.detectChanges();
      component.handleSeatSelection({ seat: caughtSeat, interaction: 'keyboard' });

      // The game-ending path clears the active seat before it can publish a
      // successor. A later mouse start must not inherit this catch's intent.
      activeSeatSignal.set(null);
      fixture.detectChanges();
      component.onEnterTheater({ gameMode: 'classic', focusInitialTarget: false });
      activeSeatSignal.set({ side: 'right', rowIndex: 1, seatIndex: 2 });
      fixture.detectChanges();
      tick();

      expect(focusSpy).not.toHaveBeenCalled();
    }));

    it('does not arm target-follow focus for a wrong keyboard selection', fakeAsync(() => {
      const activeSeat: SeatPosition = { side: 'left', rowIndex: 1, seatIndex: 1 };
      const wrongSeat: Seat = {
        side: 'right',
        rowIndex: 1,
        seatIndex: 2,
        showSoda: false,
        showPopcorn: false,
      };
      const nextTarget = document.createElement('div');
      nextTarget.className = 'seat-wrapper';
      nextTarget.setAttribute('aria-current', 'true');
      (fixture.nativeElement as HTMLElement).appendChild(nextTarget);
      const focusSpy = spyOn(nextTarget, 'focus');

      component.showLobby.set(false);
      activeSeatSignal.set(activeSeat);
      fixture.detectChanges();
      component.handleSeatSelection({ seat: wrongSeat, interaction: 'keyboard' });
      activeSeatSignal.set({ side: 'left', rowIndex: 1, seatIndex: 2 });
      fixture.detectChanges();
      tick();

      expect(focusSpy).not.toHaveBeenCalled();
    }));

    it('should handle seat hover', () => {
      gameStateSignal.set(GameState.Playing);
      const event = { seat: { rowIndex: 1, seatIndex: 1, side: 'left' } as unknown as Seat };

      component.handleSeatHover(event);

      expect(theaterServiceSpy.hoverSeat).toHaveBeenCalledWith(event.seat);
    });

    it('should clear hover when seat is null', () => {
      const event = { seat: null };

      component.handleSeatHover(event);

      expect(theaterServiceSpy.clearHover).toHaveBeenCalled();
    });
  });

  describe('Lobby Interactions', () => {
    it('should handle entering theater from lobby', () => {
      fixture.detectChanges();
      const gameMode = 'classic';

      component.onEnterTheater(gameMode);

      expect(component.showLobby()).toBe(false);
      expect(gameServiceSpy.setGameMode).toHaveBeenCalledWith(gameMode);
    });

    it('should handle opening lobby when game is playing', () => {
      fixture.detectChanges();
      component.showLobby.set(false);
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);

      component.openLobby();

      expect(gameServiceSpy.pauseGame).toHaveBeenCalled();
      expect(component.showLobby()).toBe(true);
    });

    it('should handle lobby open when game is not playing', () => {
      fixture.detectChanges();
      component.showLobby.set(false);
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Inactive);

      component.openLobby();

      expect(component.showLobby()).toBe(true);
    });
  });

  describe('Sound Toggle', () => {
    it('should toggle sound mute state', () => {
      fixture.detectChanges();

      component.toggleSound();

      expect(soundServiceSpy.toggleMute).toHaveBeenCalled();
    });

    it('should toggle sound correctly', () => {
      component.toggleSound();
      expect(soundServiceSpy.toggleMute).toHaveBeenCalled();

      component.toggleSound();
      expect(soundServiceSpy.toggleMute).toHaveBeenCalledTimes(2);
    });
  });

  describe('Paused Game State', () => {
    it('should pause game when opening lobby during play', () => {
      fixture.detectChanges();
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);

      component.openLobby();

      expect(gameServiceSpy.pauseGame).toHaveBeenCalled();
      expect(component.showLobby()).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Theater fix 1 (human QA, 2026-08): Escape did nothing during a Playing
  // round. It now pauses via the SAME path the LOBBY button drives
  // (GameService.pauseGame() + saveGameState()), minus opening the lobby, so
  // the seating area's Intermission scrim appears in place. Resuming (a
  // second, separate Escape) is SeatingAreaComponent's existing "press any
  // key to resume" listener — covered in seating-area.component.spec.ts,
  // including the preventDefault() coordination this fix relies on so that
  // very first Escape does not immediately resume itself in the same tick.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Escape-to-pause contract (theater fix 1)', () => {
    function dispatchEscape(): void {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    }

    it('pauses via the LOBBY button pause path (pauseGame + saveGameState) when Playing', () => {
      fixture.detectChanges();
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);

      dispatchEscape();

      expect(gameServiceSpy.pauseGame).toHaveBeenCalledTimes(1);
      expect(gameServiceSpy.saveGameState).toHaveBeenCalledTimes(1);
    });

    it('does NOT open the lobby (unlike openLobby(), which this path deliberately skips)', () => {
      fixture.detectChanges();
      component.showLobby.set(false);
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);

      dispatchEscape();

      expect(component.showLobby()).toBe(false);
    });

    it('does nothing when the game is Paused (avoids colliding with the resume affordance)', () => {
      fixture.detectChanges();
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Paused);

      dispatchEscape();

      expect(gameServiceSpy.pauseGame).not.toHaveBeenCalled();
    });

    it('does nothing when Inactive, Starting, or Ended', () => {
      fixture.detectChanges();

      for (const state of [GameState.Inactive, GameState.Starting, GameState.Ended]) {
        gameServiceSpy.getCurrentGameState.and.returnValue(state);
        dispatchEscape();
      }

      expect(gameServiceSpy.pauseGame).not.toHaveBeenCalled();
    });

    it('does nothing on Escape while the lobby is showing (LobbyComponent owns Escape there instead)', () => {
      fixture.detectChanges();
      component.showLobby.set(true);
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Inactive);

      dispatchEscape();

      expect(gameServiceSpy.pauseGame).not.toHaveBeenCalled();
    });

    it('ignores non-Escape keys', () => {
      fixture.detectChanges();
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));

      expect(gameServiceSpy.pauseGame).not.toHaveBeenCalled();
    });

    it('removes the Escape listener on destroy', () => {
      fixture.detectChanges();
      fixture.destroy();
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);

      dispatchEscape();

      expect(gameServiceSpy.pauseGame).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WS2c fix 1: closing the Lobby overlay while Paused (e.g. via its Escape
  // handler) used to strand the player on the seating area's paused scrim
  // with no visible exit — the LOBBY button only lit up for GameState.Playing.
  // Paused must be just as reachable so there is always a focusable way out.
  // ─────────────────────────────────────────────────────────────────────────
  describe('LOBBY button visibility while paused', () => {
    it('is visible while Playing', () => {
      component.showLobby.set(false);
      gameStateSignal.set(GameState.Playing);
      fixture.detectChanges();

      const lobbyButton = fixture.nativeElement.querySelector('.lobby-button');
      expect(lobbyButton.classList.contains('visible')).toBeTrue();
    });

    it('stays visible while Paused, so a stranded player always has an exit', () => {
      component.showLobby.set(false);
      gameStateSignal.set(GameState.Paused);
      fixture.detectChanges();

      const lobbyButton = fixture.nativeElement.querySelector('.lobby-button');
      expect(lobbyButton.classList.contains('visible')).toBeTrue();
    });

    it('is hidden for Inactive, Starting, and Ended', () => {
      component.showLobby.set(false);

      for (const state of [GameState.Inactive, GameState.Starting, GameState.Ended]) {
        gameStateSignal.set(state);
        fixture.detectChanges();

        const lobbyButton = fixture.nativeElement.querySelector('.lobby-button');
        expect(lobbyButton.classList.contains('visible')).toBeFalse();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 1 contract: timer cleanup. Three setTimeout sites in this component
  // route through scheduleTimer(); the corresponding cancellation contract is
  // that destroying the component cancels every pending callback so they
  // cannot fire against a dead view (ViewDestroyedError) or mutate root-DI
  // services after the user has left the route. Pin the contract here.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Timer cleanup contract (Phase 1c)', () => {
    it('should not fire the auto-show-lobby timer if the component is destroyed first', fakeAsync(() => {
      fixture.detectChanges();
      component.showLobby.set(false);

      // Triggers the Ended-effect's 3000ms scheduleTimer().
      gameStateSignal.set(GameState.Ended);
      fixture.detectChanges();

      fixture.destroy();
      tick(3000);

      // The callback would have flipped showLobby back to true. Because we
      // destroyed before the 3000ms tick, the destroy hook cleared the timer
      // and the signal is untouched.
      expect(component.showLobby()).toBe(false);
    }));

    it('extends the auto-show-lobby delay when an achievement notification is pending, so the popup outlives the default 3000ms window', fakeAsync(() => {
      fixture.detectChanges();
      component.showLobby.set(false);

      // An achievement unlocked in the same endGame() call that transitioned
      // to Ended — achievementUnlocked is already set by the time this
      // effect observes the state change (see theater.component.ts).
      achievementUnlockedSignal.set({
        id: 'first_game',
        name: 'First Game',
        description: 'Play your first game',
        icon: 'trophy',
        unlocked: true,
      });
      gameStateSignal.set(GameState.Ended);
      fixture.detectChanges();

      // Still present well past the old 3000ms reopen — this is the popup's
      // own display window (NOTIFICATION_DURATION = 4000ms), not the padded
      // reopen delay.
      tick(3500);
      expect(component.showLobby()).toBe(false);

      // The extended reopen delay (NOTIFICATION_DURATION + 500ms) has now
      // elapsed and the lobby reopens.
      tick(1000);
      expect(component.showLobby()).toBe(true);
    }));

    it('should begin a new show synchronously before mounting the auditorium', () => {
      fixture.detectChanges();

      component.onEnterTheater('classic');
      expect(gameServiceSpy.resetToInactive).toHaveBeenCalledBefore(gameServiceSpy.setGameMode);
      expect(gameServiceSpy.setGameMode).toHaveBeenCalledBefore(gameServiceSpy.startGame);
      expect(gameServiceSpy.startGame).toHaveBeenCalledTimes(1);
      expect(component.showLobby()).toBeFalse();
    });

    it('should not call gameService.resumeFromSavedState after destroy on onEnterTheater("resume")', fakeAsync(() => {
      fixture.detectChanges();

      component.onEnterTheater('resume');
      // 500ms scheduleTimer() pending.

      fixture.destroy();
      tick(500);

      expect(gameServiceSpy.resumeFromSavedState).not.toHaveBeenCalled();
    }));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 2 — RTG carryover (Sprints 4-14 Finding 1). GameService is
  // providedIn: 'root', so its ngOnDestroy never fires on SPA route-leave.
  // The parent component delegates to prepareForRouteLeave() from
  // its own destroyRef hook — pin the integration contract here.
  // ─────────────────────────────────────────────────────────────────────────
  describe('SPA route-leave checkpoint contract (Phase 2)', () => {
    it('should call gameService.prepareForRouteLeave() when the component is destroyed', () => {
      fixture.detectChanges();

      fixture.destroy();

      expect(gameServiceSpy.prepareForRouteLeave).toHaveBeenCalledTimes(1);
    });

    it('returns to the lobby when a checkpoint cannot be resumed', fakeAsync(() => {
      fixture.detectChanges();
      gameServiceSpy.resumeFromSavedState.and.returnValue(false);

      component.onEnterTheater('resume');
      tick(500);

      expect(component.showLobby()).toBeTrue();
    }));
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 7 — cross-tab banner. A `storage` event from a sibling tab on a
  // watched key (game data or paused checkpoint) flips crossTabConflict()
  // so the parent renders an assertive-live alert with a Reload action.
  // Unrelated keys are ignored; no-op events (newValue === oldValue) are
  // ignored.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Cross-tab conflict banner (Phase 7)', () => {
    it('should default crossTabConflict() to false', () => {
      fixture.detectChanges();
      expect(component.crossTabConflict()).toBe(false);
    });

    it('should flip crossTabConflict() to true on a storage event for funtimeTheaterData', () => {
      fixture.detectChanges();

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'funtimeTheaterData',
          oldValue: '{"coins":100}',
          newValue: '{"coins":250}',
        })
      );

      expect(component.crossTabConflict()).toBe(true);
    });

    it('should flip crossTabConflict() to true on a storage event for the paused-game key', () => {
      fixture.detectChanges();

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'funtimeTheaterPausedGame',
          oldValue: null,
          newValue: '{"mode":"classic"}',
        })
      );

      expect(component.crossTabConflict()).toBe(true);
    });

    it('should ignore storage events for unrelated keys', () => {
      fixture.detectChanges();

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'someOtherApp.unrelatedKey',
          oldValue: 'a',
          newValue: 'b',
        })
      );

      expect(component.crossTabConflict()).toBe(false);
    });

    it('should ignore storage events where newValue === oldValue', () => {
      fixture.detectChanges();

      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'funtimeTheaterData',
          oldValue: '{"coins":100}',
          newValue: '{"coins":100}',
        })
      );

      expect(component.crossTabConflict()).toBe(false);
    });

    it('should remove the storage listener on destroy', () => {
      fixture.detectChanges();
      fixture.destroy();

      // After destroy, dispatching a watched storage event must NOT change
      // the (already-detached) component's signal. Read the signal value
      // BEFORE destroy via a separate fixture instance to verify it stays
      // false; here we just confirm the listener is gone by the absence of
      // any error or side-effect on dispatch.
      expect(() =>
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'funtimeTheaterData',
            oldValue: 'a',
            newValue: 'b',
          })
        )
      ).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 8a — body scroll-lock acquired on init, released on destroy.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Body scroll-lock contract (Phase 8a)', () => {
    it('should call scrollLock.lock() on construction', () => {
      fixture.detectChanges();
      expect(scrollLockSpy.lock).toHaveBeenCalledTimes(1);
    });

    it('should call scrollLock.unlock() on destroy', () => {
      fixture.detectChanges();
      fixture.destroy();
      expect(scrollLockSpy.unlock).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 8b — auto-pause on document.hidden, auto-resume on visible.
  // The autoPausedDueToHidden flag preserves an explicit user pause across
  // the round-trip. CRITICAL: do not Object.defineProperty(document,
  // 'hidden', { value: ... }) — the value-typed descriptor persists past
  // the spec's finally block and breaks downstream specs that
  // spyOnProperty(document, 'hidden', 'get'). Always install a getter.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Visibility auto-pause contract (Phase 8b)', () => {
    let originalHiddenDescriptor: PropertyDescriptor | undefined;

    function setHidden(value: boolean): void {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => value,
      });
    }

    beforeEach(() => {
      originalHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    });

    afterEach(() => {
      if (originalHiddenDescriptor) {
        Object.defineProperty(Document.prototype, 'hidden', originalHiddenDescriptor);
      }
    });

    it('should auto-pause when the tab becomes hidden during Playing', () => {
      fixture.detectChanges();
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);
      gameStateSignal.set(GameState.Playing);

      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(gameServiceSpy.pauseGame).toHaveBeenCalledTimes(1);
    });

    it('should NOT auto-pause when the tab becomes hidden during non-Playing states', () => {
      fixture.detectChanges();
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Inactive);

      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(gameServiceSpy.pauseGame).not.toHaveBeenCalled();
    });

    it('should auto-resume when the tab becomes visible after an auto-pause', () => {
      fixture.detectChanges();

      // First: hide while playing → auto-pause + flag.
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);
      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));
      expect(gameServiceSpy.pauseGame).toHaveBeenCalledTimes(1);

      // Then: become visible while still Paused (game service reports
      // Paused after the previous pauseGame call).
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Paused);
      setHidden(false);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(gameServiceSpy.resumeGame).toHaveBeenCalledTimes(1);
    });

    it('should NOT auto-resume on visible if there was no prior auto-pause', () => {
      fixture.detectChanges();

      // User paused via openLobby BEFORE any visibility change. Tab then
      // becomes visible — we must NOT resume, because the pause was
      // explicit and the lobby is still showing.
      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Paused);
      setHidden(false);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(gameServiceSpy.resumeGame).not.toHaveBeenCalled();
    });

    it('should remove the visibilitychange listener on destroy', () => {
      fixture.detectChanges();
      fixture.destroy();

      gameServiceSpy.getCurrentGameState.and.returnValue(GameState.Playing);
      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));

      // pauseGame must NOT be called — the listener is gone. Note: it
      // may have been called during route cleanup, but prepareForRouteLeave
      // is a different spy
      // method, so pauseGame's call count stays at 0.
      expect(gameServiceSpy.pauseGame).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Phase 8c — quota-exceeded banner reads from StorageService signal.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Storage quota banner (Phase 8c)', () => {
    it('should expose storageService.storageQuotaExceeded() to the template', () => {
      fixture.detectChanges();
      expect(component.storageService.storageQuotaExceeded()).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// document.hidden must reach FilmScoreService.stop(), not just GameService.
// pauseGame(). The rest of this file mocks GameService entirely (it only
// checks that TheaterComponent calls the right GameService methods), which
// cannot prove the score itself gets silenced — GameService.pauseGame() is a
// stub with no body there. This describe uses a REAL GameService (the same
// recipe as game.service.spec.ts) with FilmScoreService as the only spy in
// that chain, so document.hidden really does exercise
// onVisibilityChange() -> gameService.pauseGame() -> filmScore.stop().
// ─────────────────────────────────────────────────────────────────────────
describe('TheaterComponent + real GameService: document.hidden reaches FilmScoreService', () => {
  let realFixture: ComponentFixture<TheaterComponent>;
  let realComponent: TheaterComponent;
  let filmScoreSpy: jasmine.SpyObj<FilmScoreService>;
  let theaterSpy: jasmine.SpyObj<TheaterService>;
  let originalHiddenDescriptor: PropertyDescriptor | undefined;

  function setHidden(value: boolean): void {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => value,
    });
  }

  beforeEach(async () => {
    originalHiddenDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
    // This block drives a REAL GameService, which persists checkpoints and game
    // data. Without clearing, those writes outlive the spec and reach any later
    // spec that reads the same keys.
    window.localStorage.clear();

    const createSeat = (row: number, seat: number, side: 'left' | 'right'): Seat => ({
      rowIndex: row,
      seatIndex: seat,
      side,
      showSoda: false,
      showPopcorn: false,
    });
    const seatsData = [
      {
        rowIndex: 1,
        seatsPerRow: 4,
        leftSeats: [createSeat(1, 1, 'left'), createSeat(1, 2, 'left')],
        rightSeats: [createSeat(1, 1, 'right'), createSeat(1, 2, 'right')],
      },
    ];

    theaterSpy = jasmine.createSpyObj(
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
        'clearHover',
        'hoverSeat',
        'selectSeat',
      ],
      {
        activeSeat: signal(null),
        hoverEvent$: of(null),
        selectedSeat: signal<Seat | null>(null),
        seatsData: signal(seatsData),
      }
    );
    theaterSpy.getSeatsData.and.returnValue(seatsData);
    // A round that actually drives Playing (Resume-window race guard specs)
    // needs a resolvable seat and a real clicked-count counter, or
    // startGameTimer()'s formula divides by an unstubbed undefined and the
    // round never gets a valid timer/score to checkpoint.
    let clickedCount = 0;
    theaterSpy.getClickedCount.and.callFake(() => clickedCount);
    theaterSpy.incrementClickedCount.and.callFake(() => clickedCount++);
    theaterSpy.resetClickedCount.and.callFake(() => {
      clickedCount = 0;
    });
    theaterSpy.restoreClickedCount.and.callFake((value: number) => {
      clickedCount = value;
    });
    theaterSpy.getRandomSeat.and.returnValue(createSeat(1, 1, 'left'));

    const soundSpy = jasmine.createSpyObj(
      'SoundService',
      [
        'playChairSound',
        'playPowerUpSound',
        'playAchievementSound',
        'playComboSound',
        'playPreset',
        'play',
        'toggleMute',
      ],
      { isSoundMuted: false }
    );

    const achievementsSpy = jasmine.createSpyObj(
      'AchievementsService',
      ['checkAchievement', 'updateProgress', 'getUnlockedCount', 'getTotalCount'],
      {
        achievements: signal<Achievement[]>([]),
        achievementUnlocked: signal(null),
      }
    );

    filmScoreSpy = jasmine.createSpyObj('FilmScoreService', ['start', 'stop']);

    const themeSpy = jasmine.createSpyObj('ThemeService', ['toggleDayMode', 'setDayMode'], {
      isDayMode$: of(false),
    });
    const scrollLockSpyInstance = jasmine.createSpyObj('ScrollLockService', ['lock', 'unlock', 'isLocked']);

    await TestBed.configureTestingModule({
      imports: [TheaterComponent],
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
        { provide: AchievementsService, useValue: achievementsSpy },
        { provide: FilmScoreService, useValue: filmScoreSpy },
        { provide: ThemeService, useValue: themeSpy },
        { provide: ScrollLockService, useValue: scrollLockSpyInstance },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    })
      .overrideComponent(TheaterComponent, {
        set: { imports: [CommonModule], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    realFixture = TestBed.createComponent(TheaterComponent);
    realComponent = realFixture.componentInstance;
    realFixture.detectChanges();
  });

  afterEach(() => {
    // setHidden() installs an OWN property on `document`, so restoring the
    // prototype descriptor alone leaves the stub in place for every later spec
    // in the session. Drop the own property first, then restore the prototype.
    Reflect.deleteProperty(document, 'hidden');
    if (originalHiddenDescriptor) {
      Object.defineProperty(Document.prototype, 'hidden', originalHiddenDescriptor);
    }
    realComponent.gameService.prepareForRouteLeave();
    window.localStorage.clear();
  });

  it('hiding the tab during Playing calls filmScore.stop() via the real GameService.pauseGame()', fakeAsync(() => {
    realComponent.gameService.setGameMode('classic');
    realComponent.gameService.startGame();
    tick(GAME_START_DELAY_MS);

    expect(realComponent.gameService.gameState()).toBe(GameState.Playing);
    expect(filmScoreSpy.start).toHaveBeenCalledTimes(1);

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(realComponent.gameService.gameState()).toBe(GameState.Paused);
    expect(filmScoreSpy.stop).toHaveBeenCalledTimes(1);

    realComponent.gameService.endGame();
  }));

  it('does NOT call filmScore.stop() when the tab hides outside Playing', () => {
    expect(realComponent.gameService.gameState()).toBe(GameState.Inactive);

    setHidden(true);
    document.dispatchEvent(new Event('visibilitychange'));

    expect(filmScoreSpy.stop).not.toHaveBeenCalled();
  });

  // Theater fix 1, exercised against the real FSM (GameStateMachineService),
  // not a GameService spy — proves Escape actually drives the state machine
  // from Playing to Paused, the same way filmScore.stop() above proves
  // document.hidden really reaches pauseGame().
  it('Escape pauses a real Playing round (GameState.Playing -> Paused)', fakeAsync(() => {
    realComponent.gameService.setGameMode('classic');
    realComponent.gameService.startGame();
    tick(GAME_START_DELAY_MS);
    expect(realComponent.gameService.gameState()).toBe(GameState.Playing);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(realComponent.gameService.gameState()).toBe(GameState.Paused);
    expect(filmScoreSpy.stop).toHaveBeenCalledTimes(1);

    realComponent.gameService.endGame();
  }));

  it('Escape does nothing while the lobby is showing (no active round)', () => {
    expect(realComponent.showLobby()).toBeTrue();
    expect(realComponent.gameService.gameState()).toBe(GameState.Inactive);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

    expect(realComponent.gameService.gameState()).toBe(GameState.Inactive);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WS2c fix 1 follow-up: onEnterTheater('resume') sets showLobby=false right
  // away but defers resumeFromSavedState() by 500ms, and gameState stays
  // whatever it already was (Paused, here — the player paused via the LOBBY
  // button and immediately hit Resume) for the whole window. Three live
  // entry points could fire mid-window: a click/keypress on the paused scrim
  // (both route through GameService.resumeGame()) and the now-visible LOBBY
  // button (TheaterComponent.openLobby()). Pre-fix: (a) a premature
  // resumeGame() forced Playing with a stale runtime, so the deferred
  // resumeFromSavedState() then hit a rejected Playing->Playing transition,
  // aborted, and bounced back to the lobby after a broken flash; (b) a LOBBY
  // click reopened the lobby, and the deferred resume then completed
  // invisibly behind it. isResumePending() guards both.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Resume-window race guard (WS2c fix 1 follow-up)', () => {
    function pauseAMidGameViaLobby(): void {
      realComponent.gameService.setGameMode('classic');
      realComponent.gameService.startGame();
      tick(GAME_START_DELAY_MS);
      expect(realComponent.gameService.gameState()).toBe(GameState.Playing);

      realComponent.openLobby();
      expect(realComponent.gameService.gameState()).toBe(GameState.Paused);
      expect(realComponent.showLobby()).toBeTrue();
    }

    it('(a) blocks a premature resumeGame() mid-window so the deferred checkpoint rebuild completes cleanly, exactly once', fakeAsync(() => {
      pauseAMidGameViaLobby();

      realComponent.onEnterTheater('resume');
      expect(realComponent.showLobby()).toBeFalse();
      expect(realComponent.gameService.gameState()).toBe(GameState.Paused);
      expect(realComponent.gameService.isResumePending()).toBeTrue();

      // Mid-window: whatever the paused scrim's click/any-key affordance (or
      // a stray auto-resume-on-visibility) would have called — all of them
      // route through GameService.resumeGame().
      realComponent.gameService.resumeGame();
      // Guarded: no premature transition, still exactly where it was.
      expect(realComponent.gameService.gameState()).toBe(GameState.Paused);

      tick(500);

      expect(realComponent.gameService.gameState()).toBe(GameState.Playing);
      expect(realComponent.showLobby()).toBeFalse();
      expect(realComponent.gameService.isResumePending()).toBeFalse();

      realComponent.gameService.endGame();
    }));

    it('(b) blocks reopening the LOBBY mid-window so the rebuild cannot finish invisibly behind it', fakeAsync(() => {
      pauseAMidGameViaLobby();

      realComponent.onEnterTheater('resume');
      expect(realComponent.showLobby()).toBeFalse();

      // Mid-window: the now-visible LOBBY button is clicked again.
      realComponent.openLobby();
      // Guarded: the click is a no-op while a resume is in flight.
      expect(realComponent.showLobby()).toBeFalse();

      tick(500);

      // The rebuild landed visibly in the theater, never hidden behind a
      // reopened Lobby overlay.
      expect(realComponent.gameService.gameState()).toBe(GameState.Playing);
      expect(realComponent.showLobby()).toBeFalse();

      realComponent.gameService.endGame();
    }));

    it('clears isResumePending if the route unmounts before the deferred rebuild fires', fakeAsync(() => {
      pauseAMidGameViaLobby();

      realComponent.onEnterTheater('resume');
      expect(realComponent.gameService.isResumePending()).toBeTrue();

      // Route teardown before the 500ms timer fires — its own destroy hook
      // cancels the pending macrotask, so resumeFromSavedState() (the normal
      // place the flag clears) never runs.
      realFixture.destroy();

      expect(realComponent.gameService.isResumePending()).toBeFalse();
    }));
  });
});
