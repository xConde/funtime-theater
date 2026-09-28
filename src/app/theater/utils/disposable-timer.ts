/**
 * Utility class for managing timers with automatic cleanup
 * Prevents memory leaks by centralizing timer management
 */
type TimerId = ReturnType<typeof setTimeout>;

export class DisposableTimer {
  private timers: Map<string, TimerId> = new Map();
  private intervals: Set<TimerId> = new Set();
  private timeouts: Set<TimerId> = new Set();

  /**
   * Create a named timeout
   */
  setTimeout(name: string, callback: () => void, delay: number): void {
    this.clearTimeout(name);
    const timer = setTimeout(() => {
      callback();
      this.timers.delete(name);
      this.timeouts.delete(timer);
    }, delay);
    this.timers.set(name, timer);
    this.timeouts.add(timer);
  }

  /**
   * Create a named interval
   */
  setInterval(name: string, callback: () => void, delay: number): void {
    this.clearInterval(name);
    const timer = setInterval(callback, delay);
    this.timers.set(name, timer);
    this.intervals.add(timer);
  }

  /**
   * Clear a specific timeout by name
   */
  clearTimeout(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(name);
      this.timeouts.delete(timer);
    }
  }

  /**
   * Clear a specific interval by name
   */
  clearInterval(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(name);
      this.intervals.delete(timer);
    }
  }

  /**
   * Clear a timer (timeout or interval) by name
   */
  clear(name: string): void {
    const timer = this.timers.get(name);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(name);
      this.timeouts.delete(timer);
      this.intervals.delete(timer);
    }
  }

  /**
   * Clear all timers
   */
  clearAll(): void {
    this.timeouts.forEach((timer) => {
      try {
        clearTimeout(timer);
      } catch {
        /* zone.js scheduler may be torn down during test teardown */
      }
    });
    this.intervals.forEach((timer) => {
      try {
        clearInterval(timer);
      } catch {
        /* zone.js scheduler may be torn down during test teardown */
      }
    });
    this.timers.clear();
    this.timeouts.clear();
    this.intervals.clear();
  }

  /**
   * Get count of active timers
   */
  getActiveCount(): number {
    return this.timers.size;
  }

  /**
   * Check if a timer exists
   */
  has(name: string): boolean {
    return this.timers.has(name);
  }
}
