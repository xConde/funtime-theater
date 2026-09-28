import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  effect,
  EventEmitter,
  HostListener,
  inject,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { GameService } from '../game.service';
import { Achievement, AchievementsService } from '../achievements.service';
import { SavedGameMode, SavedPowerUp } from '../theater.model';
import {
  calculatePowerUpCost,
  GAME_BALANCE,
  GAME_MODE_FEES,
  GAME_MODE_LEVEL_REQUIREMENTS,
  GAME_MODE_MULTIPLIERS,
  INITIAL_POWER_UP_COSTS,
  powerUpLevelCap,
} from '../theater.constants';
import { StorageService } from '../services/storage.service';
import { TheaterIconService } from '../services/theater-icon.service';
import { getPowerUpIcon } from '../utils/icons';
import { FocusTrapDirective } from '@shared/directives/focus-trap.directive';
import { AttractScreenComponent } from './attract-screen/attract-screen.component';
import { ComingSoonComponent } from './coming-soon/coming-soon.component';
import { concessionDescription, ConcessionId } from './power-up-description.helpers';

export interface GameMode {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  highScore?: number;
  theme?: string;
  ticketMultiplier?: number;
  entryFee?: number;
  levelRequired?: number;
  minted?: boolean;
}

export interface PowerUp {
  id: ConcessionId;
  name: string;
  description: string;
  cost: number;
  icon: string;
  owned: number;
}

export interface TheaterEntryRequest {
  gameMode: string;
  focusInitialTarget: boolean;
}

export type LobbyTab = 'play' | 'shop' | 'stats';

@Component({
  selector: 'app-lobby',
  templateUrl: './lobby.component.html',
  styleUrls: ['./lobby.component.scss'],
  standalone: true,
  imports: [FocusTrapDirective, AttractScreenComponent, ComingSoonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LobbyComponent implements OnInit {
  private gameService = inject(GameService);
  private achievementsService = inject(AchievementsService);
  private storageService = inject(StorageService);
  private iconService = inject(TheaterIconService);
  private cdr = inject(ChangeDetectorRef);
  @Input() show = false;
  @Output() enterTheater = new EventEmitter<TheaterEntryRequest>();
  @Output() closeLobby = new EventEmitter<void>();

  selectedMode = 'classic';
  playerTickets: number = GAME_BALANCE.STARTING_COINS;
  currentGameTickets = 0;
  playerName = 'Player 1';
  activeTab: LobbyTab = 'play';
  totalGamesPlayed = 0;
  playerLevel = 1;
  levelProgress = 0;
  totalXP = 0;
  achievements: Achievement[] = [];
  unlockedAchievements = 0;
  totalAchievements = 0;

  isPaused = false;
  pausedGameMode: string | null = null;
  totalCoinsEarned = 0;
  favoriteMode = 'None yet';
  private purchaseInProgress = false;

  gameModes: GameMode[] = [
    {
      id: 'classic',
      name: 'Happy Hour',
      description: 'A forgiving room and the best place to learn the floor.',
      icon: 'fa-smile',
      unlocked: true,
      highScore: 0,
      theme: 'happy',
      ticketMultiplier: GAME_MODE_MULTIPLIERS.classic,
      entryFee: GAME_MODE_FEES.classic,
      levelRequired: GAME_MODE_LEVEL_REQUIREMENTS.classic,
    },
    {
      id: 'midnight',
      name: 'Midnight Madness',
      description: 'A shorter late show with blackouts and triple receipts.',
      icon: 'fa-moon',
      unlocked: false,
      highScore: 0,
      theme: 'midnight',
      ticketMultiplier: GAME_MODE_MULTIPLIERS.midnight,
      entryFee: GAME_MODE_FEES.midnight,
      levelRequired: GAME_MODE_LEVEL_REQUIREMENTS.midnight,
    },
    {
      id: 'carnival',
      name: 'Carnival Chaos',
      description: 'The whole floor shifts while every catch pays eightfold.',
      icon: 'fa-masks-theater',
      unlocked: false,
      highScore: 0,
      theme: 'carnival',
      ticketMultiplier: GAME_MODE_MULTIPLIERS.carnival,
      entryFee: GAME_MODE_FEES.carnival,
      levelRequired: GAME_MODE_LEVEL_REQUIREMENTS.carnival,
    },
    {
      id: 'finale',
      name: 'Grand Finale',
      description: 'An endless house, built for the longest possible streak.',
      icon: 'fa-fire',
      unlocked: false,
      highScore: 0,
      theme: 'finale',
      ticketMultiplier: GAME_MODE_MULTIPLIERS.finale,
      entryFee: GAME_MODE_FEES.finale,
      levelRequired: GAME_MODE_LEVEL_REQUIREMENTS.finale,
    },
  ];

  powerUps: PowerUp[] = [
    {
      id: 'ticketMultiplier',
      name: 'Golden Popcorn',
      description: concessionDescription('ticketMultiplier', 0),
      cost: INITIAL_POWER_UP_COSTS.ticketMultiplier,
      icon: 'fa-popcorn',
      owned: 0,
    },
    {
      id: 'magneticField',
      name: 'Theater Spotlight',
      description: concessionDescription('magneticField', 0),
      cost: INITIAL_POWER_UP_COSTS.magneticField,
      icon: 'fa-lightbulb',
      owned: 0,
    },
    {
      id: 'passiveIncome',
      name: 'Box Office Royalties',
      description: concessionDescription('passiveIncome', 0),
      cost: INITIAL_POWER_UP_COSTS.passiveIncome,
      icon: 'fa-ticket',
      owned: 0,
    },
    {
      id: 'autoClicker',
      name: 'Usher Assistant',
      description: concessionDescription('autoClicker', 0),
      cost: INITIAL_POWER_UP_COSTS.autoClicker,
      icon: 'fa-user-tie',
      owned: 0,
    },
    {
      id: 'luckyStreak',
      name: 'Lucky Clover',
      description: concessionDescription('luckyStreak', 0),
      cost: INITIAL_POWER_UP_COSTS.luckyStreak,
      icon: 'fa-clover',
      owned: 0,
    },
    {
      id: 'comboMaster',
      name: 'Hot Streak',
      description: concessionDescription('comboMaster', 0),
      cost: INITIAL_POWER_UP_COSTS.comboMaster,
      icon: 'fa-fire',
      owned: 0,
    },
    {
      id: 'ticketStorm',
      name: 'Confetti Cannon',
      description: concessionDescription('ticketStorm', 0),
      cost: INITIAL_POWER_UP_COSTS.ticketStorm,
      icon: 'fa-gift',
      owned: 0,
    },
    {
      id: 'seatUpgrade',
      name: 'Velvet Seats',
      description: concessionDescription('seatUpgrade', 0),
      cost: INITIAL_POWER_UP_COSTS.seatUpgrade,
      icon: 'fa-couch',
      owned: 0,
    },
    {
      id: 'criticalHit',
      name: 'Lucky Dice',
      description: concessionDescription('criticalHit', 0),
      cost: INITIAL_POWER_UP_COSTS.criticalHit,
      icon: 'fa-dice',
      owned: 0,
    },
  ];

  constructor() {
    this.loadPlayerData();
    this.updatePowerUpDescriptions();

    effect(() => {
      this.playerLevel = this.gameService.currentLevel();
    });

    effect(() => {
      this.levelProgress = this.gameService.levelProgress();
    });

    effect(() => {
      this.totalXP = this.gameService.totalXP();
    });

    effect(() => {
      this.achievements = this.achievementsService.achievements();
      this.unlockedAchievements = this.achievementsService.getUnlockedCount();
      this.totalAchievements = this.achievementsService.getTotalCount();
    });
  }

  get totalTickets(): number {
    return this.playerTickets + this.currentGameTickets;
  }

  ngOnInit(): void {
    this.currentGameTickets = this.gameService.getCurrentGameTickets();
    this.updatePausedGameState();
  }

  /**
   * Get Phosphor icon HTML for a power-up
   * Icons use fill="currentColor" to inherit CSS color
   */
  getPowerUpIconHtml(powerUpId: string): SafeHtml {
    const iconName = getPowerUpIcon(powerUpId);
    return this.iconService.getIconHtml(iconName);
  }

  /** Bespoke SVG for an achievement's icon field — see TheaterIconService. */
  getAchievementIconHtml(achievement: Achievement): SafeHtml {
    return this.iconService.getIconHtml(achievement.icon);
  }

  changeTab(tab: LobbyTab): void {
    this.activeTab = tab;
    this.cdr.markForCheck();
  }

  onTablistKeydown(event: KeyboardEvent, currentTab: LobbyTab): void {
    const tabs: readonly LobbyTab[] = ['play', 'shop', 'stats'];
    const currentIndex = tabs.indexOf(currentTab);
    let nextIndex: number;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        nextIndex = (currentIndex + 1) % tabs.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = tabs.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const nextTab = tabs[nextIndex];
    this.changeTab(nextTab);
    queueMicrotask(() => document.getElementById(`lobby-tab-${nextTab}`)?.focus());
  }

  private updatePausedGameState(): void {
    this.isPaused = this.gameService.hasPausedGame();
    this.pausedGameMode = this.isPaused ? this.gameService.getPausedGameMode() : null;
    if (this.pausedGameMode && this.gameModes.some((mode) => mode.id === this.pausedGameMode)) {
      this.selectedMode = this.pausedGameMode;
    }
  }

  hasPausedGame(): boolean {
    return this.isPaused;
  }

  getPausedGameMode(): string | null {
    return this.pausedGameMode;
  }

  /** True once a concession has reached the level where buying more would do nothing. */
  isAtLevelCap(powerUp: PowerUp): boolean {
    return powerUp.owned >= powerUpLevelCap(powerUp.id);
  }

  canAffordMode(mode: GameMode): boolean {
    if (mode.unlocked) return true;
    const cost = mode.entryFee ?? GAME_MODE_FEES.classic;
    const levelRequired = mode.levelRequired ?? 1;
    return this.playerTickets >= cost && this.playerLevel >= levelRequired;
  }

  meetsLevelRequirement(mode: GameMode): boolean {
    return this.playerLevel >= (mode.levelRequired ?? 1);
  }

  handleModeSelection(mode: GameMode): void {
    if (this.hasPausedGame()) return;
    this.selectedMode = mode.id;
    this.cdr.markForCheck();
  }

  get selectedGameMode(): GameMode {
    return this.gameModes.find((mode) => mode.id === this.selectedMode) ?? this.gameModes[0];
  }

  get selectedModeActionLabel(): string {
    if (this.hasPausedGame()) {
      return `Return to ${this.selectedGameMode.name}`;
    }

    const mode = this.selectedGameMode;
    if (mode.unlocked) return 'Take your seat';

    const requiredLevel = mode.levelRequired ?? 1;
    if (this.playerLevel < requiredLevel) return `Opens at level ${requiredLevel}`;

    const fee = mode.entryFee ?? 0;
    if (this.playerTickets < fee) return `Need ${fee - this.playerTickets} more tickets`;
    return `Unlock for ${fee} tickets`;
  }

  get canConfirmSelectedMode(): boolean {
    if (this.hasPausedGame()) return true;
    const mode = this.selectedGameMode;
    return mode.unlocked || this.canAffordMode(mode);
  }

  modeSelectionLabel(mode: GameMode): string {
    if (mode.unlocked) return `${mode.name}, available show`;

    const levelRequired = mode.levelRequired ?? 1;
    if (this.playerLevel < levelRequired) return `${mode.name}, locked, opens at level ${levelRequired}`;

    const fee = mode.entryFee ?? 0;
    if (this.playerTickets < fee) {
      return `${mode.name}, locked, costs ${fee} tickets, ${fee - this.playerTickets} tickets short`;
    }
    return `${mode.name}, locked, unlock for ${fee} tickets`;
  }

  confirmSelectedMode(event?: MouseEvent): void {
    // Native keyboard button activation dispatches a click with detail 0.
    // Carry that modality across the lobby unmount so the first target can
    // receive focus without stealing it from touch/mouse users.
    const focusInitialTarget = event?.detail === 0;

    if (this.hasPausedGame()) {
      this.enterTheater.emit({ gameMode: 'resume', focusInitialTarget });
      return;
    }

    const mode = this.selectedGameMode;
    if (!mode.unlocked) {
      this.unlockMode(mode);
      return;
    }
    this.enterTheater.emit({ gameMode: mode.id, focusInitialTarget });
  }

  powerUpPurchaseLabel(powerUp: PowerUp): string {
    if (this.isAtLevelCap(powerUp)) return `${powerUp.name}, fully upgraded`;
    if (this.playerTickets < powerUp.cost) {
      return `${powerUp.name}, ${powerUp.cost - this.playerTickets} tickets short`;
    }
    return `Buy ${powerUp.name} for ${powerUp.cost} tickets`;
  }

  powerUpPriceLabel(powerUp: PowerUp): string {
    if (this.isAtLevelCap(powerUp)) return 'Fully upgraded';
    if (this.playerTickets < powerUp.cost) return `${powerUp.cost - this.playerTickets} short`;
    return `${powerUp.cost} tickets`;
  }

  buyPowerUp(powerUp: PowerUp): void {
    if (this.purchaseInProgress) {
      return;
    }
    if (this.isAtLevelCap(powerUp)) {
      return;
    }
    this.purchaseInProgress = true;

    try {
      // Refresh the full record before building the transaction so fields
      // owned by gameplay (mode stats and trigger counts) survive the write.
      const currentData = this.storageService.loadGameData();
      this.playerTickets = currentData.coins;
      const savedPowerUp = currentData.powerUps.find((item) => item.id === powerUp.id);
      const currentOwned = Math.max(powerUp.owned, savedPowerUp?.owned ?? 0);

      if (currentOwned >= powerUpLevelCap(powerUp.id)) {
        powerUp.owned = currentOwned;
        powerUp.cost = calculatePowerUpCost(powerUp.id, currentOwned);
        return;
      }

      const purchaseCost = calculatePowerUpCost(powerUp.id, currentOwned);
      if (this.playerTickets >= purchaseCost) {
        const nextOwned = currentOwned + 1;
        const nextBalance = this.playerTickets - purchaseCost;
        const nextPowerUps = this.toSavedPowerUps(currentData.powerUps).map((item) => ({
          ...item,
          owned: item.id === powerUp.id ? nextOwned : item.owned,
        }));

        // Balance + ownership are one localStorage write. Committing the UI
        // only after it succeeds prevents a quota failure from charging the
        // player without preserving the upgrade.
        if (
          !this.storageService.saveGameData({
            coins: nextBalance,
            name: this.playerName,
            gameModes: this.toSavedGameModes(currentData.gameModes),
            powerUps: nextPowerUps,
          })
        ) {
          return;
        }

        this.playerTickets = nextBalance;
        powerUp.owned = nextOwned;
        powerUp.cost = calculatePowerUpCost(powerUp.id, powerUp.owned);

        this.updatePowerUpDescriptions();

        const totalUsage = this.powerUps.reduce((total, p) => total + p.owned, 0);
        this.achievementsService.updateProgress('power_user', totalUsage);

        // Today this re-render is driven by the zone-patched click event
        // that reached buyPowerUp; explicit markForCheck future-proofs
        // against a zoneless migration.
        this.cdr.markForCheck();
      }
    } finally {
      this.purchaseInProgress = false;
    }
  }

  updatePowerUpDescriptions(): void {
    this.powerUps.forEach((powerUp) => {
      powerUp.description = concessionDescription(powerUp.id, powerUp.owned);
    });
  }

  unlockMode(mode: GameMode): boolean {
    if (this.purchaseInProgress) {
      return false;
    }
    this.purchaseInProgress = true;

    try {
      const unlockCost = mode.entryFee ?? GAME_MODE_FEES.classic;
      const levelRequired = mode.levelRequired ?? 1;

      if (this.playerLevel < levelRequired) {
        return false;
      }

      // Refresh the full record before building the transaction so fields
      // owned by gameplay survive the lobby write.
      const currentData = this.storageService.loadGameData();
      this.playerTickets = currentData.coins;

      if (this.playerTickets >= unlockCost && !mode.unlocked) {
        const nextBalance = this.playerTickets - unlockCost;
        const modeIndex = this.gameModes.findIndex((m) => m.id === mode.id);
        const previousMode = modeIndex > 0 ? this.gameModes[modeIndex - 1] : null;
        const shouldMintPrevious = !!previousMode?.unlocked && !previousMode.minted;
        const nextGameModes = this.toSavedGameModes(currentData.gameModes).map((item) => ({
          ...item,
          unlocked: item.id === mode.id ? true : item.unlocked,
          minted: shouldMintPrevious && item.id === previousMode?.id ? true : item.minted,
        }));

        // Unlock + balance are persisted together for the same reason as a
        // concession purchase: either the complete transaction lands or the
        // live lobby remains unchanged.
        if (
          !this.storageService.saveGameData({
            coins: nextBalance,
            name: this.playerName,
            gameModes: nextGameModes,
            powerUps: this.toSavedPowerUps(currentData.powerUps),
          })
        ) {
          return false;
        }

        this.playerTickets = nextBalance;
        mode.unlocked = true;
        if (shouldMintPrevious && previousMode) {
          previousMode.minted = true;
        }

        this.cdr.markForCheck();
        return true;
      }
      return false;
    } finally {
      this.purchaseInProgress = false;
    }
  }

  getTotalGamesPlayed(): number {
    return this.totalGamesPlayed;
  }

  getBestScore(): number {
    return Math.max(...this.gameModes.map((m) => m.highScore || 0), 0);
  }

  private computeFavoriteMode(savedModes: SavedGameMode[]): string {
    if (!savedModes || savedModes.length === 0) return 'None yet';
    const mostPlayed = savedModes.reduce(
      (best, mode) => ((mode.gamesPlayed ?? 0) > (best.gamesPlayed ?? 0) ? mode : best),
      savedModes[0]
    );
    if ((mostPlayed.gamesPlayed ?? 0) === 0) return 'None yet';
    const modeEntry = this.gameModes.find((m) => m.id === mostPlayed.id);
    return modeEntry?.name ?? mostPlayed.id;
  }

  private loadPlayerData(): void {
    const data = this.storageService.loadGameData();
    this.playerTickets = data.coins ?? GAME_BALANCE.STARTING_COINS;
    this.playerName = data.name || 'Player 1';
    this.totalGamesPlayed = data.totalGamesPlayed ?? 0;
    this.totalCoinsEarned = data.totalCoinsEarned ?? data.coins ?? 0;
    this.favoriteMode = this.computeFavoriteMode(data.gameModes);

    if (data.gameModes) {
      this.gameModes.forEach((mode) => {
        const savedMode = data.gameModes.find((m: SavedGameMode) => m.id === mode.id);
        if (savedMode) {
          mode.unlocked = savedMode.unlocked;
          mode.highScore = savedMode.highScore || 0;
          mode.minted = savedMode.minted || false;
        }
      });
    }

    if (data.powerUps) {
      this.powerUps.forEach((powerUp) => {
        const savedPowerUp = data.powerUps.find((p: SavedPowerUp) => p.id === powerUp.id);
        if (savedPowerUp) {
          powerUp.owned = savedPowerUp.owned || 0;
          powerUp.cost = calculatePowerUpCost(powerUp.id, powerUp.owned);
        }
      });
    }
  }

  private savePlayerData(): void {
    // Only write lobby-owned fields. Coins, totalGamesPlayed, and totalXP are
    // managed atomically by their respective storage methods (addCoins,
    // incrementGamesPlayed, updateXP) — writing stale local copies here would
    // overwrite concurrent mutations from endGame(). Purchase paths are the
    // exception: they intentionally persist coins with the purchased state in
    // one write before committing their live UI state.
    const currentData = this.storageService.loadGameData();
    this.storageService.saveGameData({
      name: this.playerName,
      gameModes: this.toSavedGameModes(currentData.gameModes),
      powerUps: this.toSavedPowerUps(currentData.powerUps),
    });
  }

  private toSavedGameModes(existingModes: SavedGameMode[]): SavedGameMode[] {
    const knownIds = new Set(this.gameModes.map((mode) => mode.id));
    const lobbyModes = this.gameModes.map((mode) => {
      const existing = existingModes.find((savedMode) => savedMode.id === mode.id);
      return {
        ...existing,
        id: mode.id,
        unlocked: mode.unlocked || existing?.unlocked || false,
        highScore: Math.max(mode.highScore || 0, existing?.highScore || 0),
        minted: mode.minted || existing?.minted,
      };
    });
    return [...lobbyModes, ...existingModes.filter((mode) => !knownIds.has(mode.id))];
  }

  private toSavedPowerUps(existingPowerUps: SavedPowerUp[]): SavedPowerUp[] {
    const knownIds = new Set<string>(this.powerUps.map((powerUp) => powerUp.id));
    const lobbyPowerUps = this.powerUps.map((powerUp) => {
      const existing = existingPowerUps.find((savedPowerUp) => savedPowerUp.id === powerUp.id);
      return {
        ...existing,
        id: powerUp.id,
        owned: Math.max(powerUp.owned, existing?.owned ?? 0),
      };
    });
    return [...lobbyPowerUps, ...existingPowerUps.filter((powerUp) => !knownIds.has(powerUp.id))];
  }

  close(): void {
    this.savePlayerData();
    this.closeLobby.emit();
  }

  /**
   * Esc dismisses the lobby ONLY when there is a paused game to return to.
   * Without an in-flight game, dismissing leaves the user looking at the
   * theater chrome with no game running — the lobby IS the entrypoint, so
   * Esc has no meaningful destination.
   *
   * @HostListener types its `$event` arg as `Event` (Angular's prod build is
   * stricter than `tsc --noEmit`), so narrow with `instanceof` here.
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.show) return;
    if (!this.isPaused) return;
    if (!(event instanceof KeyboardEvent)) return;
    event.preventDefault();
    this.close();
  }
}
