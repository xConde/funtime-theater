import { Injectable, signal, WritableSignal } from '@angular/core';
import { PausedGameState, SavedAchievement, SavedGameData, SavedGameMode, SavedPowerUp } from '../theater.model';
import { GAME_BALANCE, STORAGE_KEYS } from '../theater.constants';

const CURRENT_SCHEMA_VERSION = 2;

/**
 * `error.code === 22` is the legacy DOMException code for a quota error;
 * `error.name === 'QuotaExceededError'` is the modern equivalent. Some
 * browsers (Safari in private mode) fire `'QUOTA_EXCEEDED_ERR'` instead.
 */
function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'QUOTA_EXCEEDED_ERR' ||
    error.code === 22 ||
    error.code === 1014 // Firefox
  );
}

type Migration = (data: SavedGameData) => SavedGameData;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStorageId(value: unknown): value is string {
  // Current IDs are camelCase, but saves are a long-lived boundary. Accept
  // conventional kebab/snake IDs as well so a future release (or a legacy
  // save) is not silently discarded, while still rejecting paths, spaces,
  // control characters, and punctuation.
  return typeof value === 'string' && /^[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*$/.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function normalizeGameModes(value: unknown): SavedGameMode[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: SavedGameMode[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isStorageId(entry['id']) || seen.has(entry['id'])) continue;
    seen.add(entry['id']);

    const mode: SavedGameMode = {
      id: entry['id'],
      unlocked: typeof entry['unlocked'] === 'boolean' ? entry['unlocked'] : false,
      highScore: isNonNegativeInteger(entry['highScore']) ? entry['highScore'] : 0,
    };
    if (typeof entry['minted'] === 'boolean') mode.minted = entry['minted'];
    if (isNonNegativeInteger(entry['gamesPlayed'])) mode.gamesPlayed = entry['gamesPlayed'];
    if (isNonNegativeInteger(entry['totalEarnings'])) mode.totalEarnings = entry['totalEarnings'];
    if (
      typeof entry['bestMultiplier'] === 'number' &&
      Number.isFinite(entry['bestMultiplier']) &&
      entry['bestMultiplier'] >= 1
    ) {
      mode.bestMultiplier = entry['bestMultiplier'];
    }
    normalized.push(mode);
  }
  return normalized;
}

function normalizePowerUps(value: unknown): SavedPowerUp[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: SavedPowerUp[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !isStorageId(entry['id']) || seen.has(entry['id'])) continue;
    seen.add(entry['id']);

    const powerUp: SavedPowerUp = {
      id: entry['id'],
      owned: isNonNegativeInteger(entry['owned']) ? entry['owned'] : 0,
    };
    if (isNonNegativeInteger(entry['timesTriggered'])) powerUp.timesTriggered = entry['timesTriggered'];
    normalized.push(powerUp);
  }
  return normalized;
}

/**
 * Migrations indexed by the schema version they migrate FROM.
 * migrations[0] upgrades v0 → v1, migrations[1] upgrades v1 → v2, etc.
 */
const migrations: Migration[] = [
  // v0 → v1: add schemaVersion, lastSaved, and ensure all required fields exist
  (data: SavedGameData): SavedGameData => ({
    coins: typeof data.coins === 'number' && data.coins >= 0 ? data.coins : GAME_BALANCE.STARTING_COINS,
    name: typeof data.name === 'string' ? data.name : 'Player 1',
    totalGamesPlayed:
      typeof data.totalGamesPlayed === 'number' && data.totalGamesPlayed >= 0 ? data.totalGamesPlayed : 0,
    totalXP: typeof data.totalXP === 'number' && data.totalXP >= 0 ? data.totalXP : 0,
    gameModes: Array.isArray(data.gameModes) ? data.gameModes : [],
    powerUps: Array.isArray(data.powerUps) ? data.powerUps : [],
    schemaVersion: 1,
    lastSaved: Date.now(),
  }),
  // v1 → v2: add totalCoinsEarned (best estimate from current balance + spent on upgrades)
  (data: SavedGameData): SavedGameData => ({
    ...data,
    totalCoinsEarned: data.totalCoinsEarned ?? data.coins,
    schemaVersion: 2,
    lastSaved: Date.now(),
  }),
];

/**
 * Centralized localStorage management service
 * Provides type-safe, validated access to all persistent data
 * with schema migration and comprehensive error handling
 */
@Injectable({
  providedIn: 'root',
})
export class StorageService {
  private readonly GAME_DATA_KEY = STORAGE_KEYS.GAME_DATA;
  private readonly PAUSED_STATE_KEY = STORAGE_KEYS.PAUSED_GAME;
  private readonly ACHIEVEMENTS_KEY = STORAGE_KEYS.ACHIEVEMENTS;
  private readonly BACKUP_KEY = STORAGE_KEYS.BACKUP;

  // Write-through cache: avoids JSON.parse on every loadGameData() call
  private cachedGameData: SavedGameData | null = null;

  /**
   * Set to true the first time a save fails with QuotaExceededError. The
   * parent theater component reads this signal and surfaces a recovery
   * banner ("clear browser storage and reload") because reload-only
   * doesn't actually fix a full quota — the player must clear storage
   * manually. Sticky on purpose: a transient quota dip that recovers on
   * the next save still warrants the warning, since further mutations
   * may continue to be silently dropped on the floor.
   */
  readonly storageQuotaExceeded: WritableSignal<boolean> = signal(false);

  constructor() {}

  /**
   * Load game data with validation and migration
   */
  loadGameData(): SavedGameData {
    if (this.cachedGameData) {
      return this.deepCopyGameData(this.cachedGameData);
    }

    try {
      const raw = localStorage.getItem(this.GAME_DATA_KEY);
      if (!raw) {
        return this.getDefaultGameData();
      }

      const parsed: unknown = JSON.parse(raw);
      const inputVersion = (parsed as Partial<SavedGameData>).schemaVersion ?? 0;
      const migrated = this.runMigrations(parsed as Partial<SavedGameData>);
      const parsedData = parsed as Partial<SavedGameData>;
      const nestedEntriesWereRepaired =
        inputVersion === CURRENT_SCHEMA_VERSION &&
        (JSON.stringify(parsedData.gameModes) !== JSON.stringify(migrated.gameModes) ||
          JSON.stringify(parsedData.powerUps) !== JSON.stringify(migrated.powerUps));

      // Persist migrations and current-schema nested repairs. Without the
      // latter, the session would be safe through the normalized cache but
      // the same corrupt purchase data would return on the next page load.
      if (inputVersion < CURRENT_SCHEMA_VERSION || nestedEntriesWereRepaired) {
        // Snapshot pre-migration data as backup before writing migrated version
        if (inputVersion < CURRENT_SCHEMA_VERSION) {
          try {
            localStorage.setItem(this.BACKUP_KEY, raw);
          } catch {
            // Best-effort backup — don't block migration if storage is full
          }
        }
        try {
          localStorage.setItem(this.GAME_DATA_KEY, JSON.stringify(migrated));
        } catch {
          // Storage full or unavailable — session continues with in-memory migrated data
        }
      }

      this.cachedGameData = migrated;
      return this.deepCopyGameData(migrated);
    } catch (error) {
      console.error('Failed to load game data:', error);
      return this.getDefaultGameData();
    }
  }

  /**
   * Save game data with error handling
   */
  saveGameData(data: Partial<SavedGameData>): boolean {
    try {
      const existingData = this.loadGameData();
      const mergedData: SavedGameData = {
        ...existingData,
        ...data,
        lastSaved: Date.now(),
        schemaVersion: CURRENT_SCHEMA_VERSION,
      };

      if (!this.validateGameData(mergedData)) {
        console.error('Invalid game data structure:', mergedData);
        return false;
      }

      localStorage.setItem(this.GAME_DATA_KEY, JSON.stringify(mergedData));
      this.cachedGameData = mergedData;
      return true;
    } catch (error) {
      if (isQuotaExceededError(error)) {
        this.storageQuotaExceeded.set(true);
      }
      console.error('Failed to save game data:', error);
      return false;
    }
  }

  /**
   * Load achievements from localStorage
   */
  loadAchievements(): SavedAchievement[] {
    try {
      const raw = localStorage.getItem(this.ACHIEVEMENTS_KEY);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed as SavedAchievement[];
    } catch (error) {
      console.error('Failed to load achievements:', error);
      return [];
    }
  }

  /**
   * Save achievements to localStorage
   */
  saveAchievements(achievements: SavedAchievement[]): void {
    try {
      localStorage.setItem(this.ACHIEVEMENTS_KEY, JSON.stringify(achievements));
    } catch (error) {
      console.error('Failed to save achievements:', error);
    }
  }

  /**
   * Load paused game state with validation
   */
  loadPausedGameState(): PausedGameState | null {
    try {
      const raw = localStorage.getItem(this.PAUSED_STATE_KEY);
      if (!raw) {
        return null;
      }

      const state: unknown = JSON.parse(raw);

      if (!this.validatePausedState(state)) {
        this.clearPausedGameState();
        return null;
      }

      const EXPIRY_TIME = 48 * 60 * 60 * 1000;
      if (Date.now() - state.timestamp > EXPIRY_TIME) {
        this.clearPausedGameState();
        return null;
      }

      return state;
    } catch (error) {
      console.error('Failed to load paused game state:', error);
      this.clearPausedGameState();
      return null;
    }
  }

  /**
   * Save paused game state
   */
  savePausedGameState(state: PausedGameState): boolean {
    try {
      if (!this.validatePausedState(state)) {
        console.error('Invalid paused state structure:', state);
        return false;
      }

      localStorage.setItem(this.PAUSED_STATE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      if (isQuotaExceededError(error)) {
        this.storageQuotaExceeded.set(true);
      }
      console.error('Failed to save paused game state:', error);
      return false;
    }
  }

  /**
   * Clear paused game state
   */
  clearPausedGameState(): void {
    try {
      localStorage.removeItem(this.PAUSED_STATE_KEY);
    } catch (error) {
      console.error('Failed to clear paused game state:', error);
    }
  }

  /**
   * Check if a paused game exists
   */
  hasPausedGame(): boolean {
    return this.loadPausedGameState() !== null;
  }

  /**
   * Get the mode of the paused game
   */
  getPausedGameMode(): string | null {
    const state = this.loadPausedGameState();
    return state ? state.mode : null;
  }

  /**
   * Update specific game data field
   */
  updateGameDataField<K extends keyof SavedGameData>(field: K, value: SavedGameData[K]): boolean {
    const data = this.loadGameData();
    data[field] = value;
    return this.saveGameData(data);
  }

  /**
   * Update coins (tickets)
   */
  updateCoins(coins: number): boolean {
    if (!Number.isFinite(coins) || coins < 0) {
      console.error('Invalid coin value:', coins);
      return false;
    }
    return this.updateGameDataField('coins', coins);
  }

  /**
   * Add coins (tickets)
   */
  addCoins(amount: number): boolean {
    if (!Number.isFinite(amount) || amount < 0) {
      console.error('Invalid addCoins amount:', amount);
      return false;
    }
    const data = this.loadGameData();
    const newCoins = data.coins + amount;
    if (!Number.isFinite(newCoins) || newCoins < 0) {
      console.error('Invalid coin value:', newCoins);
      return false;
    }
    // Single write: update coins + lifetime earnings together
    return this.saveGameData({
      coins: newCoins,
      totalCoinsEarned: (data.totalCoinsEarned ?? 0) + amount,
    });
  }

  /**
   * Deduct coins (tickets)
   */
  deductCoins(amount: number): boolean {
    if (!Number.isFinite(amount) || amount < 0) {
      console.error('Invalid deductCoins amount:', amount);
      return false;
    }
    const data = this.loadGameData();
    const newCoins = Math.max(0, data.coins - amount);
    return this.updateCoins(newCoins);
  }

  /**
   * Get current coin balance
   */
  getCoins(): number {
    return this.loadGameData().coins;
  }

  /**
   * Update total XP
   */
  updateXP(xp: number): boolean {
    if (xp < 0) {
      console.error('Cannot set negative XP:', xp);
      return false;
    }
    return this.updateGameDataField('totalXP', xp);
  }

  /**
   * Add XP
   */
  addXP(amount: number): boolean {
    const data = this.loadGameData();
    return this.updateXP(data.totalXP + amount);
  }

  /**
   * Increment total games played
   */
  incrementGamesPlayed(): boolean {
    const data = this.loadGameData();
    return this.updateGameDataField('totalGamesPlayed', data.totalGamesPlayed + 1);
  }

  /**
   * Check if a backup save exists
   */
  hasBackup(): boolean {
    return localStorage.getItem(this.BACKUP_KEY) !== null;
  }

  /**
   * Restore from backup — replaces current save with pre-migration snapshot.
   * Returns true if restore succeeded.
   */
  restoreFromBackup(): boolean {
    try {
      const raw = localStorage.getItem(this.BACKUP_KEY);
      if (!raw) {
        return false;
      }
      localStorage.setItem(this.GAME_DATA_KEY, raw);
      this.cachedGameData = null;
      // Trigger migration on the restored data
      this.loadGameData();
      return true;
    } catch (error) {
      console.error('Failed to restore from backup:', error);
      return false;
    }
  }

  /**
   * Clear all game data (reset)
   */
  clearAllData(): void {
    try {
      localStorage.removeItem(this.GAME_DATA_KEY);
      localStorage.removeItem(this.PAUSED_STATE_KEY);
      localStorage.removeItem(this.ACHIEVEMENTS_KEY);
      localStorage.removeItem(this.BACKUP_KEY);
      this.cachedGameData = null;
    } catch (error) {
      console.error('Failed to clear all data:', error);
    }
  }

  /**
   * Validate and repair game data structure field-by-field.
   * Invalid fields are reset to defaults rather than rejecting the entire save.
   */
  private validateGameData(data: Partial<SavedGameData>): data is SavedGameData {
    let repaired = false;

    if (typeof data.coins !== 'number' || !Number.isFinite(data.coins) || data.coins < 0) {
      data.coins = GAME_BALANCE.STARTING_COINS;
      repaired = true;
    }
    if (typeof data.name !== 'string') {
      data.name = 'Player 1';
      repaired = true;
    }
    if (typeof data.totalGamesPlayed !== 'number' || data.totalGamesPlayed < 0) {
      data.totalGamesPlayed = 0;
      repaired = true;
    }
    if (typeof data.totalXP !== 'number' || data.totalXP < 0) {
      data.totalXP = 0;
      repaired = true;
    }
    const normalizedGameModes = normalizeGameModes(data.gameModes);
    if (!Array.isArray(data.gameModes)) {
      repaired = true;
    }
    data.gameModes = normalizedGameModes;

    const normalizedPowerUps = normalizePowerUps(data.powerUps);
    if (!Array.isArray(data.powerUps)) {
      repaired = true;
    }
    data.powerUps = normalizedPowerUps;
    if (
      data.totalCoinsEarned !== undefined &&
      (typeof data.totalCoinsEarned !== 'number' || data.totalCoinsEarned < 0)
    ) {
      data.totalCoinsEarned = data.coins;
      repaired = true;
    }

    if (repaired) {
      console.error('Repaired corrupted game data fields');
    }

    return true;
  }

  /**
   * Validate paused state structure
   */
  private validatePausedState(state: unknown): state is PausedGameState {
    if (!state || typeof state !== 'object') return false;

    const candidate = state as Partial<PausedGameState>;
    const isFiniteNonNegative = (value: unknown): value is number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const isNonNegativeInteger = (value: unknown): value is number =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0;
    const isUntimedCheckpoint = candidate.mode === 'endless' || candidate.mode === 'finale';
    const isValidTimer = (value: unknown): value is number =>
      isNonNegativeInteger(value) || (isUntimedCheckpoint && value === -1);
    const hasValidPowerUps =
      Array.isArray(candidate.activePowerUps) &&
      candidate.activePowerUps.every(
        (entry) =>
          Array.isArray(entry) &&
          entry.length === 2 &&
          typeof entry[0] === 'string' &&
          /^[a-z][a-zA-Z0-9]*$/.test(entry[0]) &&
          Number.isInteger(entry[1]) &&
          entry[1] >= 0
      );

    return (
      typeof candidate.mode === 'string' &&
      candidate.mode.length > 0 &&
      isFiniteNonNegative(candidate.score) &&
      typeof candidate.multiplier === 'number' &&
      Number.isFinite(candidate.multiplier) &&
      candidate.multiplier >= 1 &&
      isValidTimer(candidate.timer) &&
      isValidTimer(candidate.remainingTime) &&
      isNonNegativeInteger(candidate.clickedCount) &&
      hasValidPowerUps &&
      typeof candidate.doublePointsActive === 'boolean' &&
      typeof candidate.slowTimeActive === 'boolean' &&
      typeof candidate.timestamp === 'number' &&
      Number.isFinite(candidate.timestamp) &&
      candidate.timestamp > 0
    );
  }

  /**
   * Get default game data
   */
  /**
   * Deep-copy game data to prevent cache mutation via returned references.
   * Nested arrays (gameModes, powerUps) get new array + object copies.
   */
  private deepCopyGameData(data: SavedGameData): SavedGameData {
    return {
      ...data,
      gameModes: data.gameModes.map((m) => ({ ...m })),
      powerUps: data.powerUps.map((p) => ({ ...p })),
    };
  }

  private getDefaultGameData(): SavedGameData {
    return {
      coins: GAME_BALANCE.STARTING_COINS,
      // Lifetime earned must seed from the starting grant; omitting it made new
      // players' "Lifetime Earnings" fall back to the live balance (mislabeled).
      totalCoinsEarned: GAME_BALANCE.STARTING_COINS,
      name: 'Player 1',
      totalGamesPlayed: 0,
      totalXP: 0,
      gameModes: [],
      powerUps: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastSaved: Date.now(),
    };
  }

  /**
   * Run all pending migrations on raw data, then guarantee the final shape.
   *
   * Each migration step normalizes its own concerns; the trailing
   * `validateAndFillDefaults` call is a belt-and-suspenders safety net that
   * catches structural corruption surviving migrations. Concretely: a v1
   * save with a non-array `gameModes`/`powerUps` field (e.g. user edited
   * localStorage) skips the v0→v1 migration and runs only v1→v2, which
   * spreads `...data` and carries the corruption through. The safety net
   * forces the arrays back to a valid shape before the data hits any
   * caller.
   */
  private runMigrations(data: Partial<SavedGameData>): SavedGameData {
    // Treat missing schemaVersion as v0 (pre-versioned save)
    let currentVersion = data.schemaVersion ?? 0;

    // Start with the raw data coerced to SavedGameData shape
    let migrated = data as SavedGameData;

    while (currentVersion < CURRENT_SCHEMA_VERSION) {
      const migration = migrations[currentVersion];
      if (migration) {
        migrated = migration(migrated);
      }
      currentVersion++;
    }

    return this.validateAndFillDefaults(migrated);
  }

  /**
   * Validate data at current schema version and fill any missing required
   * fields. Optional fields (totalCoinsEarned) are preserved when present
   * and well-typed so that migrations setting them aren't silently dropped
   * on the way through the safety net.
   */
  private validateAndFillDefaults(data: Partial<SavedGameData>): SavedGameData {
    const defaults = this.getDefaultGameData();

    const result: SavedGameData = {
      coins: typeof data.coins === 'number' && data.coins >= 0 ? data.coins : defaults.coins,
      name: typeof data.name === 'string' ? data.name : defaults.name,
      totalGamesPlayed:
        typeof data.totalGamesPlayed === 'number' && data.totalGamesPlayed >= 0
          ? data.totalGamesPlayed
          : defaults.totalGamesPlayed,
      totalXP: typeof data.totalXP === 'number' && data.totalXP >= 0 ? data.totalXP : defaults.totalXP,
      gameModes: normalizeGameModes(data.gameModes),
      powerUps: normalizePowerUps(data.powerUps),
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastSaved: data.lastSaved ?? defaults.lastSaved,
    };

    if (typeof data.totalCoinsEarned === 'number' && data.totalCoinsEarned >= 0) {
      result.totalCoinsEarned = data.totalCoinsEarned;
    }

    return result;
  }
}
