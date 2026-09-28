import { BaseGameMode, GameModeContext } from './base-game-mode';

/**
 * Classic game mode
 * Standard gameplay with basic timer and seat selection
 */
export class ClassicMode extends BaseGameMode {
  constructor(context: GameModeContext) {
    super(context);
  }

  start(): void {
    this.context.selectRandomSeat();
    this.context.startGameTimer();
  }

  getName(): string {
    return 'Classic Mode';
  }

  getId(): string {
    return 'classic';
  }
}
