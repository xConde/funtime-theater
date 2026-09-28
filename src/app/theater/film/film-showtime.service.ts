import { computed, inject, Injectable, NgZone, OnDestroy, signal } from '@angular/core';
import { GameStateMachineService } from '../services/game-state-machine.service';
import { GameState } from '../game.service';
import { beatAt, generateFilm } from './film-generator';
import type { Film, FilmBeat } from './film.model';

/** Tick interval in milliseconds. */
const TICK_MS = 250;

/**
 * Runtime used for infinite modes (endless, finale) and classic mode.
 *
 * Intentionally independent of GAME_DURATIONS: timed modes (TimeAttack,
 * Midnight, Carnival, Memory) pass their actual GAME_DURATIONS value to
 * startShow(). This constant is the fallback for modes that have no fixed
 * total game time — it gives the film generator a meaningful runtime so the
 * double-feature rollover works correctly.
 */
export const INFINITE_MODE_RUNTIME = 90;

/** True when two poster palettes are the same [bg, primary, accent] triple. */
function samePalette(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((color, i) => color === b[i]);
}

/**
 * Owns "what is on the screen right now."
 *
 * Call startShow() when a new game begins playing. The internal clock
 * advances only while the FSM is in Playing state; it pauses automatically
 * when the FSM leaves Playing and resumes on re-entry. Call endShow() on
 * game end to stop and clear all state.
 *
 * Double-feature: when filmSecond reaches the runtime while the game is
 * still Playing, a new film starts immediately with a fresh random seed.
 */
@Injectable({
  providedIn: 'root',
})
export class FilmShowtimeService implements OnDestroy {
  private readonly _currentFilm = signal<Film | null>(null);
  private readonly _filmSecond = signal<number>(0);
  private readonly _featureNumber = signal<number>(1);

  readonly currentFilm = this._currentFilm.asReadonly();
  readonly filmSecond = this._filmSecond.asReadonly();
  readonly featureNumber = this._featureNumber.asReadonly();

  readonly currentBeat = computed<FilmBeat | null>(() => {
    const film = this._currentFilm();
    if (!film) return null;
    return beatAt(film, this._filmSecond());
  });

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private runtime = INFINITE_MODE_RUNTIME;

  /** Unsubscribe handles for the FSM hooks registered in the constructor. */
  private readonly unsubscribeEnterPlaying: () => void;
  private readonly unsubscribeExitPlaying: () => void;

  private readonly ngZone = inject(NgZone);

  constructor(private readonly stateMachine: GameStateMachineService) {
    // Wire clock to FSM Playing state via enter/exit hooks.
    // Store handles so ngOnDestroy can deregister them.
    this.unsubscribeEnterPlaying = this.stateMachine.onEnter(GameState.Playing, () => this.resumeClock());
    this.unsubscribeExitPlaying = this.stateMachine.onExit(GameState.Playing, () => this.pauseClock());
  }

  /**
   * Generate a new film and start the clock from 0.
   *
   * @param runtimeSeconds Round duration. Use INFINITE_MODE_RUNTIME for
   *   endless/finale modes.
   * @param seed Optional fixed seed; omit for a random film.
   */
  startShow(runtimeSeconds: number, seed?: number): Film {
    this.stopClock();
    this.runtime = runtimeSeconds;

    const resolvedSeed = seed ?? this.randomSeed();
    const film = generateFilm(resolvedSeed, runtimeSeconds);

    this._currentFilm.set(film);
    this._filmSecond.set(0);
    this._featureNumber.set(1);

    // Start the clock only if already Playing (e.g. resume-from-save flow).
    if (this.stateMachine.state() === GameState.Playing) {
      this.startClock();
    }

    return film;
  }

  /** Stop the clock and clear all state. Call on game end. */
  endShow(): void {
    this.stopClock();
    this._currentFilm.set(null);
    this._filmSecond.set(0);
    this._featureNumber.set(1);
  }

  ngOnDestroy(): void {
    this.stopClock();
    this.unsubscribeEnterPlaying();
    this.unsubscribeExitPlaying();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private resumeClock(): void {
    if (this._currentFilm() !== null) {
      this.startClock();
    }
  }

  private pauseClock(): void {
    this.stopClock();
  }

  private startClock(): void {
    this.stopClock();
    this.ngZone.runOutsideAngular(() => {
      this.intervalId = setInterval(() => this.tick(), TICK_MS);
    });
  }

  private stopClock(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private tick(): void {
    const film = this._currentFilm();
    if (!film) return;

    const next = this._filmSecond() + TICK_MS / 1000;

    if (next >= film.runtimeSeconds) {
      // Double feature: roll immediately into a new film. Re-roll if it lands on
      // the outgoing film's exact palette — each genre has only a couple, so a
      // same-genre repeat can otherwise look like the same picture again.
      let newFilm = generateFilm(this.randomSeed(), this.runtime);
      for (let attempt = 0; attempt < 8 && samePalette(newFilm.poster.palette, film.poster.palette); attempt++) {
        newFilm = generateFilm(this.randomSeed(), this.runtime);
      }
      this._currentFilm.set(newFilm);
      this._filmSecond.set(0);
      this._featureNumber.update((n) => n + 1);
    } else {
      this._filmSecond.set(next);
    }
  }

  /** Produce a random seed at the service boundary. */
  private randomSeed(): number {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0];
  }
}
