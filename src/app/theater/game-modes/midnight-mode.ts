import { BaseGameMode, GameModeContext } from './base-game-mode';
import { GAME_DURATIONS } from '../theater.constants';

/**
 * Midnight Madness mode
 * Faster seat movement with periodic blackouts
 */
export class MidnightMode extends BaseGameMode {
  constructor(context: GameModeContext) {
    super(context);
  }

  start(): void {
    const duration = GAME_DURATIONS.midnight;
    this.context.setTimer(duration);
    this.context.selectRandomSeat();
    this.context.startGameTimer(duration);
    this.context.scheduleBlackouts();
  }

  getName(): string {
    return 'Midnight Madness';
  }

  getId(): string {
    return 'midnight';
  }
}
