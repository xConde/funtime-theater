/**
 * Theater Feature Type Definitions
 * Centralized type system for the Funtime Theater application
 *
 * Design Philosophy:
 * - All types and interfaces should be defined here
 * - Use descriptive names that indicate the purpose
 * - Group related types together
 * - Prefer interfaces over types for object shapes
 * - Use type guards for runtime type checking
 */

// Game State Types
export interface SavedGameData {
  coins: number;
  name: string;
  totalGamesPlayed: number;
  totalXP: number;
  gameModes: SavedGameMode[];
  powerUps: SavedPowerUp[];
  totalCoinsEarned?: number; // v2: lifetime tickets earned (includes spent)
  schemaVersion?: number; // Optional for backward compat with v0 (no version)
  lastSaved?: number; // Unix timestamp of last save
}

export interface SavedGameMode {
  id: string;
  unlocked: boolean;
  highScore: number;
  minted?: boolean;
  gamesPlayed?: number; // v2: per-mode game count
  totalEarnings?: number; // v2: per-mode lifetime earnings
  bestMultiplier?: number; // v2: highest multiplier reached in this mode
}

export interface SavedPowerUp {
  id: string;
  owned: number;
  timesTriggered?: number; // v2: lifetime activation/trigger count
}

export interface SavedAchievement {
  id: string;
  unlocked: boolean;
  unlockedAt?: Date;
  progress?: number;
}

export interface PausedGameState {
  mode: string;
  score: number;
  multiplier: number;
  timer: number;
  remainingTime: number;
  clickedCount: number;
  activePowerUps: [string, number][];
  doublePointsActive: boolean;
  slowTimeActive: boolean;
  timestamp: number;
}

// Sound System Types
export interface AudioWithPlaySound extends HTMLAudioElement {
  playSound?: () => void;
}

// Power-Up System Types
export type PowerUpId =
  | 'ticketMultiplier'
  | 'magneticField'
  | 'passiveIncome'
  | 'autoClicker'
  | 'luckyStreak'
  | 'comboMaster'
  | 'ticketStorm'
  | 'seatUpgrade'
  | 'criticalHit'
  | 'doublePoints'
  | 'slowTime'
  | 'multiSelect'
  | 'extraTime';

// Animation Types
export interface AnimationTimeout {
  [key: string]: ReturnType<typeof setTimeout>;
}
