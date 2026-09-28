import { GameModeContext } from './base-game-mode';
import { ClassicMode } from './classic-mode';
import { TimeAttackMode } from './time-attack-mode';
import { EndlessMode } from './endless-mode';
import { MemoryMode } from './memory-mode';
import { MidnightMode } from './midnight-mode';
import { CarnivalMode } from './carnival-mode';
import { FinaleMode } from './finale-mode';

describe('Game Mode Strategies', () => {
  let mockContext: jasmine.SpyObj<GameModeContext>;

  beforeEach(() => {
    mockContext = jasmine.createSpyObj('GameModeContext', [
      'setTimer',
      'selectRandomSeat',
      'startGameTimer',
      'startSeatMovement',
      'showMemorySequence',
      'scheduleBlackouts',
      'setEndlessSpeedMultiplier',
      'setCarnivalMode',
    ]);
  });

  describe('ClassicMode', () => {
    let mode: ClassicMode;

    beforeEach(() => {
      mode = new ClassicMode(mockContext);
    });

    it('should be created', () => {
      expect(mode).toBeTruthy();
    });

    it('should return correct name', () => {
      expect(mode.getName()).toBe('Classic Mode');
    });

    it('should return correct ID', () => {
      expect(mode.getId()).toBe('classic');
    });

    it('should start with random seat and timer', () => {
      mode.start();

      expect(mockContext.selectRandomSeat).toHaveBeenCalled();
      expect(mockContext.startGameTimer).toHaveBeenCalled();
    });

    it('should call startGameTimer without arguments', () => {
      mode.start();

      expect(mockContext.startGameTimer).toHaveBeenCalledWith();
    });

    it('should not set any special modes', () => {
      mode.start();

      expect(mockContext.setCarnivalMode).not.toHaveBeenCalled();
      expect(mockContext.setEndlessSpeedMultiplier).not.toHaveBeenCalled();
      expect(mockContext.scheduleBlackouts).not.toHaveBeenCalled();
      expect(mockContext.showMemorySequence).not.toHaveBeenCalled();
    });
  });

  describe('TimeAttackMode', () => {
    let mode: TimeAttackMode;

    beforeEach(() => {
      mode = new TimeAttackMode(mockContext);
    });

    it('should be created', () => {
      expect(mode).toBeTruthy();
    });

    it('should return correct name', () => {
      expect(mode.getName()).toBe('Time Attack');
    });

    it('should return correct ID', () => {
      expect(mode.getId()).toBe('timeAttack');
    });

    it('should start with 120 second timer', () => {
      mode.start();

      expect(mockContext.setTimer).toHaveBeenCalledWith(120);
      expect(mockContext.startGameTimer).toHaveBeenCalledWith(120);
    });

    it('should select random seat', () => {
      mode.start();

      expect(mockContext.selectRandomSeat).toHaveBeenCalled();
    });

    it('should call methods in correct order', () => {
      const callOrder: string[] = [];

      mockContext.setTimer.and.callFake(() => callOrder.push('setTimer'));
      mockContext.selectRandomSeat.and.callFake(() => callOrder.push('selectRandomSeat'));
      mockContext.startGameTimer.and.callFake(() => callOrder.push('startGameTimer'));

      mode.start();

      expect(callOrder).toEqual(['setTimer', 'selectRandomSeat', 'startGameTimer']);
    });
  });

  describe('EndlessMode', () => {
    let mode: EndlessMode;

    beforeEach(() => {
      mode = new EndlessMode(mockContext);
    });

    it('should be created', () => {
      expect(mode).toBeTruthy();
    });

    it('should return correct name', () => {
      expect(mode.getName()).toBe('Endless Mode');
    });

    it('should return correct ID', () => {
      expect(mode.getId()).toBe('endless');
    });

    it('should start with -1 timer (infinite)', () => {
      mode.start();

      expect(mockContext.setTimer).toHaveBeenCalledWith(-1);
    });

    it('should select random seat', () => {
      mode.start();

      expect(mockContext.selectRandomSeat).toHaveBeenCalled();
    });

    it('should start seat movement', () => {
      mode.start();

      expect(mockContext.startSeatMovement).toHaveBeenCalled();
    });

    it('should not start game timer', () => {
      mode.start();

      expect(mockContext.startGameTimer).not.toHaveBeenCalled();
    });
  });

  describe('MemoryMode', () => {
    let mode: MemoryMode;

    beforeEach(() => {
      mode = new MemoryMode(mockContext);
    });

    it('should be created', () => {
      expect(mode).toBeTruthy();
    });

    it('should return correct name', () => {
      expect(mode.getName()).toBe('Memory Mode');
    });

    it('should return correct ID', () => {
      expect(mode.getId()).toBe('memory');
    });

    it('should show memory sequence', () => {
      mode.start();

      expect(mockContext.showMemorySequence).toHaveBeenCalled();
    });

    it('should not start with timer', () => {
      mode.start();

      expect(mockContext.setTimer).not.toHaveBeenCalled();
      expect(mockContext.startGameTimer).not.toHaveBeenCalled();
    });

    it('should not select random seat initially', () => {
      mode.start();

      expect(mockContext.selectRandomSeat).not.toHaveBeenCalled();
    });
  });

  describe('MidnightMode', () => {
    let mode: MidnightMode;

    beforeEach(() => {
      mode = new MidnightMode(mockContext);
    });

    it('should be created', () => {
      expect(mode).toBeTruthy();
    });

    it('should return correct name', () => {
      expect(mode.getName()).toBe('Midnight Madness');
    });

    it('should return correct ID', () => {
      expect(mode.getId()).toBe('midnight');
    });

    it('should start with 60 second timer', () => {
      mode.start();

      expect(mockContext.setTimer).toHaveBeenCalledWith(60);
      expect(mockContext.startGameTimer).toHaveBeenCalledWith(60);
    });

    it('should select random seat', () => {
      mode.start();

      expect(mockContext.selectRandomSeat).toHaveBeenCalled();
    });

    it('should schedule blackouts', () => {
      mode.start();

      expect(mockContext.scheduleBlackouts).toHaveBeenCalled();
    });

    it('should call blackouts after timer setup', () => {
      const callOrder: string[] = [];

      mockContext.setTimer.and.callFake(() => callOrder.push('setTimer'));
      mockContext.selectRandomSeat.and.callFake(() => callOrder.push('selectRandomSeat'));
      mockContext.startGameTimer.and.callFake(() => callOrder.push('startGameTimer'));
      mockContext.scheduleBlackouts.and.callFake(() => callOrder.push('scheduleBlackouts'));

      mode.start();

      const blackoutIndex = callOrder.indexOf('scheduleBlackouts');
      const timerIndex = callOrder.indexOf('startGameTimer');
      expect(blackoutIndex).toBeGreaterThan(timerIndex);
    });
  });

  describe('CarnivalMode', () => {
    let mode: CarnivalMode;

    beforeEach(() => {
      mode = new CarnivalMode(mockContext);
    });

    it('should be created', () => {
      expect(mode).toBeTruthy();
    });

    it('should return correct name', () => {
      expect(mode.getName()).toBe('Carnival Chaos');
    });

    it('should return correct ID', () => {
      expect(mode.getId()).toBe('carnival');
    });

    it('should start with 90 second timer', () => {
      mode.start();

      expect(mockContext.setTimer).toHaveBeenCalledWith(90);
      expect(mockContext.startGameTimer).toHaveBeenCalledWith(90);
    });

    it('should select random seat', () => {
      mode.start();

      expect(mockContext.selectRandomSeat).toHaveBeenCalled();
    });

    it('should enable carnival mode', () => {
      mode.start();

      expect(mockContext.setCarnivalMode).toHaveBeenCalledWith(true);
    });

    it('should cleanup carnival mode on cleanup', () => {
      mode.start();
      mode.cleanup();

      expect(mockContext.setCarnivalMode).toHaveBeenCalledWith(false);
    });

    it('should handle cleanup before start', () => {
      expect(() => mode.cleanup()).not.toThrow();
      expect(mockContext.setCarnivalMode).toHaveBeenCalledWith(false);
    });
  });

  describe('FinaleMode', () => {
    let mode: FinaleMode;

    beforeEach(() => {
      mode = new FinaleMode(mockContext);
    });

    it('should be created', () => {
      expect(mode).toBeTruthy();
    });

    it('should return correct name', () => {
      expect(mode.getName()).toBe('Grand Finale');
    });

    it('should return correct ID', () => {
      expect(mode.getId()).toBe('finale');
    });

    it('should start with -1 timer (infinite)', () => {
      mode.start();

      expect(mockContext.setTimer).toHaveBeenCalledWith(-1);
    });

    it('should select random seat', () => {
      mode.start();

      expect(mockContext.selectRandomSeat).toHaveBeenCalled();
    });

    it('should start seat movement', () => {
      mode.start();

      expect(mockContext.startSeatMovement).toHaveBeenCalled();
    });

    it('should set endless speed multiplier to 1.5', () => {
      mode.start();

      expect(mockContext.setEndlessSpeedMultiplier).toHaveBeenCalledWith(1.5);
    });

    it('should call methods in correct order', () => {
      const callOrder: string[] = [];

      mockContext.setTimer.and.callFake(() => callOrder.push('setTimer'));
      mockContext.selectRandomSeat.and.callFake(() => callOrder.push('selectRandomSeat'));
      mockContext.startSeatMovement.and.callFake(() => callOrder.push('startSeatMovement'));
      mockContext.setEndlessSpeedMultiplier.and.callFake(() => callOrder.push('setMultiplier'));

      mode.start();

      expect(callOrder).toEqual(['setTimer', 'selectRandomSeat', 'startSeatMovement', 'setMultiplier']);
    });
  });

  describe('Strategy Pattern Compliance', () => {
    it('all modes should implement getName', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MemoryMode(mockContext),
        new MidnightMode(mockContext),
        new CarnivalMode(mockContext),
        new FinaleMode(mockContext),
      ];

      modes.forEach((mode) => {
        expect(typeof mode.getName()).toBe('string');
        expect(mode.getName().length).toBeGreaterThan(0);
      });
    });

    it('all modes should implement getId', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MemoryMode(mockContext),
        new MidnightMode(mockContext),
        new CarnivalMode(mockContext),
        new FinaleMode(mockContext),
      ];

      modes.forEach((mode) => {
        expect(typeof mode.getId()).toBe('string');
        expect(mode.getId().length).toBeGreaterThan(0);
      });
    });

    it('all modes should have unique IDs', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MemoryMode(mockContext),
        new MidnightMode(mockContext),
        new CarnivalMode(mockContext),
        new FinaleMode(mockContext),
      ];

      const ids = modes.map((m) => m.getId());
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(modes.length);
    });

    it('all modes should implement start', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MemoryMode(mockContext),
        new MidnightMode(mockContext),
        new CarnivalMode(mockContext),
        new FinaleMode(mockContext),
      ];

      modes.forEach((mode) => {
        expect(() => mode.start()).not.toThrow();
      });
    });

    it('all modes should have cleanup method', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MemoryMode(mockContext),
        new MidnightMode(mockContext),
        new CarnivalMode(mockContext),
        new FinaleMode(mockContext),
      ];

      modes.forEach((mode) => {
        expect(() => mode.cleanup()).not.toThrow();
      });
    });
  });

  describe('Context Interaction', () => {
    it('should not share state between mode instances', () => {
      const mode1 = new ClassicMode(mockContext);
      const mode2 = new ClassicMode(mockContext);

      mode1.start();
      mockContext.selectRandomSeat.calls.reset();

      mode2.start();
      expect(mockContext.selectRandomSeat).toHaveBeenCalled();
    });

    it('should use provided context', () => {
      const customContext: jasmine.SpyObj<GameModeContext> = jasmine.createSpyObj('GameModeContext', [
        'setTimer',
        'selectRandomSeat',
        'startGameTimer',
        'startSeatMovement',
        'showMemorySequence',
        'scheduleBlackouts',
        'setEndlessSpeedMultiplier',
        'setCarnivalMode',
      ]);

      const mode = new ClassicMode(customContext);
      mode.start();

      expect(customContext.selectRandomSeat).toHaveBeenCalled();
      expect(mockContext.selectRandomSeat).not.toHaveBeenCalled();
    });

    it('should handle context methods throwing errors', () => {
      mockContext.selectRandomSeat.and.throwError('Test error');

      const mode = new ClassicMode(mockContext);
      expect(() => mode.start()).toThrow();
    });
  });

  describe('Mode Characteristics', () => {
    it('timed modes should set a timer', () => {
      const timedModes = [
        new TimeAttackMode(mockContext),
        new MidnightMode(mockContext),
        new CarnivalMode(mockContext),
      ];

      timedModes.forEach((mode) => {
        mockContext.setTimer.calls.reset();
        mode.start();
        expect(mockContext.setTimer).toHaveBeenCalled();
      });
    });

    it('endless modes should not start game timer', () => {
      const endlessModes = [new EndlessMode(mockContext), new FinaleMode(mockContext)];

      endlessModes.forEach((mode) => {
        mockContext.startGameTimer.calls.reset();
        mode.start();
        expect(mockContext.startGameTimer).not.toHaveBeenCalled();
      });
    });

    it('only carnival mode should enable carnival', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MemoryMode(mockContext),
        new MidnightMode(mockContext),
        new FinaleMode(mockContext),
      ];

      modes.forEach((mode) => {
        mockContext.setCarnivalMode.calls.reset();
        mode.start();
        expect(mockContext.setCarnivalMode).not.toHaveBeenCalled();
      });

      mockContext.setCarnivalMode.calls.reset();
      new CarnivalMode(mockContext).start();
      expect(mockContext.setCarnivalMode).toHaveBeenCalledWith(true);
    });

    it('only midnight mode should schedule blackouts', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MemoryMode(mockContext),
        new CarnivalMode(mockContext),
        new FinaleMode(mockContext),
      ];

      modes.forEach((mode) => {
        mockContext.scheduleBlackouts.calls.reset();
        mode.start();
        expect(mockContext.scheduleBlackouts).not.toHaveBeenCalled();
      });

      mockContext.scheduleBlackouts.calls.reset();
      new MidnightMode(mockContext).start();
      expect(mockContext.scheduleBlackouts).toHaveBeenCalled();
    });

    it('only memory mode should show sequence', () => {
      const modes = [
        new ClassicMode(mockContext),
        new TimeAttackMode(mockContext),
        new EndlessMode(mockContext),
        new MidnightMode(mockContext),
        new CarnivalMode(mockContext),
        new FinaleMode(mockContext),
      ];

      modes.forEach((mode) => {
        mockContext.showMemorySequence.calls.reset();
        mode.start();
        expect(mockContext.showMemorySequence).not.toHaveBeenCalled();
      });

      mockContext.showMemorySequence.calls.reset();
      new MemoryMode(mockContext).start();
      expect(mockContext.showMemorySequence).toHaveBeenCalled();
    });
  });
});
