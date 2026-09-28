import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  Signal,
  untracked,
  WritableSignal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { GameService, GameState } from './game.service';
import { Seat, TheaterService } from './theater.service';
import { SoundService } from './sound.service';
import { AchievementsService } from './achievements.service';
import { ThemeService } from '@services/theme.service';
import { ScrollLockService } from '@services/scroll-lock.service';
import { ScreenComponent } from './screen/screen.component';
import { SeatingAreaComponent } from './seating-area/seating-area.component';
import { LobbyComponent, TheaterEntryRequest } from './lobby/lobby.component';
import { AchievementNotificationComponent } from './achievement-notification/achievement-notification.component';
import { ANIMATION_CONSTANTS, STORAGE_KEYS } from './theater.constants';
import { StorageService } from './services/storage.service';
import { TheaterIconService } from './services/theater-icon.service';
import type { SeatInteractionMethod } from './seating-area/chair/chair.component';

const CROSS_TAB_WATCH_KEYS: ReadonlySet<string> = new Set<string>([STORAGE_KEYS.GAME_DATA, STORAGE_KEYS.PAUSED_GAME]);

/**
 * Lobby reopen delay, in ms, after GameState.Ended when an achievement
 * notification fired in the same round (see the Ended effect below).
 * app-achievement-notification only mounts while the lobby is closed, so the
 * default 3000ms reopen would force-unmount it mid-display for any round
 * that unlocks an achievement — a common case, since 'first_game' unlocks on
 * a new player's very first GameOver. This outlasts NOTIFICATION_DURATION's
 * own auto-dismiss timer plus its 300ms slide-out animation.
 */
const LOBBY_REOPEN_DELAY_WITH_ACHIEVEMENT_MS = ANIMATION_CONSTANTS.NOTIFICATION_DURATION + 500;

@Component({
  selector: 'app-theater',
  templateUrl: './theater.component.html',
  styleUrls: ['./theater.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ScreenComponent, SeatingAreaComponent, LobbyComponent, AchievementNotificationComponent],
})
export class TheaterComponent {
  GameState = GameState;
  readonly showLobby: WritableSignal<boolean> = signal(true);
  readonly isDayMode: Signal<boolean>;

  /**
   * Set to true when another browser tab writes to one of the theater's
   * persisted-state keys (game data or paused checkpoint). Drives the
   * cross-tab conflict banner — without it, the player's view silently
   * goes stale after a sibling tab saves.
   */
  readonly crossTabConflict: WritableSignal<boolean> = signal(false);

  readonly gameService = inject(GameService);
  readonly theaterService = inject(TheaterService);
  readonly soundService = inject(SoundService);
  readonly storageService = inject(StorageService);
  readonly iconService = inject(TheaterIconService);
  private readonly achievementsService = inject(AchievementsService);
  private readonly themeService = inject(ThemeService);
  private readonly scrollLock = inject(ScrollLockService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostElement = inject<ElementRef<HTMLElement>>(ElementRef);
  private focusInitialTargetAfterStart = false;
  private focusNextTargetAfterCatch = false;

  /**
   * True when the previous auto-pause was driven by document.hidden, so we
   * can cleanly auto-resume on visibility return without resuming an
   * explicit user pause. If the user pauses (via openLobby) WHILE hidden,
   * the flag stays true but the game is still Paused on return — the guard
   * is `state === Paused` AND flag, which holds. The guard for not
   * re-pausing on a second hide event is `state === Playing`, which is
   * false in that case, so we don't double-pause. Flag is cleared
   * unconditionally on visibility return.
   */
  private autoPausedDueToHidden = false;

  // Tracked timer IDs so they can be cancelled on destroy. The unguarded
  // setTimeout pattern is a known polish-wave hazard: callbacks fire after
  // the route changes, mutating root-DI services on a view the user has
  // already left and (in dev mode) throwing ViewDestroyedError when they
  // touch the (dead) ChangeDetectorRef.
  private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly storageListener = (event: StorageEvent): void => this.onStorageEvent(event);
  private readonly visibilityListener = (): void => this.onVisibilityChange();
  private readonly escapePauseListener = (event: KeyboardEvent): void => this.onEscapePause(event);

  constructor() {
    this.isDayMode = toSignal(this.themeService.isDayMode$, { initialValue: false });

    effect(() => {
      const state = this.gameService.gameState();
      if (state === GameState.Ended) {
        // Achievement checks run synchronously inside GameService.endGame(),
        // so an achievement unlocked in this same round has already set
        // achievementUnlocked() by the time this effect observes Ended. Read
        // it untracked so the effect keeps reacting to gameState only, not to
        // every future achievement unlock.
        const achievementPending = untracked(() => this.achievementsService.achievementUnlocked() !== null);
        const reopenDelay = achievementPending ? LOBBY_REOPEN_DELAY_WITH_ACHIEVEMENT_MS : 3000;
        this.scheduleTimer(() => this.showLobby.set(true), reopenDelay);
      }
    });

    effect(() => {
      const activeSeat = this.theaterService.activeSeat();
      const lobbyOpen = this.showLobby();

      // A follow request belongs only to the catch that created it. If that
      // round ends or the player leaves the auditorium before a new target is
      // available, discard it so a later pointer-started game cannot inherit
      // keyboard focus intent from the previous run.
      if (!activeSeat || lobbyOpen) {
        this.focusNextTargetAfterCatch = false;
      }

      const shouldFocusTarget = this.focusInitialTargetAfterStart || this.focusNextTargetAfterCatch;
      if (!shouldFocusTarget || lobbyOpen || !activeSeat) return;

      this.focusInitialTargetAfterStart = false;
      this.focusNextTargetAfterCatch = false;
      this.scheduleTimer(() => {
        this.hostElement.nativeElement.querySelector<HTMLElement>('.seat-wrapper[aria-current="true"]')?.focus();
      }, 0);
    });

    window.addEventListener('storage', this.storageListener);
    document.addEventListener('visibilitychange', this.visibilityListener);
    document.addEventListener('keydown', this.escapePauseListener);

    // Phase 8a — lock body scroll while the theater route is mounted.
    // The portfolio shell uses overflow-y: auto on its router-outlet
    // wrapper, and the theater is fullscreen-by-design; without the lock,
    // wheel events on the seating area gaps scroll the parent shell
    // behind the theater.
    this.scrollLock.lock();

    this.destroyRef.onDestroy(() => {
      // Cancel any pending parent-scoped delays (Phase 1 timer-cleanup
      // contract) so they cannot mutate state on a destroyed view.
      for (const id of this.pendingTimers) {
        clearTimeout(id);
      }
      this.pendingTimers.clear();

      window.removeEventListener('storage', this.storageListener);
      document.removeEventListener('visibilitychange', this.visibilityListener);
      document.removeEventListener('keydown', this.escapePauseListener);
      this.scrollLock.unlock();

      // GameService is providedIn: 'root', so its own ngOnDestroy never fires
      // on SPA navigation. This also cancels the service-owned Starting delay,
      // which a parent timer cleanup alone cannot reach.
      this.gameService.prepareForRouteLeave();
    });
  }

  reload(): void {
    window.location.reload();
  }

  private onStorageEvent(event: StorageEvent): void {
    if (!event.key || !CROSS_TAB_WATCH_KEYS.has(event.key)) return;
    if (event.newValue === event.oldValue) return;
    this.crossTabConflict.set(true);
  }

  /**
   * Phase 8b — auto-pause on document.hidden, auto-resume on return.
   * The autoPausedDueToHidden flag preserves an explicit user pause
   * across the round-trip: if the user paused via openLobby BEFORE the
   * tab became hidden, the flag is false on return and we do NOT auto-
   * resume.
   */
  private onVisibilityChange(): void {
    if (document.hidden) {
      if (this.gameService.getCurrentGameState() === GameState.Playing) {
        this.gameService.pauseGame();
        this.autoPausedDueToHidden = true;
      }
      return;
    }

    if (this.autoPausedDueToHidden && this.gameService.getCurrentGameState() === GameState.Paused) {
      this.gameService.resumeGame();
    }
    this.autoPausedDueToHidden = false;
  }

  /**
   * Escape pauses a Playing round in place — the same pause path the LOBBY
   * button drives (GameService.pauseGame() + saveGameState()), minus opening
   * the lobby, so the seating area's Intermission scrim appears over the
   * auditorium instead. Gated to GameState.Playing so it can never collide
   * with LobbyComponent's own document:keydown.escape handler, which only
   * runs while the lobby is shown (showLobby() true) — mutually exclusive
   * with Playing, since the lobby unmounts once a round starts.
   *
   * Resuming (Escape again) is NOT handled here: SeatingAreaComponent's
   * existing "press any key to resume" document:keydown listener already
   * fires for Escape (it is not in that listener's key-exclusion list), and
   * it already carries the resume-in-flight guard via GameService.resumeGame().
   *
   * preventDefault() marks this keydown as already handled. Both listeners
   * are bound to document:keydown, this one registered first (constructor
   * time, before SeatingAreaComponent ever mounts), and Angular flushes its
   * pending change-detection microtask between same-node listener
   * invocations — so gameState is already Paused by the time
   * SeatingAreaComponent's listener runs for this SAME keydown. Without the
   * flag, that listener would read "any key resumes" and immediately undo
   * this pause in the same tick; it checks event.defaultPrevented and backs
   * off, so only a later, separate key press or click resumes.
   */
  private onEscapePause(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    if (this.gameService.getCurrentGameState() !== GameState.Playing) return;
    event.preventDefault();
    this.gameService.pauseGame();
    this.gameService.saveGameState();
  }

  openLobby(): void {
    // A checkpoint resume is rebuilding the runtime on a deferred timer (see
    // onEnterTheater below) — reopening the lobby mid-window would let that
    // rebuild finish invisibly behind it. Ignore the click until it settles.
    if (this.gameService.isResumePending()) return;

    const currentState = this.gameService.getCurrentGameState();
    if (currentState === GameState.Playing) {
      this.gameService.pauseGame();
      this.gameService.saveGameState();
    }
    this.showLobby.set(true);
  }

  handleSeatHover(event: { seat: Seat | null }): void {
    if (event.seat) {
      this.theaterService.hoverSeat(event.seat);
    } else {
      this.theaterService.clearHover();
    }
  }

  handleSeatSelection(event: { seat: Seat | null; interaction?: SeatInteractionMethod }): void {
    if (event.seat) {
      const activeSeat = this.theaterService.activeSeat();
      this.focusNextTargetAfterCatch =
        event.interaction === 'keyboard' &&
        activeSeat !== null &&
        activeSeat.side === event.seat.side &&
        activeSeat.rowIndex === event.seat.rowIndex &&
        activeSeat.seatIndex === event.seat.seatIndex;
      this.theaterService.selectSeat(event.seat);
    }
  }

  onEnterTheater(request: TheaterEntryRequest | string): void {
    const gameMode = typeof request === 'string' ? request : request.gameMode;
    this.focusInitialTargetAfterStart = typeof request === 'string' ? false : request.focusInitialTarget;

    if (gameMode === 'resume') {
      this.showLobby.set(false);
      // gameState holds whatever it already was (Paused for a same-route
      // resume, Inactive after a route remount) for this entire window, so
      // mark the resume in-flight BEFORE scheduling the deferred rebuild —
      // otherwise a click, keypress, or LOBBY tap during the wait races the
      // still-un-rebuilt runtime (WS2c fix 1 follow-up).
      this.gameService.markResumePending();
      // Resume the paused game on the next macrotask so the lobby unmount
      // animation has a frame to commit before the FSM transitions.
      this.scheduleTimer(() => {
        if (!this.gameService.resumeFromSavedState()) {
          this.showLobby.set(true);
        }
      }, 500);
    } else {
      // Build the Starting state before mounting the auditorium. The former
      // 500ms parent delay exposed an empty Inactive room between the lobby and
      // the house-lights beat, which made the deliberate start transition look
      // like a loading failure.
      this.gameService.resetToInactive();
      this.gameService.setGameMode(gameMode);
      this.gameService.startGame();
      this.showLobby.set(false);
    }
  }

  toggleSound(): void {
    this.soundService.toggleMute();
  }

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: Event): void {
    if (!(event instanceof MouseEvent)) return;
    if (!this.showLobby() && this.gameService.getCurrentGameState() === GameState.Playing) {
      this.gameService.updateCursorPosition(event.clientX, event.clientY);
    }
  }

  private scheduleTimer(callback: () => void, delay: number): void {
    const id = setTimeout(() => {
      this.pendingTimers.delete(id);
      callback();
    }, delay);
    this.pendingTimers.add(id);
  }
}
