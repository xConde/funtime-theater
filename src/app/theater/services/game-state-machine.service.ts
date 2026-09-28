import { Injectable, isDevMode, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import { GameState } from '../game.service';

export interface TransitionRecord {
  from: GameState;
  to: GameState;
  timestamp: number;
}

const MAX_HISTORY = 20;

/**
 * Formal finite-state machine for game state transitions.
 * Enforces explicit transition rules and provides lifecycle hooks.
 */
@Injectable({
  providedIn: 'root',
})
export class GameStateMachineService {
  private readonly _state = signal<GameState>(GameState.Inactive);

  /** Read-only view of the current state signal. */
  readonly state = this._state.asReadonly();

  /** Observable stream of state changes for reactive subscribers. */
  readonly state$: Observable<GameState> = toObservable(this._state);

  /**
   * Allowed transitions: Map<from, Set<to>>
   *
   * Inactive → Starting  (new game)
   * Inactive → Playing   (resume from saved state — skips Starting countdown)
   * Starting → Playing
   * Playing  → Paused | Ended
   * Paused   → Playing | Ended
   * Ended    → Inactive
   */
  private readonly transitions: ReadonlyMap<GameState, ReadonlySet<GameState>> = new Map<
    GameState,
    ReadonlySet<GameState>
  >([
    [GameState.Inactive, new Set([GameState.Starting, GameState.Playing])],
    [GameState.Starting, new Set([GameState.Playing])],
    [GameState.Playing, new Set([GameState.Paused, GameState.Ended])],
    [GameState.Paused, new Set([GameState.Playing, GameState.Ended])],
    [GameState.Ended, new Set([GameState.Inactive])],
  ]);

  private readonly onEnterHooks = new Map<GameState, Array<() => void>>();
  private readonly onExitHooks = new Map<GameState, Array<() => void>>();

  private readonly _history: TransitionRecord[] = [];

  /**
   * Attempt a state transition. Returns true if successful, false if invalid.
   */
  transition(to: GameState): boolean {
    const from = this._state();
    const allowed = this.transitions.get(from);

    if (!allowed?.has(to)) {
      if (isDevMode()) {
        console.warn(
          `[GameStateMachine] Invalid transition: ${GameState[from]} → ${GameState[to]}. ` +
            `Allowed from ${GameState[from]}: [${allowed ? [...allowed].map((s) => GameState[s]).join(', ') : 'none'}]`
        );
      }
      return false;
    }

    // Fire exit hooks for current state
    const exitHooks = this.onExitHooks.get(from) ?? [];
    exitHooks.forEach((hook) => hook());

    // Update state
    this._state.set(to);

    // Record history (capped at MAX_HISTORY)
    this._history.push({ from, to, timestamp: Date.now() });
    if (this._history.length > MAX_HISTORY) {
      this._history.shift();
    }

    // Fire enter hooks for new state
    const enterHooks = this.onEnterHooks.get(to) ?? [];
    enterHooks.forEach((hook) => hook());

    return true;
  }

  /**
   * Register a callback to fire when entering the given state.
   * Returns an unsubscribe function — call it to deregister the callback.
   */
  onEnter(state: GameState, callback: () => void): () => void {
    const hooks = this.onEnterHooks.get(state) ?? [];
    hooks.push(callback);
    this.onEnterHooks.set(state, hooks);
    return () => {
      const current = this.onEnterHooks.get(state);
      if (current) {
        const idx = current.indexOf(callback);
        if (idx !== -1) current.splice(idx, 1);
      }
    };
  }

  /**
   * Register a callback to fire when exiting the given state.
   * Returns an unsubscribe function — call it to deregister the callback.
   */
  onExit(state: GameState, callback: () => void): () => void {
    const hooks = this.onExitHooks.get(state) ?? [];
    hooks.push(callback);
    this.onExitHooks.set(state, hooks);
    return () => {
      const current = this.onExitHooks.get(state);
      if (current) {
        const idx = current.indexOf(callback);
        if (idx !== -1) current.splice(idx, 1);
      }
    };
  }

  /**
   * Forcefully reset to Inactive — bypasses transition rules.
   * Use for cleanup and testing only.
   */
  reset(): void {
    const from = this._state();
    this._state.set(GameState.Inactive);
    this._history.push({ from, to: GameState.Inactive, timestamp: Date.now() });
    if (this._history.length > MAX_HISTORY) {
      this._history.shift();
    }
  }

  /**
   * Returns a copy of the transition history (last 20 entries).
   */
  getHistory(): ReadonlyArray<TransitionRecord> {
    return [...this._history];
  }
}
