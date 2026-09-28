import { BaseGameMode, GameModeContext } from './base-game-mode';

/**
 * Endless mode
 * No time limit, game ends on first miss
 * Speed increases progressively
 */
export class EndlessMode extends BaseGameMode {
  constructor(context: GameModeContext) {
    super(context);
  }

  start(): void {
    this.context.setTimer(-1);
    this.context.selectRandomSeat();
    this.context.startSeatMovement();
  }

  getName(): string {
    return 'Endless Mode';
  }

  getId(): string {
    return 'endless';
  }
}
