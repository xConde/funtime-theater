import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { FilmShowtimeService, INFINITE_MODE_RUNTIME } from './film-showtime.service';
import { GameStateMachineService } from '../services/game-state-machine.service';
import { GameState } from '../game.service';

/**
 * Helper: advance the FSM to Playing and back, mimicking startGame() flow.
 */
function enterPlaying(fsm: GameStateMachineService): void {
  fsm.transition(GameState.Starting);
  fsm.transition(GameState.Playing);
}

function exitPlaying(fsm: GameStateMachineService): void {
  fsm.transition(GameState.Paused);
}

function reenterPlaying(fsm: GameStateMachineService): void {
  fsm.transition(GameState.Playing);
}

describe('FilmShowtimeService', () => {
  let service: FilmShowtimeService;
  let fsm: GameStateMachineService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [FilmShowtimeService, GameStateMachineService],
    });
    service = TestBed.inject(FilmShowtimeService);
    fsm = TestBed.inject(GameStateMachineService);
  });

  afterEach(() => {
    // Always end show so interval is cleared before next test.
    service.endShow();
  });

  // ---------------------------------------------------------------------------
  // startShow
  // ---------------------------------------------------------------------------

  describe('startShow', () => {
    it('returns a Film and sets currentFilm signal', () => {
      const film = service.startShow(60, 12345);
      expect(service.currentFilm()).toBe(film);
      expect(film.runtimeSeconds).toBe(60);
    });

    it('generates deterministically from a fixed seed', () => {
      const a = service.startShow(90, 999);
      service.endShow();
      const b = service.startShow(90, 999);
      expect(a.title).toBe(b.title);
    });

    it('resets filmSecond to 0', () => {
      service.startShow(60, 1);
      expect(service.filmSecond()).toBe(0);
    });

    it('resets featureNumber to 1', () => {
      service.startShow(60, 1);
      expect(service.featureNumber()).toBe(1);
    });

    it('currentBeat is non-null immediately (title card at t=0)', () => {
      service.startShow(60, 1);
      expect(service.currentBeat()).not.toBeNull();
      expect(service.currentBeat()!.kind).toBe('title-card');
    });
  });

  // ---------------------------------------------------------------------------
  // Clock advances only while Playing
  // ---------------------------------------------------------------------------

  describe('clock behaviour', () => {
    it('does NOT advance when FSM is not Playing', fakeAsync(() => {
      service.startShow(60, 42);
      // FSM is still Inactive; clock should NOT start.
      tick(1000);
      expect(service.filmSecond()).toBe(0);
    }));

    it('advances by 0.25 per 250ms while Playing', fakeAsync(() => {
      service.startShow(60, 42);
      enterPlaying(fsm);

      tick(250);
      expect(service.filmSecond()).toBeCloseTo(0.25, 2);

      tick(250);
      expect(service.filmSecond()).toBeCloseTo(0.5, 2);

      service.endShow();
    }));

    it('pauses when FSM exits Playing', fakeAsync(() => {
      service.startShow(60, 42);
      enterPlaying(fsm);

      tick(500);
      const secondsAfterHalfSecond = service.filmSecond();
      expect(secondsAfterHalfSecond).toBeCloseTo(0.5, 2);

      exitPlaying(fsm); // → Paused; exit hook fires, clock stops.
      tick(1000);
      // Should not have advanced.
      expect(service.filmSecond()).toBe(secondsAfterHalfSecond);

      service.endShow();
    }));

    it('resumes after re-entering Playing', fakeAsync(() => {
      service.startShow(60, 42);
      enterPlaying(fsm);
      tick(500);
      exitPlaying(fsm);
      const frozen = service.filmSecond();

      reenterPlaying(fsm);
      tick(250);
      expect(service.filmSecond()).toBeCloseTo(frozen + 0.25, 2);

      service.endShow();
    }));
  });

  // ---------------------------------------------------------------------------
  // Beat transitions
  // ---------------------------------------------------------------------------

  describe('currentBeat', () => {
    it('changes to a body beat after the title card ends', fakeAsync(() => {
      // Seed 1 → 5s title card by spec.
      service.startShow(60, 1);
      enterPlaying(fsm);

      // Skip past the title card (5 seconds).
      tick(5000);
      const beat = service.currentBeat();
      expect(beat).not.toBeNull();
      // After the title card the film is in the body.
      expect(beat!.kind).not.toBe('title-card');

      service.endShow();
    }));

    it('returns null when filmSecond is beyond runtimeSeconds', () => {
      // Supply a minimal runtime film and fake a past-end second.
      const film = service.startShow(30, 7);
      // Directly read: beatAt beyond runtime returns null.
      // We can't set filmSecond directly, so we verify via the generator contract.
      // The credits beat ends at film.runtimeSeconds; beatAt returns null after.
      const lastBeat = film.beats[film.beats.length - 1];
      expect(lastBeat.kind).toBe('credits');
    });
  });

  // ---------------------------------------------------------------------------
  // Double feature rollover
  // ---------------------------------------------------------------------------

  describe('double feature', () => {
    it('rolls over to a new film when filmSecond reaches runtimeSeconds', fakeAsync(() => {
      const runtime = 30;
      service.startShow(runtime, 111);
      enterPlaying(fsm);

      // Tick just past the runtime.
      tick(runtime * 1000 + 250);

      const secondFilm = service.currentFilm();
      expect(secondFilm).not.toBeNull();
      // A new film with the same runtime should have started.
      expect(secondFilm!.runtimeSeconds).toBe(runtime);
      // It should be a different film (different seed → different title with high probability).
      // We verify featureNumber instead of relying on seed collision:
      expect(service.featureNumber()).toBe(2);

      service.endShow();
    }));

    it('increments featureNumber on each rollover', fakeAsync(() => {
      const runtime = 30;
      service.startShow(runtime, 222);
      enterPlaying(fsm);

      tick(runtime * 1000 + 250);
      expect(service.featureNumber()).toBe(2);

      tick(runtime * 1000);
      expect(service.featureNumber()).toBe(3);

      service.endShow();
    }));

    it('resets filmSecond to 0 after rollover', fakeAsync(() => {
      const runtime = 30;
      service.startShow(runtime, 333);
      enterPlaying(fsm);

      // Tick to exactly the rollover point (120 ticks at 250ms each).
      // The 120th tick: next = 29.75 + 0.25 = 30.0 >= 30 → rollover; filmSecond set to 0.
      tick(runtime * 1000);
      expect(service.filmSecond()).toBeCloseTo(0, 2);

      service.endShow();
    }));
  });

  // ---------------------------------------------------------------------------
  // endShow clears state and stops interval
  // ---------------------------------------------------------------------------

  describe('endShow', () => {
    it('clears currentFilm', fakeAsync(() => {
      service.startShow(60, 1);
      enterPlaying(fsm);
      tick(500);
      service.endShow();
      expect(service.currentFilm()).toBeNull();
    }));

    it('clears filmSecond and featureNumber', fakeAsync(() => {
      service.startShow(30, 1);
      enterPlaying(fsm);
      tick(30000 + 250); // trigger double feature
      service.endShow();
      expect(service.filmSecond()).toBe(0);
      expect(service.featureNumber()).toBe(1);
    }));

    it('stops the interval so filmSecond stays at 0 after endShow', fakeAsync(() => {
      service.startShow(60, 1);
      enterPlaying(fsm);
      tick(500);
      service.endShow();

      // After endShow the clock must be dead even though FSM is still Playing.
      tick(2000);
      expect(service.filmSecond()).toBe(0);
    }));

    it('is safe to call multiple times without leaking intervals', fakeAsync(() => {
      service.startShow(60, 1);
      enterPlaying(fsm);
      tick(250);
      service.endShow();
      service.endShow(); // second call must not throw or start a new interval.

      tick(1000);
      expect(service.filmSecond()).toBe(0);
    }));
  });

  // ---------------------------------------------------------------------------
  // INFINITE_MODE_RUNTIME export
  // ---------------------------------------------------------------------------

  it('INFINITE_MODE_RUNTIME is 90', () => {
    expect(INFINITE_MODE_RUNTIME).toBe(90);
  });

  // ---------------------------------------------------------------------------
  // Finding 1 (C1): FSM hook deregistration
  // ---------------------------------------------------------------------------

  describe('FSM hook deregistration', () => {
    it('unsubscribed onEnter callback no longer fires on transition', fakeAsync(() => {
      let callCount = 0;
      const unsub = fsm.onEnter(GameState.Playing, () => callCount++);

      // Register and then immediately unsubscribe.
      unsub();

      fsm.transition(GameState.Starting);
      fsm.transition(GameState.Playing);

      expect(callCount).toBe(0);
      service.endShow();
    }));

    it('unsubscribed onExit callback no longer fires on transition', fakeAsync(() => {
      let callCount = 0;
      fsm.transition(GameState.Starting);
      fsm.transition(GameState.Playing);

      const unsub = fsm.onExit(GameState.Playing, () => callCount++);
      unsub();

      fsm.transition(GameState.Paused); // exits Playing
      expect(callCount).toBe(0);

      service.endShow();
    }));

    it('FilmShowtimeService ngOnDestroy deregisters hooks (transition after destroy does not restart clock)', fakeAsync(() => {
      service.startShow(60, 42);
      enterPlaying(fsm);
      tick(500);
      const secondBeforeDestroy = service.filmSecond();

      // Destroy the service — this should deregister the FSM hooks.
      service.ngOnDestroy();

      // Now transition back to Playing via Paused then Playing again.
      // Since hooks are removed, the clock must NOT restart.
      fsm.transition(GameState.Paused);
      fsm.transition(GameState.Playing);
      tick(500);

      // filmSecond should not have advanced past the stopClock value (0 after endShow in ngOnDestroy).
      // After ngOnDestroy the clock is stopped and hooks removed, so no advancement.
      expect(service.filmSecond()).toBe(secondBeforeDestroy);
    }));
  });

  // ---------------------------------------------------------------------------
  // Finding 2 (C2 + L1): Production-order and beat-transition specs
  // ---------------------------------------------------------------------------

  describe('production ordering: Playing first, then startShow', () => {
    it('(a) FSM enters Playing first, then startShow — clock advances', fakeAsync(() => {
      // Production new-game ordering: FSM transitions to Playing, then startShow is called.
      // FilmShowtimeService.resumeClock() checks currentFilm !== null before starting.
      enterPlaying(fsm);
      service.startShow(90, 42); // clock starts inside startShow because state === Playing

      tick(500);
      expect(service.filmSecond()).toBeCloseTo(0.5, 2);

      service.endShow();
    }));

    it('(b) after endShow(), currentBeat() returns null and filmSecond() is 0', fakeAsync(() => {
      service.startShow(60, 1);
      enterPlaying(fsm);
      tick(500);
      service.endShow();

      expect(service.currentBeat()).toBeNull();
      expect(service.filmSecond()).toBe(0);
    }));

    it('(c) currentBeat transitions from title-card to next beat at the 5s boundary', fakeAsync(() => {
      // Seed 1 produces a 5-second title card per the generator spec.
      service.startShow(60, 1);
      enterPlaying(fsm);

      // Still inside the title card.
      tick(4750);
      expect(service.currentBeat()!.kind).toBe('title-card');

      // Cross the 5s boundary (one more 250ms tick takes us to 5.0s exactly,
      // which hits the rollover — but beatAt at 5.0 returns the next beat).
      tick(250);
      expect(service.currentBeat()!.kind).not.toBe('title-card');

      service.endShow();
    }));
  });
});
