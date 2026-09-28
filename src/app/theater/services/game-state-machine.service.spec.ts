import { TestBed } from '@angular/core/testing';
import { GameState } from '../game.service';
import { GameStateMachineService } from './game-state-machine.service';

describe('GameStateMachineService', () => {
  let service: GameStateMachineService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GameStateMachineService);
  });

  afterEach(() => {
    service.reset();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initial state', () => {
    it('should start in Inactive state', () => {
      expect(service.state()).toBe(GameState.Inactive);
    });
  });

  // ─── Valid transitions ────────────────────────────────────────────────────

  describe('valid transitions', () => {
    it('Inactive → Starting succeeds and returns true', () => {
      const result = service.transition(GameState.Starting);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Starting);
    });

    it('Inactive → Playing succeeds (resume from saved state)', () => {
      const result = service.transition(GameState.Playing);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Playing);
    });

    it('Starting → Playing succeeds and returns true', () => {
      service.transition(GameState.Starting);
      const result = service.transition(GameState.Playing);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Playing);
    });

    it('Playing → Paused succeeds and returns true', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      const result = service.transition(GameState.Paused);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Paused);
    });

    it('Playing → Ended succeeds and returns true', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      const result = service.transition(GameState.Ended);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Ended);
    });

    it('Paused → Playing succeeds and returns true', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Paused);
      const result = service.transition(GameState.Playing);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Playing);
    });

    it('Paused → Ended succeeds and returns true', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Paused);
      const result = service.transition(GameState.Ended);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Ended);
    });

    it('Ended → Inactive succeeds and returns true', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Ended);
      const result = service.transition(GameState.Inactive);
      expect(result).toBe(true);
      expect(service.state()).toBe(GameState.Inactive);
    });
  });

  // ─── Invalid transitions ──────────────────────────────────────────────────

  describe('invalid transitions', () => {
    it('Inactive → Ended fails and returns false (skip Playing)', () => {
      const result = service.transition(GameState.Ended);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Inactive);
    });

    it('Inactive → Paused fails and returns false (cannot pause without playing)', () => {
      const result = service.transition(GameState.Paused);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Inactive);
    });

    it('Inactive → Ended fails and returns false (cannot end without playing)', () => {
      const result = service.transition(GameState.Ended);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Inactive);
    });

    it('Ended → Playing fails and returns false', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Ended);
      const result = service.transition(GameState.Playing);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Ended);
    });

    it('Ended → Starting fails and returns false', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Ended);
      const result = service.transition(GameState.Starting);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Ended);
    });

    it('Starting → Ended fails and returns false', () => {
      service.transition(GameState.Starting);
      const result = service.transition(GameState.Ended);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Starting);
    });

    it('Starting → Paused fails and returns false (cannot pause before playing)', () => {
      service.transition(GameState.Starting);
      const result = service.transition(GameState.Paused);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Starting);
    });

    it('Starting → Inactive fails and returns false (cannot revert to inactive from starting)', () => {
      service.transition(GameState.Starting);
      const result = service.transition(GameState.Inactive);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Starting);
    });

    it('Playing → Starting fails and returns false', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      const result = service.transition(GameState.Starting);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Playing);
    });

    it('Paused → Inactive fails and returns false', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Paused);
      const result = service.transition(GameState.Inactive);
      expect(result).toBe(false);
      expect(service.state()).toBe(GameState.Paused);
    });
  });

  // ─── onEnter hooks ────────────────────────────────────────────────────────

  describe('onEnter hooks', () => {
    it('fires onEnter hook when entering a state via valid transition', () => {
      const spy = jasmine.createSpy('onEnter');
      service.onEnter(GameState.Starting, spy);
      service.transition(GameState.Starting);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onEnter hook on invalid transition', () => {
      const spy = jasmine.createSpy('onEnter');
      service.onEnter(GameState.Ended, spy);
      service.transition(GameState.Ended); // Invalid: Inactive → Ended
      expect(spy).not.toHaveBeenCalled();
    });

    it('fires multiple onEnter hooks for the same state', () => {
      const spy1 = jasmine.createSpy('enter1');
      const spy2 = jasmine.createSpy('enter2');
      service.onEnter(GameState.Starting, spy1);
      service.onEnter(GameState.Starting, spy2);
      service.transition(GameState.Starting);
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    });
  });

  // ─── onExit hooks ─────────────────────────────────────────────────────────

  describe('onExit hooks', () => {
    it('fires onExit hook when leaving a state via valid transition', () => {
      const spy = jasmine.createSpy('onExit');
      service.onExit(GameState.Inactive, spy);
      service.transition(GameState.Starting);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('does NOT fire onExit hook on invalid transition', () => {
      const spy = jasmine.createSpy('onExit');
      service.onExit(GameState.Inactive, spy);
      service.transition(GameState.Ended); // Invalid: Inactive → Ended
      expect(spy).not.toHaveBeenCalled();
    });

    it('fires multiple onExit hooks for the same state', () => {
      const spy1 = jasmine.createSpy('exit1');
      const spy2 = jasmine.createSpy('exit2');
      service.onExit(GameState.Inactive, spy1);
      service.onExit(GameState.Inactive, spy2);
      service.transition(GameState.Starting);
      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Hook ordering ────────────────────────────────────────────────────────

  describe('hook ordering', () => {
    it('fires onExit(old) before onEnter(new)', () => {
      const callOrder: string[] = [];
      service.onExit(GameState.Inactive, () => callOrder.push('exit:Inactive'));
      service.onEnter(GameState.Starting, () => callOrder.push('enter:Starting'));
      service.transition(GameState.Starting);
      expect(callOrder).toEqual(['exit:Inactive', 'enter:Starting']);
    });
  });

  // ─── reset() ─────────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('resets to Inactive from any state', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.reset();
      expect(service.state()).toBe(GameState.Inactive);
    });

    it('resets to Inactive from Ended state', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Ended);
      service.reset();
      expect(service.state()).toBe(GameState.Inactive);
    });

    it('resets to Inactive from Paused state', () => {
      service.transition(GameState.Starting);
      service.transition(GameState.Playing);
      service.transition(GameState.Paused);
      service.reset();
      expect(service.state()).toBe(GameState.Inactive);
    });

    it('reset() from Inactive does not throw', () => {
      expect(() => service.reset()).not.toThrow();
      expect(service.state()).toBe(GameState.Inactive);
    });
  });

  // ─── History ─────────────────────────────────────────────────────────────

  describe('transition history', () => {
    it('records valid transitions in history', () => {
      service.transition(GameState.Starting);
      const history = service.getHistory();
      expect(history.length).toBe(1);
      expect(history[0].from).toBe(GameState.Inactive);
      expect(history[0].to).toBe(GameState.Starting);
    });

    it('does NOT record invalid transitions in history', () => {
      service.transition(GameState.Ended); // Invalid: Inactive → Ended
      expect(service.getHistory().length).toBe(0);
    });

    it('records timestamp for each transition', () => {
      const before = Date.now();
      service.transition(GameState.Starting);
      const after = Date.now();
      const record = service.getHistory()[0];
      expect(record.timestamp).toBeGreaterThanOrEqual(before);
      expect(record.timestamp).toBeLessThanOrEqual(after);
    });

    it('records reset() in history', () => {
      service.transition(GameState.Starting);
      service.reset();
      // history should have the Starting transition + the reset
      const history = service.getHistory();
      const resetRecord = history[history.length - 1];
      expect(resetRecord.to).toBe(GameState.Inactive);
    });

    it('caps history at 20 entries', () => {
      // Cycle through states 21+ times to exceed cap
      for (let i = 0; i < 11; i++) {
        service.transition(GameState.Starting);
        service.transition(GameState.Playing);
        service.transition(GameState.Ended);
        service.reset(); // forceful reset back to Inactive for next iteration
      }
      const history = service.getHistory();
      expect(history.length).toBeLessThanOrEqual(20);
    });

    it('getHistory() returns a copy (mutations do not affect internal history)', () => {
      service.transition(GameState.Starting);
      const history = service.getHistory() as TransitionRecord[];
      history.length = 0; // mutate the returned copy
      expect(service.getHistory().length).toBe(1);
    });
  });

  // ─── Observable ──────────────────────────────────────────────────────────

  describe('state$ observable', () => {
    it('emits current state on subscription', (done) => {
      service.state$.subscribe((state) => {
        expect(state).toBe(GameState.Inactive);
        done();
      });
    });

    it('emits updated state after valid transition', () => {
      const emissions: GameState[] = [];
      const sub = service.state$.subscribe((state) => emissions.push(state));

      service.transition(GameState.Starting);
      TestBed.flushEffects(); // flush signal → observable emission

      sub.unsubscribe();
      expect(emissions).toContain(GameState.Starting);
    });
  });
});

// Re-export for use in the test
type TransitionRecord = import('./game-state-machine.service').TransitionRecord;
