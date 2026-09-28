import { discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { DisposableTimer } from './disposable-timer';

describe('DisposableTimer', () => {
  let timer: DisposableTimer;

  beforeEach(() => {
    timer = new DisposableTimer();
  });

  afterEach(() => {
    timer.clearAll();
  });

  describe('setTimeout', () => {
    it('should execute callback after delay', fakeAsync(() => {
      let executed = false;

      timer.setTimeout(
        'test',
        () => {
          executed = true;
        },
        1000
      );

      expect(executed).toBe(false);
      tick(1000);
      expect(executed).toBe(true);
    }));

    it('should execute callback with correct timing', fakeAsync(() => {
      let count = 0;

      timer.setTimeout('test1', () => count++, 100);
      timer.setTimeout('test2', () => count++, 200);
      timer.setTimeout('test3', () => count++, 300);

      tick(150);
      expect(count).toBe(1);

      tick(100);
      expect(count).toBe(2);

      tick(100);
      expect(count).toBe(3);
    }));

    it('should auto-cleanup after execution', fakeAsync(() => {
      timer.setTimeout('test', () => {}, 1000);
      expect(timer.has('test')).toBe(true);

      tick(1000);
      expect(timer.has('test')).toBe(false);
    }));

    it('should replace existing timer with same name', fakeAsync(() => {
      let firstExecuted = false;
      let secondExecuted = false;

      timer.setTimeout(
        'test',
        () => {
          firstExecuted = true;
        },
        1000
      );
      timer.setTimeout(
        'test',
        () => {
          secondExecuted = true;
        },
        2000
      );

      tick(1500);
      expect(firstExecuted).toBe(false);
      expect(secondExecuted).toBe(false);

      tick(500);
      expect(firstExecuted).toBe(false);
      expect(secondExecuted).toBe(true);
    }));

    it('should track active timer count', fakeAsync(() => {
      expect(timer.getActiveCount()).toBe(0);

      timer.setTimeout('test1', () => {}, 1000);
      expect(timer.getActiveCount()).toBe(1);

      timer.setTimeout('test2', () => {}, 1000);
      expect(timer.getActiveCount()).toBe(2);

      tick(1000);
      expect(timer.getActiveCount()).toBe(0);
    }));
  });

  describe('setInterval', () => {
    it('should execute callback repeatedly', fakeAsync(() => {
      let count = 0;

      timer.setInterval('test', () => count++, 100);

      tick(100);
      expect(count).toBe(1);

      tick(100);
      expect(count).toBe(2);

      tick(100);
      expect(count).toBe(3);

      timer.clearAll();
      discardPeriodicTasks();
    }));

    it('should continue until manually cleared', fakeAsync(() => {
      let count = 0;

      timer.setInterval('test', () => count++, 50);

      tick(500);
      expect(count).toBe(10);

      timer.clearInterval('test');
      tick(500);
      expect(count).toBe(10); // No more executions
    }));

    it('should replace existing interval with same name', fakeAsync(() => {
      let count1 = 0;
      let count2 = 0;

      timer.setInterval('test', () => count1++, 100);
      timer.setInterval('test', () => count2++, 100);

      tick(300);
      expect(count1).toBe(0);
      expect(count2).toBe(3);

      timer.clearAll();
      discardPeriodicTasks();
    }));

    it('should track interval in active count', fakeAsync(() => {
      timer.setInterval('test', () => {}, 100);
      expect(timer.getActiveCount()).toBe(1);

      tick(500);
      expect(timer.getActiveCount()).toBe(1); // Still active

      timer.clearInterval('test');
      expect(timer.getActiveCount()).toBe(0);
    }));
  });

  describe('clearTimeout', () => {
    it('should prevent timeout execution', fakeAsync(() => {
      let executed = false;

      timer.setTimeout(
        'test',
        () => {
          executed = true;
        },
        1000
      );
      timer.clearTimeout('test');

      tick(2000);
      expect(executed).toBe(false);
    }));

    it('should remove timer from tracking', fakeAsync(() => {
      timer.setTimeout('test', () => {}, 1000);
      expect(timer.has('test')).toBe(true);

      timer.clearTimeout('test');
      expect(timer.has('test')).toBe(false);
    }));

    it('should be safe to call on non-existent timer', () => {
      expect(() => timer.clearTimeout('nonexistent')).not.toThrow();
    });

    it('should be safe to call multiple times', () => {
      timer.setTimeout('test', () => {}, 1000);
      timer.clearTimeout('test');
      timer.clearTimeout('test');
      timer.clearTimeout('test');

      expect(timer.has('test')).toBe(false);
    });
  });

  describe('clearInterval', () => {
    it('should stop interval execution', fakeAsync(() => {
      let count = 0;

      timer.setInterval('test', () => count++, 100);
      tick(200);
      expect(count).toBe(2);

      timer.clearInterval('test');
      tick(500);
      expect(count).toBe(2); // No more executions
    }));

    it('should remove timer from tracking', fakeAsync(() => {
      timer.setInterval('test', () => {}, 100);
      expect(timer.has('test')).toBe(true);

      timer.clearInterval('test');
      expect(timer.has('test')).toBe(false);
      discardPeriodicTasks();
    }));

    it('should be safe to call on non-existent interval', () => {
      expect(() => timer.clearInterval('nonexistent')).not.toThrow();
    });
  });

  describe('clear (generic)', () => {
    it('should clear timeout', fakeAsync(() => {
      let executed = false;

      timer.setTimeout(
        'test',
        () => {
          executed = true;
        },
        1000
      );
      timer.clear('test');

      tick(2000);
      expect(executed).toBe(false);
    }));

    it('should clear interval', fakeAsync(() => {
      let count = 0;

      timer.setInterval('test', () => count++, 100);
      tick(200);
      timer.clear('test');

      tick(500);
      expect(count).toBe(2);
    }));

    it('should work for both timeout and interval', fakeAsync(() => {
      timer.setTimeout('timeout', () => {}, 1000);
      timer.setInterval('interval', () => {}, 100);

      expect(timer.getActiveCount()).toBe(2);

      timer.clear('timeout');
      expect(timer.getActiveCount()).toBe(1);

      timer.clear('interval');
      expect(timer.getActiveCount()).toBe(0);
    }));
  });

  describe('clearAll', () => {
    it('should clear all timeouts', fakeAsync(() => {
      let count = 0;

      timer.setTimeout('test1', () => count++, 100);
      timer.setTimeout('test2', () => count++, 200);
      timer.setTimeout('test3', () => count++, 300);

      timer.clearAll();
      tick(500);

      expect(count).toBe(0);
    }));

    it('should clear all intervals', fakeAsync(() => {
      let count = 0;

      timer.setInterval('test1', () => count++, 100);
      timer.setInterval('test2', () => count++, 100);

      tick(200);
      expect(count).toBe(4);

      timer.clearAll();
      tick(500);
      expect(count).toBe(4); // No more executions

      discardPeriodicTasks();
    }));

    it('should clear mix of timeouts and intervals', fakeAsync(() => {
      timer.setTimeout('timeout1', () => {}, 100);
      timer.setTimeout('timeout2', () => {}, 200);
      timer.setInterval('interval1', () => {}, 100);
      timer.setInterval('interval2', () => {}, 200);

      expect(timer.getActiveCount()).toBe(4);

      timer.clearAll();
      expect(timer.getActiveCount()).toBe(0);
      discardPeriodicTasks();
    }));

    it('should reset tracking maps', fakeAsync(() => {
      timer.setTimeout('test1', () => {}, 1000);
      timer.setInterval('test2', () => {}, 1000);

      timer.clearAll();

      expect(timer.has('test1')).toBe(false);
      expect(timer.has('test2')).toBe(false);
      discardPeriodicTasks();
    }));

    it('should be safe to call when empty', () => {
      expect(() => timer.clearAll()).not.toThrow();
      expect(timer.getActiveCount()).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      timer.setTimeout('test', () => {}, 1000);
      timer.clearAll();
      timer.clearAll();
      timer.clearAll();

      expect(timer.getActiveCount()).toBe(0);
    });
  });

  describe('getActiveCount', () => {
    it('should return 0 when no timers', () => {
      expect(timer.getActiveCount()).toBe(0);
    });

    it('should count active timeouts', () => {
      timer.setTimeout('test1', () => {}, 1000);
      timer.setTimeout('test2', () => {}, 2000);
      timer.setTimeout('test3', () => {}, 3000);

      expect(timer.getActiveCount()).toBe(3);
    });

    it('should count active intervals', fakeAsync(() => {
      timer.setInterval('test1', () => {}, 100);
      timer.setInterval('test2', () => {}, 200);

      expect(timer.getActiveCount()).toBe(2);

      timer.clearAll();
      discardPeriodicTasks();
    }));

    it('should count mix of timeouts and intervals', fakeAsync(() => {
      timer.setTimeout('timeout', () => {}, 1000);
      timer.setInterval('interval', () => {}, 100);

      expect(timer.getActiveCount()).toBe(2);

      timer.clearAll();
      discardPeriodicTasks();
    }));

    it('should decrease when timeout executes', fakeAsync(() => {
      timer.setTimeout('test', () => {}, 100);
      expect(timer.getActiveCount()).toBe(1);

      tick(100);
      expect(timer.getActiveCount()).toBe(0);
    }));

    it('should not decrease when interval executes', fakeAsync(() => {
      timer.setInterval('test', () => {}, 100);
      expect(timer.getActiveCount()).toBe(1);

      tick(500);
      expect(timer.getActiveCount()).toBe(1);

      timer.clearAll();
      discardPeriodicTasks();
    }));
  });

  describe('has', () => {
    it('should return false for non-existent timer', () => {
      expect(timer.has('nonexistent')).toBe(false);
    });

    it('should return true for active timeout', fakeAsync(() => {
      timer.setTimeout('test', () => {}, 1000);
      expect(timer.has('test')).toBe(true);
      timer.clearAll();
    }));

    it('should return true for active interval', fakeAsync(() => {
      timer.setInterval('test', () => {}, 100);
      expect(timer.has('test')).toBe(true);

      timer.clearAll();
      discardPeriodicTasks();
    }));

    it('should return false after timeout executes', fakeAsync(() => {
      timer.setTimeout('test', () => {}, 100);
      tick(100);
      expect(timer.has('test')).toBe(false);
    }));

    it('should return true for interval after execution', fakeAsync(() => {
      timer.setInterval('test', () => {}, 100);
      tick(500);
      expect(timer.has('test')).toBe(true);

      timer.clearAll();
      discardPeriodicTasks();
    }));

    it('should return false after clearing', fakeAsync(() => {
      timer.setTimeout('test', () => {}, 1000);
      timer.clear('test');
      expect(timer.has('test')).toBe(false);
    }));
  });

  describe('memory leak prevention', () => {
    it('should not accumulate completed timeouts', fakeAsync(() => {
      for (let i = 0; i < 100; i++) {
        timer.setTimeout(`test${i}`, () => {}, 10);
      }

      tick(20);
      expect(timer.getActiveCount()).toBe(0);
    }));

    it('should handle timer name reuse efficiently', fakeAsync(() => {
      for (let i = 0; i < 1000; i++) {
        timer.setTimeout('reused', () => {}, 10);
      }

      expect(timer.getActiveCount()).toBe(1);
      tick(10);
      expect(timer.getActiveCount()).toBe(0);
    }));

    it('should cleanup properly when mixing operations', fakeAsync(() => {
      timer.setTimeout('test1', () => {}, 100);
      timer.setInterval('test2', () => {}, 50);
      timer.setTimeout('test3', () => {}, 200);

      tick(250);
      timer.clearAll();

      expect(timer.getActiveCount()).toBe(0);
      discardPeriodicTasks();
    }));
  });

  describe('edge cases', () => {
    it('should handle 0 delay', fakeAsync(() => {
      let executed = false;

      timer.setTimeout(
        'test',
        () => {
          executed = true;
        },
        0
      );

      tick(1);
      expect(executed).toBe(true);
    }));

    it('should handle very long delays', fakeAsync(() => {
      let executed = false;

      timer.setTimeout(
        'test',
        () => {
          executed = true;
        },
        99999999
      );

      tick(99999998);
      expect(executed).toBe(false);

      tick(1);
      expect(executed).toBe(true);
    }));

    it('should handle empty callback name', fakeAsync(() => {
      let executed = false;

      timer.setTimeout(
        '',
        () => {
          executed = true;
        },
        100
      );

      tick(100);
      expect(executed).toBe(true);
    }));

    it('should handle special characters in names', () => {
      timer.setTimeout('test-timer.v1:alpha', () => {}, 100);
      expect(timer.has('test-timer.v1:alpha')).toBe(true);
    });
  });
});
