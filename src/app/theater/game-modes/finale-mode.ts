import { BaseGameMode, GameModeContext } from './base-game-mode';
import { GAME_MECHANICS } from '../theater.constants';

/**
 * Grand Finale mode
 * Endless mode with increased speed multiplier
 */
export class FinaleMode extends BaseGameMode {
  constructor(context: GameModeContext) {
    super(context);
  }

  start(): void {
    this.context.setTimer(-1);
    this.context.selectRandomSeat();
    this.context.startSeatMovement();
    this.context.setEndlessSpeedMultiplier(GAME_MECHANICS.ENDLESS_BASE_SPEED);
  }

  getName(): string {
    return 'Grand Finale';
  }

  getId(): string {
    return 'finale';
  }
}
