import { BaseGameMode, GameModeContext } from './base-game-mode';
import { GAME_DURATIONS } from '../theater.constants';

/**
 * Time Attack mode
 * Extended time limit with faster gameplay
 */
export class TimeAttackMode extends BaseGameMode {
  constructor(context: GameModeContext) {
    super(context);
  }

  start(): void {
    const duration = GAME_DURATIONS.timeAttack;
    this.context.setTimer(duration);
    this.context.selectRandomSeat();
    this.context.startGameTimer(duration);
  }

  getName(): string {
    return 'Time Attack';
  }

  getId(): string {
    return 'timeAttack';
  }
}
