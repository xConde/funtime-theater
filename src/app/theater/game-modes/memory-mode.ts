import { BaseGameMode, GameModeContext } from './base-game-mode';

/**
 * Memory mode
 * Remember and repeat seat sequences
 */
export class MemoryMode extends BaseGameMode {
  constructor(context: GameModeContext) {
    super(context);
  }

  start(): void {
    this.context.showMemorySequence();
  }

  getName(): string {
    return 'Memory Mode';
  }

  getId(): string {
    return 'memory';
  }
}
