import { BaseGameMode, GameModeContext } from './base-game-mode';
import { GAME_DURATIONS } from '../theater.constants';

/**
 * Carnival Chaos mode
 * Seats move in predictable circular patterns
 */
export class CarnivalMode extends BaseGameMode {
  constructor(context: GameModeContext) {
    super(context);
  }

  start(): void {
    const duration = GAME_DURATIONS.carnival;
    this.context.setTimer(duration);
    this.context.selectRandomSeat();
    this.context.startGameTimer(duration);
    this.context.setCarnivalMode(true);
  }

  getName(): string {
    return 'Carnival Chaos';
  }

  getId(): string {
    return 'carnival';
  }

  override cleanup(): void {
    this.context.setCarnivalMode(false);
  }
}
