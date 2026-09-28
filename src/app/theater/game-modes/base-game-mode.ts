/**
 * Context interface for game modes
 * Provides all necessary dependencies and methods
 */
export interface GameModeContext {
  setTimer(seconds: number): void;
  selectRandomSeat(): void;
  startGameTimer(seconds?: number): void;
  startSeatMovement(): void;
  showMemorySequence(): void;
  scheduleBlackouts(): void;
  setEndlessSpeedMultiplier(multiplier: number): void;
  setCarnivalMode(enabled: boolean): void;
}

/**
 * Base class for all game mode strategies
 * Implements the Strategy pattern for different game modes
 */
export abstract class BaseGameMode {
  constructor(protected context: GameModeContext) {}

  /**
   * Start the game mode
   * Each mode implements its own logic
   */
  abstract start(): void;

  /**
   * Get the display name of the game mode
   */
  abstract getName(): string;

  /**
   * Get the game mode ID
   */
  abstract getId(): string;

  /**
   * Handle cleanup when mode ends (optional)
   */
  cleanup(): void {
    // Default: no cleanup needed
  }
}
