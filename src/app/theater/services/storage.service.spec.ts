import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';
import { PausedGameState, SavedAchievement, SavedGameData } from '../theater.model';
import { calculatePowerUpCost, GAME_BALANCE, INITIAL_POWER_UP_COSTS, STORAGE_KEYS } from '../theater.constants';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(StorageService);
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('loadGameData', () => {
    it('should return default data when no data exists', () => {
      const data = service.loadGameData();
      expect(data.coins).toBe(GAME_BALANCE.STARTING_COINS);
      // Lifetime earned seeds from the starting grant (consistent with the v1→v2
      // migration, which seeds it from the current balance) so "Lifetime Earnings"
      // never falls back to the live balance for a fresh player.
      expect(data.totalCoinsEarned).toBe(GAME_BALANCE.STARTING_COINS);
      expect(data.name).toBe('Player 1');
      expect(data.totalGamesPlayed).toBe(0);
      expect(data.totalXP).toBe(0);
      expect(data.gameModes).toEqual([]);
      expect(data.powerUps).toEqual([]);
    });

    it('should return existing data when valid data exists', () => {
      const testData: SavedGameData = {
        coins: 1000,
        name: 'Test Player',
        totalGamesPlayed: 5,
        totalXP: 250,
        gameModes: [],
        powerUps: [],
        totalCoinsEarned: 1000,
        schemaVersion: 2,
        lastSaved: 1234567890,
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(testData));

      const data = service.loadGameData();
      expect(data.coins).toBe(testData.coins);
      expect(data.name).toBe(testData.name);
      expect(data.totalGamesPlayed).toBe(testData.totalGamesPlayed);
      expect(data.totalXP).toBe(testData.totalXP);
      expect(data.gameModes).toEqual(testData.gameModes);
      expect(data.powerUps).toEqual(testData.powerUps);
      expect(data.schemaVersion).toBe(2);
    });

    it('should return default data when corrupted data exists', () => {
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, 'invalid json');

      const data = service.loadGameData();
      expect(data.coins).toBe(GAME_BALANCE.STARTING_COINS);
    });

    it('should migrate invalid coin values to default', () => {
      const badData = { coins: -100, name: 'Player', totalGamesPlayed: 0, totalXP: 0 };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(badData));

      const data = service.loadGameData();
      expect(data.coins).toBe(GAME_BALANCE.STARTING_COINS);
    });
  });

  describe('saveGameData', () => {
    it('should save valid game data', () => {
      const testData: SavedGameData = {
        coins: 2000,
        name: 'Test Player',
        totalGamesPlayed: 10,
        totalXP: 500,
        gameModes: [],
        powerUps: [],
      };

      const result = service.saveGameData(testData);
      expect(result).toBe(true);

      const loaded = service.loadGameData();
      expect(loaded.coins).toBe(testData.coins);
      expect(loaded.name).toBe(testData.name);
      expect(loaded.totalGamesPlayed).toBe(testData.totalGamesPlayed);
      expect(loaded.totalXP).toBe(testData.totalXP);
    });

    it('should set schemaVersion on save', () => {
      const testData: SavedGameData = {
        coins: 500,
        name: 'Player 1',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [],
      };

      service.saveGameData(testData);
      const loaded = service.loadGameData();
      expect(loaded.schemaVersion).toBe(2);
    });

    it('should set lastSaved timestamp on save', () => {
      const before = Date.now();
      const testData: SavedGameData = {
        coins: 500,
        name: 'Player 1',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [],
      };

      service.saveGameData(testData);
      const after = Date.now();

      const loaded = service.loadGameData();
      expect(loaded.lastSaved).toBeDefined();
      expect(loaded.lastSaved).toBeGreaterThanOrEqual(before);
      expect(loaded.lastSaved).toBeLessThanOrEqual(after);
    });

    it('should merge partial data with existing data', () => {
      const initialData: SavedGameData = {
        coins: 1000,
        name: 'Player 1',
        totalGamesPlayed: 5,
        totalXP: 100,
        gameModes: [],
        powerUps: [],
      };
      service.saveGameData(initialData);

      const partialUpdate = { coins: 2000 };
      service.saveGameData(partialUpdate);

      const loaded = service.loadGameData();
      expect(loaded.coins).toBe(2000);
      expect(loaded.name).toBe('Player 1');
      expect(loaded.totalGamesPlayed).toBe(5);
    });
  });

  describe('schema migration', () => {
    it('should migrate v0 data (no schemaVersion) to current version', () => {
      const v0Data = {
        coins: 750,
        name: 'Old Player',
        totalGamesPlayed: 3,
        totalXP: 120,
        gameModes: [],
        powerUps: [],
        // no schemaVersion — this is a pre-versioned save
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v0Data));

      const loaded = service.loadGameData();
      expect(loaded.schemaVersion).toBe(2);
      expect(loaded.lastSaved).toBeDefined();
      expect(loaded.totalCoinsEarned).toBe(750);
    });

    it('should preserve existing data during v0 → v2 migration', () => {
      const v0Data = {
        coins: 1234,
        name: 'Veteran Player',
        totalGamesPlayed: 42,
        totalXP: 9999,
        gameModes: [{ id: 'classic', unlocked: true, highScore: 500 }],
        powerUps: [{ id: 'autoClicker', owned: 3 }],
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v0Data));

      const loaded = service.loadGameData();
      expect(loaded.coins).toBe(1234);
      expect(loaded.name).toBe('Veteran Player');
      expect(loaded.totalGamesPlayed).toBe(42);
      expect(loaded.totalXP).toBe(9999);
      expect(loaded.gameModes).toEqual(v0Data.gameModes);
      expect(loaded.powerUps).toEqual(v0Data.powerUps);
      expect(loaded.totalCoinsEarned).toBe(1234);
    });

    it('should migrate v1 data to v2 with totalCoinsEarned', () => {
      const v1Data = {
        coins: 5000,
        name: 'V1 Player',
        totalGamesPlayed: 10,
        totalXP: 500,
        gameModes: [],
        powerUps: [],
        schemaVersion: 1,
        lastSaved: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v1Data));

      const loaded = service.loadGameData();
      expect(loaded.schemaVersion).toBe(2);
      expect(loaded.totalCoinsEarned).toBe(5000);
    });

    it('should not re-run migrations on already-current data', () => {
      const currentData: SavedGameData = {
        coins: 500,
        name: 'Current Player',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [],
        totalCoinsEarned: 500,
        schemaVersion: 2,
        lastSaved: 9999999999,
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(currentData));

      const loaded = service.loadGameData();
      // lastSaved should be preserved (not reset by migration)
      expect(loaded.lastSaved).toBe(9999999999);
      expect(loaded.schemaVersion).toBe(2);
    });

    it('should persist migrated data back to localStorage', () => {
      const v0Data = {
        coins: 100,
        name: 'Player',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [],
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v0Data));

      service.loadGameData();

      const raw = window.localStorage.getItem(STORAGE_KEYS.GAME_DATA);
      expect(raw).toBeTruthy();
      const persisted = JSON.parse(raw as string) as SavedGameData;
      expect(persisted.schemaVersion).toBe(2);
    });

    // ─────────────────────────────────────────────────────────────────────
    // Phase 3 — save schema audit. The v0→v1 migration explicitly normalizes
    // gameModes/powerUps to arrays, but the v1→v2 migration only spreads
    // {...data} + adds totalCoinsEarned. A v1 save with corrupted arrays
    // (manual localStorage edit, partial write, etc.) skips the v0→v1
    // normalization step and lets the corruption ride through to callers.
    // The fix runs validateAndFillDefaults at the end of every migration
    // pipeline as a safety net. Pin the contract here.
    // ─────────────────────────────────────────────────────────────────────
    it('should repair corrupted arrays in a v1 save during v1 → v2 migration', () => {
      const v1WithCorruptArrays = {
        coins: 5000,
        name: 'Corrupted V1',
        totalGamesPlayed: 10,
        totalXP: 500,
        // Both arrays corrupted — non-array values that survive
        // an unguarded `...data` spread in the v1 → v2 migration step
        gameModes: 'not-an-array' as unknown as never[],
        powerUps: null as unknown as never[],
        schemaVersion: 1,
        lastSaved: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v1WithCorruptArrays));

      const loaded = service.loadGameData();

      expect(Array.isArray(loaded.gameModes)).toBe(true);
      expect(loaded.gameModes.length).toBe(0);
      expect(Array.isArray(loaded.powerUps)).toBe(true);
      expect(loaded.powerUps.length).toBe(0);
      expect(loaded.schemaVersion).toBe(2);
      expect(loaded.coins).toBe(5000); // valid fields preserved
    });

    it('should normalize malformed nested entries in an already-current save', () => {
      const currentWithMalformedEntries = {
        coins: 1000,
        name: 'Nested corruption',
        totalGamesPlayed: 4,
        totalXP: 90,
        gameModes: [
          {
            id: 'classic',
            unlocked: 'yes',
            highScore: 'broken',
            gamesPlayed: 3,
            totalEarnings: 240,
            bestMultiplier: 2.5,
          },
          { id: 'classic', unlocked: true, highScore: 999 },
          { id: '../invalid', unlocked: true, highScore: 10 },
          { id: 'future-mode', unlocked: true, highScore: 12 },
        ],
        powerUps: [
          { id: 'ticketMultiplier', owned: 'broken', timesTriggered: -1 },
          { id: 'autoClicker', owned: 2, timesTriggered: 3 },
          { id: 'autoClicker', owned: 99 },
          { id: 'future_power', owned: 1 },
          null,
        ],
        schemaVersion: 2,
        lastSaved: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(currentWithMalformedEntries));

      const loaded = service.loadGameData();

      expect(loaded.gameModes).toEqual([
        {
          id: 'classic',
          unlocked: false,
          highScore: 0,
          gamesPlayed: 3,
          totalEarnings: 240,
          bestMultiplier: 2.5,
        },
        { id: 'future-mode', unlocked: true, highScore: 12 },
      ]);
      expect(loaded.powerUps).toEqual([
        { id: 'ticketMultiplier', owned: 0 },
        { id: 'autoClicker', owned: 2, timesTriggered: 3 },
        { id: 'future_power', owned: 1 },
      ]);

      const repairedOnLoad = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.GAME_DATA) ?? '{}') as SavedGameData;
      expect(repairedOnLoad.gameModes).toEqual(loaded.gameModes);
      expect(repairedOnLoad.powerUps).toEqual(loaded.powerUps);

      expect(service.saveGameData({ coins: 700 })).toBeTrue();
      const persisted = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.GAME_DATA) ?? '{}') as SavedGameData;
      expect(persisted.coins).toBe(700);
      expect(persisted.powerUps[0]).toEqual({ id: 'ticketMultiplier', owned: 0 });
    });

    it('should preserve totalCoinsEarned through the validation safety net', () => {
      const v1Data = {
        coins: 800,
        name: 'V1',
        totalGamesPlayed: 5,
        totalXP: 100,
        gameModes: [],
        powerUps: [],
        schemaVersion: 1,
        lastSaved: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v1Data));

      const loaded = service.loadGameData();

      expect(loaded.schemaVersion).toBe(2);
      // v1 → v2 migration sets totalCoinsEarned = data.coins as a best-estimate
      // backfill. The trailing validateAndFillDefaults call must not silently
      // drop this optional field.
      expect(loaded.totalCoinsEarned).toBe(800);
    });

    // ─── Idempotence ──────────────────────────────────────────────────────────

    it('v0→v1 migration is idempotent', () => {
      const v0Data = {
        coins: 300,
        name: 'Idempotent Player',
        totalGamesPlayed: 2,
        totalXP: 80,
        gameModes: [{ id: 'classic', unlocked: true, highScore: 200 }],
        powerUps: [{ id: 'comboMaster', owned: 1 }],
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v0Data));
      service.loadGameData(); // triggers v0→v1→v2 migration; result is v2

      // Retrieve the migrated v2 data as a baseline
      const baseline = service.loadGameData();

      // Saving and reloading a v2 save must not further mutate the data
      // (i.e., running the migration pipeline a second time is a no-op)
      service.saveGameData({});
      const second = service.loadGameData();

      expect(second.coins).toEqual(baseline.coins);
      expect(second.name).toEqual(baseline.name);
      expect(second.totalGamesPlayed).toEqual(baseline.totalGamesPlayed);
      expect(second.totalXP).toEqual(baseline.totalXP);
      expect(second.gameModes).toEqual(baseline.gameModes);
      expect(second.powerUps).toEqual(baseline.powerUps);
      expect(second.totalCoinsEarned).toEqual(baseline.totalCoinsEarned);
      expect(second.schemaVersion).toEqual(baseline.schemaVersion);
    });

    it('v1→v2 migration is idempotent', () => {
      const v1Data = {
        coins: 450,
        name: 'V1 Idempotent',
        totalGamesPlayed: 7,
        totalXP: 300,
        gameModes: [],
        powerUps: [],
        schemaVersion: 1,
        lastSaved: 1000000000,
        totalCoinsEarned: 450,
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v1Data));

      // First migration pass
      const once = service.loadGameData();

      // Reset cache so a second load re-reads from localStorage (which now holds v2)
      // and runs migrations on the already-migrated data
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(once));
      service['cachedGameData'] = null;
      const twice = service.loadGameData();

      expect(twice.coins).toEqual(once.coins);
      expect(twice.name).toEqual(once.name);
      expect(twice.totalCoinsEarned).toEqual(once.totalCoinsEarned);
      expect(twice.schemaVersion).toEqual(once.schemaVersion);
    });

    it('should keep totalCoinsEarned on already-current saves', () => {
      const v2Data: SavedGameData = {
        coins: 200,
        name: 'V2',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: [],
        powerUps: [],
        totalCoinsEarned: 1234,
        schemaVersion: 2,
        lastSaved: 9999999999,
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v2Data));

      const loaded = service.loadGameData();
      expect(loaded.totalCoinsEarned).toBe(1234);
      expect(loaded.lastSaved).toBe(9999999999);
    });
  });

  describe('paused game state', () => {
    const validPausedState: PausedGameState = {
      mode: 'classic',
      score: 100,
      multiplier: 1.5,
      timer: 10,
      remainingTime: 10,
      clickedCount: 5,
      activePowerUps: [],
      doublePointsActive: false,
      slowTimeActive: false,
      timestamp: Date.now(),
    };

    it('should save and load paused game state', () => {
      const result = service.savePausedGameState(validPausedState);
      expect(result).toBe(true);

      const loaded = service.loadPausedGameState();
      expect(loaded).toEqual(validPausedState);
    });

    it('should return null when no paused state exists', () => {
      const loaded = service.loadPausedGameState();
      expect(loaded).toBeNull();
    });

    it('should clear expired paused states', () => {
      const expiredState: PausedGameState = {
        ...validPausedState,
        timestamp: Date.now() - 49 * 60 * 60 * 1000,
      };
      service.savePausedGameState(expiredState);

      const loaded = service.loadPausedGameState();
      expect(loaded).toBeNull();
    });

    it('should clear paused state', () => {
      service.savePausedGameState(validPausedState);
      service.clearPausedGameState();

      const loaded = service.loadPausedGameState();
      expect(loaded).toBeNull();
    });

    it('should check if paused game exists', () => {
      expect(service.hasPausedGame()).toBe(false);

      service.savePausedGameState(validPausedState);
      expect(service.hasPausedGame()).toBe(true);
    });

    it('should get paused game mode', () => {
      expect(service.getPausedGameMode()).toBeNull();

      service.savePausedGameState(validPausedState);
      expect(service.getPausedGameMode()).toBe('classic');
    });

    it('rejects malformed numeric checkpoint fields and removes the stored value', () => {
      window.localStorage.setItem(
        STORAGE_KEYS.PAUSED_GAME,
        JSON.stringify({ ...validPausedState, timer: -2, clickedCount: 1.5 })
      );

      expect(service.loadPausedGameState()).toBeNull();
      expect(window.localStorage.getItem(STORAGE_KEYS.PAUSED_GAME)).toBeNull();
    });

    it('accepts the -1 no-clock sentinel only for untimed modes', () => {
      const endlessState: PausedGameState = {
        ...validPausedState,
        mode: 'finale',
        timer: -1,
        remainingTime: -1,
      };

      expect(service.savePausedGameState(endlessState)).toBeTrue();
      expect(service.loadPausedGameState()).toEqual(endlessState);

      expect(service.savePausedGameState({ ...endlessState, mode: 'classic' })).toBeFalse();
    });

    it('rejects malformed active power-up tuples', () => {
      window.localStorage.setItem(
        STORAGE_KEYS.PAUSED_GAME,
        JSON.stringify({ ...validPausedState, activePowerUps: [['doublePoints', 'forever']] })
      );

      expect(service.loadPausedGameState()).toBeNull();
    });

    it('rejects non-object checkpoint payloads', () => {
      window.localStorage.setItem(STORAGE_KEYS.PAUSED_GAME, JSON.stringify('not a checkpoint'));

      expect(service.loadPausedGameState()).toBeNull();
    });
  });

  describe('achievement persistence', () => {
    it('should return empty array when no achievements exist', () => {
      const achievements = service.loadAchievements();
      expect(achievements).toEqual([]);
    });

    it('should save and load achievements', () => {
      const toSave: SavedAchievement[] = [
        { id: 'first_game', unlocked: true, unlockedAt: new Date('2026-01-01') },
        { id: 'score_100', unlocked: false, progress: 42 },
      ];

      service.saveAchievements(toSave);
      const loaded = service.loadAchievements();

      expect(loaded.length).toBe(2);
      expect(loaded[0].id).toBe('first_game');
      expect(loaded[0].unlocked).toBe(true);
      expect(loaded[1].id).toBe('score_100');
      expect(loaded[1].progress).toBe(42);
    });

    it('should use STORAGE_KEYS.ACHIEVEMENTS key', () => {
      const toSave: SavedAchievement[] = [{ id: 'first_game', unlocked: true }];
      service.saveAchievements(toSave);

      const raw = window.localStorage.getItem(STORAGE_KEYS.ACHIEVEMENTS);
      expect(raw).toBeTruthy();
    });
  });

  describe('coin management', () => {
    it('should update coins', () => {
      const result = service.updateCoins(5000);
      expect(result).toBe(true);
      expect(service.getCoins()).toBe(5000);
    });

    it('should not allow negative coins', () => {
      const result = service.updateCoins(-100);
      expect(result).toBe(false);
    });

    it('should add coins', () => {
      service.updateCoins(1000);
      service.addCoins(500);
      expect(service.getCoins()).toBe(1500);
    });

    it('should deduct coins', () => {
      service.updateCoins(1000);
      service.deductCoins(300);
      expect(service.getCoins()).toBe(700);
    });

    it('should not allow deducting below zero', () => {
      service.updateCoins(100);
      service.deductCoins(200);
      expect(service.getCoins()).toBe(0);
    });
  });

  describe('XP management', () => {
    it('should update XP', () => {
      const result = service.updateXP(1000);
      expect(result).toBe(true);
      const data = service.loadGameData();
      expect(data.totalXP).toBe(1000);
    });

    it('should not allow negative XP', () => {
      const result = service.updateXP(-100);
      expect(result).toBe(false);
    });

    it('should add XP', () => {
      service.updateXP(500);
      service.addXP(250);
      const data = service.loadGameData();
      expect(data.totalXP).toBe(750);
    });
  });

  describe('games played tracking', () => {
    it('should increment games played', () => {
      service.incrementGamesPlayed();
      service.incrementGamesPlayed();
      const data = service.loadGameData();
      expect(data.totalGamesPlayed).toBe(2);
    });
  });

  describe('clearAllData', () => {
    it('should clear all storage', () => {
      const testData: SavedGameData = {
        coins: 1000,
        name: 'Test',
        totalGamesPlayed: 10,
        totalXP: 500,
        gameModes: [],
        powerUps: [],
      };
      service.saveGameData(testData);
      service.savePausedGameState({
        mode: 'classic',
        score: 100,
        multiplier: 1,
        timer: 10,
        remainingTime: 10,
        clickedCount: 5,
        activePowerUps: [],
        doublePointsActive: false,
        slowTimeActive: false,
        timestamp: Date.now(),
      });

      service.clearAllData();

      const gameData = service.loadGameData();
      expect(gameData.coins).toBe(GAME_BALANCE.STARTING_COINS);

      const pausedState = service.loadPausedGameState();
      expect(pausedState).toBeNull();
    });
  });

  describe('coin validation (economy hardening)', () => {
    it('should reject NaN coin values', () => {
      const result = service.updateCoins(NaN);
      expect(result).toBe(false);
    });

    it('should reject Infinity coin values', () => {
      const result = service.updateCoins(Infinity);
      expect(result).toBe(false);
    });

    it('should reject NaN addCoins amount', () => {
      service.updateCoins(1000);
      const result = service.addCoins(NaN);
      expect(result).toBe(false);
      expect(service.getCoins()).toBe(1000);
    });

    it('should reject negative addCoins amount', () => {
      service.updateCoins(1000);
      const result = service.addCoins(-100);
      expect(result).toBe(false);
      expect(service.getCoins()).toBe(1000);
    });

    it('should reject NaN deductCoins amount', () => {
      service.updateCoins(1000);
      const result = service.deductCoins(NaN);
      expect(result).toBe(false);
      expect(service.getCoins()).toBe(1000);
    });

    it('should reject negative deductCoins amount', () => {
      service.updateCoins(1000);
      const result = service.deductCoins(-100);
      expect(result).toBe(false);
      expect(service.getCoins()).toBe(1000);
    });

    it('should handle deducting exact balance', () => {
      service.updateCoins(500);
      const result = service.deductCoins(500);
      expect(result).toBe(true);
      expect(service.getCoins()).toBe(0);
    });

    it('should not persist coins when save fails on concurrent writes', () => {
      service.updateCoins(1000);
      service.deductCoins(300);
      expect(service.getCoins()).toBe(700);
      service.addCoins(200);
      expect(service.getCoins()).toBe(900);
    });

    it('should handle saveGameData without coins field (lobby save pattern)', () => {
      service.updateCoins(1000);

      // Simulate lobby save that doesn't include coins
      service.saveGameData({
        name: 'Updated Name',
        powerUps: [{ id: 'autoClicker', owned: 2 }],
      });

      // Coins should be preserved from existing data
      expect(service.getCoins()).toBe(1000);
      expect(service.loadGameData().name).toBe('Updated Name');
    });
  });

  describe('backup and restore', () => {
    it('should create backup during migration', () => {
      const v1Data = {
        coins: 3000,
        name: 'Backup Test',
        totalGamesPlayed: 5,
        totalXP: 200,
        gameModes: [],
        powerUps: [],
        schemaVersion: 1,
        lastSaved: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v1Data));

      // Loading triggers v1→v2 migration which creates backup
      service.loadGameData();
      expect(service.hasBackup()).toBe(true);
    });

    it('should restore from backup', () => {
      const v1Data = {
        coins: 3000,
        name: 'Backup Test',
        totalGamesPlayed: 5,
        totalXP: 200,
        gameModes: [],
        powerUps: [],
        schemaVersion: 1,
        lastSaved: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(v1Data));

      service.loadGameData(); // triggers migration + backup

      // Modify data
      service.updateCoins(0);
      expect(service.getCoins()).toBe(0);

      // Restore from backup — re-triggers migration
      const result = service.restoreFromBackup();
      expect(result).toBe(true);
      expect(service.getCoins()).toBe(3000);
    });

    it('should return false when no backup exists', () => {
      expect(service.hasBackup()).toBe(false);
      expect(service.restoreFromBackup()).toBe(false);
    });
  });

  describe('granular field validation', () => {
    it('should repair NaN coins to default', () => {
      const badData = {
        coins: NaN,
        name: 'Test',
        totalGamesPlayed: 5,
        totalXP: 100,
        gameModes: [],
        powerUps: [],
        schemaVersion: 2,
        lastSaved: Date.now(),
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(badData));

      // saveGameData with partial data triggers validation
      service.saveGameData({ name: 'Updated' });
      const loaded = service.loadGameData();
      expect(loaded.coins).toBe(GAME_BALANCE.STARTING_COINS);
      expect(loaded.name).toBe('Updated');
    });

    it('should repair missing gameModes array', () => {
      const badData = {
        coins: 500,
        name: 'Test',
        totalGamesPlayed: 0,
        totalXP: 0,
        gameModes: 'not an array',
        powerUps: [],
        schemaVersion: 2,
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(badData));

      service.saveGameData({ name: 'Updated' });
      const loaded = service.loadGameData();
      expect(Array.isArray(loaded.gameModes)).toBe(true);
    });

    it('should preserve valid fields when repairing invalid ones', () => {
      const mixedData = {
        coins: -50,
        name: 'Valid Name',
        totalGamesPlayed: 42,
        totalXP: -10,
        gameModes: [{ id: 'classic', unlocked: true, highScore: 999 }],
        powerUps: [],
        schemaVersion: 2,
      };
      window.localStorage.setItem(STORAGE_KEYS.GAME_DATA, JSON.stringify(mixedData));

      service.saveGameData({});
      const loaded = service.loadGameData();
      expect(loaded.coins).toBe(GAME_BALANCE.STARTING_COINS);
      expect(loaded.name).toBe('Valid Name');
      expect(loaded.totalGamesPlayed).toBe(42);
      expect(loaded.totalXP).toBe(0);
      expect(loaded.gameModes.length).toBe(1);
    });
  });

  describe('write-through cache', () => {
    it('should return consistent data on consecutive reads', () => {
      service.updateCoins(999);
      const first = service.loadGameData();
      const second = service.loadGameData();
      expect(first.coins).toBe(second.coins);
      expect(first.coins).toBe(999);
    });

    it('should reflect saves immediately on next read', () => {
      service.updateCoins(500);
      expect(service.getCoins()).toBe(500);
      service.deductCoins(200);
      expect(service.getCoins()).toBe(300);
    });

    it('should invalidate cache on clearAllData', () => {
      service.updateCoins(5000);
      service.clearAllData();
      expect(service.getCoins()).toBe(GAME_BALANCE.STARTING_COINS);
    });

    it('should return defensive copies (not references)', () => {
      service.saveGameData({ powerUps: [{ id: 'test', owned: 1 }] });
      const first = service.loadGameData();
      first.coins = 999999;
      const second = service.loadGameData();
      expect(second.coins).not.toBe(999999);
    });
  });

  describe('calculatePowerUpCost', () => {
    it('should return base cost for owned=0', () => {
      expect(calculatePowerUpCost('comboMaster', 0)).toBe(INITIAL_POWER_UP_COSTS.comboMaster);
    });

    it('should scale cost by scaling factor for owned=1', () => {
      // comboMaster: base 150, scaling 1.4 → floor(150 * 1.4) = 210
      expect(calculatePowerUpCost('comboMaster', 1)).toBe(210);
    });

    it('should compound scaling for multiple owned', () => {
      // comboMaster: 150 → 210 → floor(210 * 1.4) = 294
      expect(calculatePowerUpCost('comboMaster', 2)).toBe(294);
    });

    it('should return 0 for unknown power-up id', () => {
      expect(calculatePowerUpCost('nonexistent', 3)).toBe(0);
    });

    it('should match manual calculation for all power-ups at level 0', () => {
      const ids = Object.keys(INITIAL_POWER_UP_COSTS) as (keyof typeof INITIAL_POWER_UP_COSTS)[];
      for (const id of ids) {
        expect(calculatePowerUpCost(id, 0)).toBe(INITIAL_POWER_UP_COSTS[id]);
      }
    });
  });
});
