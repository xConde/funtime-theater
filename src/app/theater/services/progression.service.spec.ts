import { TestBed } from '@angular/core/testing';
import { ProgressionService } from './progression.service';
import { StorageService } from './storage.service';
import { SoundService, SoundType } from '../sound.service';
import { AchievementsService } from '../achievements.service';

describe('ProgressionService', () => {
  let service: ProgressionService;
  let storageServiceSpy: jasmine.SpyObj<StorageService>;
  let soundServiceSpy: jasmine.SpyObj<SoundService>;
  let achievementsServiceSpy: jasmine.SpyObj<AchievementsService>;

  beforeEach(() => {
    const storageSpy = jasmine.createSpyObj('StorageService', ['loadGameData', 'updateXP', 'addCoins']);
    const soundSpy = jasmine.createSpyObj('SoundService', ['play']);
    const achievementsSpy = jasmine.createSpyObj('AchievementsService', ['checkAchievement']);

    storageSpy.loadGameData.and.returnValue({
      coins: 500,
      name: 'Test Player',
      totalGamesPlayed: 0,
      totalXP: 0,
      gameModes: [],
      powerUps: [],
    });

    TestBed.configureTestingModule({
      providers: [
        ProgressionService,
        { provide: StorageService, useValue: storageSpy },
        { provide: SoundService, useValue: soundSpy },
        { provide: AchievementsService, useValue: achievementsSpy },
      ],
    });

    service = TestBed.inject(ProgressionService);
    storageServiceSpy = TestBed.inject(StorageService) as jasmine.SpyObj<StorageService>;
    soundServiceSpy = TestBed.inject(SoundService) as jasmine.SpyObj<SoundService>;
    achievementsServiceSpy = TestBed.inject(AchievementsService) as jasmine.SpyObj<AchievementsService>;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('initialization', () => {
    it('should load level data from storage on creation', () => {
      expect(storageServiceSpy.loadGameData).toHaveBeenCalled();
    });

    it('should initialize with level 1 for 0 XP', () => {
      expect(service.currentLevel()).toBe(1);
    });

    it('should initialize with 0 XP', () => {
      expect(service.totalXP()).toBe(0);
    });
  });

  describe('XP management', () => {
    it('should award XP and update total', () => {
      service.awardXP(100);
      expect(service.getTotalXP()).toBe(100);
    });

    it('should save XP to storage', () => {
      service.awardXP(50);
      expect(storageServiceSpy.updateXP).toHaveBeenCalledWith(50);
    });

    it('should accumulate XP from multiple awards', () => {
      service.awardXP(50);
      service.awardXP(75);
      service.awardXP(25);

      expect(service.getTotalXP()).toBe(150);
    });

    it('should update XP signal when awarding XP', () => {
      expect(service.totalXP()).toBe(0);
      service.awardXP(200);
      expect(service.totalXP()).toBe(200);
    });
  });

  describe('level progression', () => {
    it('should level up at 100 XP (level 2)', () => {
      service.awardXP(100);
      expect(service.getCurrentLevel()).toBe(2);
    });

    it('should level up at 283 XP (level 3)', () => {
      // Level 3 requires 100 * (3-1)^1.5 = 100 * 2.83 = 283 XP
      service.awardXP(283);
      expect(service.getCurrentLevel()).toBe(3);
    });

    it('should play level up sound when leveling up', () => {
      service.awardXP(100); // Level up to 2
      expect(soundServiceSpy.play).toHaveBeenCalledWith(SoundType.LevelUp);
    });

    it('should not play sound when not leveling up', () => {
      service.awardXP(50); // Still level 1
      expect(soundServiceSpy.play).not.toHaveBeenCalled();
    });

    it('should check level 5 achievement', () => {
      service.awardXP(900); // Should reach level 5
      expect(achievementsServiceSpy.checkAchievement).toHaveBeenCalledWith('level_5', jasmine.any(Number));
    });

    it('should check level 10 achievement', () => {
      service.awardXP(3000); // Should reach level 10+
      expect(achievementsServiceSpy.checkAchievement).toHaveBeenCalledWith('level_10', jasmine.any(Number));
    });

    it('should check level 25 achievement', () => {
      service.awardXP(15000); // Should reach level 25+
      expect(achievementsServiceSpy.checkAchievement).toHaveBeenCalledWith('level_25', jasmine.any(Number));
    });

    it('should handle multiple level ups in single XP award', () => {
      const initialCalls = soundServiceSpy.play.calls.count();
      service.awardXP(500); // Should jump multiple levels

      expect(soundServiceSpy.play.calls.count()).toBe(initialCalls + 1);
    });
  });

  describe('level progress calculation', () => {
    it('should show 0% progress at start of level', () => {
      service.awardXP(100); // Just reached level 2
      expect(service.levelProgress()).toBe(0);
    });

    it('should show progress within a level', () => {
      service.awardXP(100); // Level 2 start
      service.awardXP(92); // Halfway to level 3 (needs ~183 more)
      expect(service.levelProgress()).toBeGreaterThan(0);
      expect(service.levelProgress()).toBeLessThan(100);
    });
  });

  describe('difficulty modifier', () => {
    it('should return 1.0 at level 1', () => {
      expect(service.getDifficultyModifier()).toBe(1.0);
    });

    it('should increase with level', () => {
      service.awardXP(100); // Level 2
      const level2Modifier = service.getDifficultyModifier();

      service.awardXP(200); // Level 3+
      const level3Modifier = service.getDifficultyModifier();

      expect(level3Modifier).toBeGreaterThan(level2Modifier);
      expect(level2Modifier).toBeGreaterThan(1.0);
    });

    it('should calculate correct modifier for level 10', () => {
      service.awardXP(3000); // Should be around level 10
      const level = service.getCurrentLevel();
      const expectedModifier = 1 + (level - 1) * 0.05;

      expect(service.getDifficultyModifier()).toBeCloseTo(expectedModifier, 2);
    });
  });

  describe('XP multipliers by game mode', () => {
    it('should return 0.8 for time attack (easier)', () => {
      expect(service.getXPMultiplier('timeAttack')).toBe(0.8);
    });

    it('should return 1.5 for memory (harder)', () => {
      expect(service.getXPMultiplier('memory')).toBe(1.5);
    });

    it('should return 1.2 for endless', () => {
      expect(service.getXPMultiplier('endless')).toBe(1.2);
    });

    it('should return 1.0 for classic mode', () => {
      expect(service.getXPMultiplier('classic')).toBe(1.0);
    });

    it('should return 1.0 for unknown modes', () => {
      expect(service.getXPMultiplier('unknown')).toBe(1.0);
    });
  });

  describe('level calculation from XP', () => {
    it('should correctly calculate level 1', () => {
      expect(service.getCurrentLevel()).toBe(1);
    });

    it('should correctly calculate level 2 at 100 XP', () => {
      service.awardXP(100);
      expect(service.getCurrentLevel()).toBe(2);
    });

    it('should correctly calculate level 5', () => {
      // Level 5 requires 100 * 4^1.5 = 100 * 8 = 800 XP
      service.awardXP(800);
      expect(service.getCurrentLevel()).toBeGreaterThanOrEqual(5);
    });

    it('should stay at correct level when XP is between thresholds', () => {
      service.awardXP(150); // Between level 2 (100) and level 3 (283)
      expect(service.getCurrentLevel()).toBe(2);
    });
  });

  describe('signal behavior', () => {
    it('should reflect level changes immediately', () => {
      service.awardXP(100); // Level 2
      expect(service.currentLevel()).toBe(2);

      service.awardXP(200); // Level 3+
      expect(service.currentLevel()).toBeGreaterThanOrEqual(3);
    });

    it('should provide latest level when read', () => {
      service.awardXP(100); // Level 2
      expect(service.currentLevel()).toBe(2);
    });
  });

  describe('milestone rewards', () => {
    it('should award ticket bonus at level 5', () => {
      // Level 5 requires 800 XP
      service.awardXP(800);
      expect(storageServiceSpy.addCoins).toHaveBeenCalledWith(500);
    });

    it('should award ticket bonus at level 10', () => {
      // Level 10 requires ~2828 XP
      service.awardXP(2828);
      // Should have been called for level 5 (500) and level 10 (1500)
      expect(storageServiceSpy.addCoins).toHaveBeenCalledWith(500);
      expect(storageServiceSpy.addCoins).toHaveBeenCalledWith(1500);
    });

    it('should not award bonus at non-milestone levels', () => {
      service.awardXP(100); // Level 2
      expect(storageServiceSpy.addCoins).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle 0 XP award', () => {
      const initialXP = service.getTotalXP();
      service.awardXP(0);
      expect(service.getTotalXP()).toBe(initialXP);
    });

    it('should handle very large XP values', () => {
      service.awardXP(999999);
      expect(service.getTotalXP()).toBe(999999);
      expect(service.getCurrentLevel()).toBeGreaterThan(1);
    });

    it('should handle negative XP gracefully', () => {
      service.awardXP(100);
      service.awardXP(-50);

      // Should add -50 (service doesn't validate, trusts caller)
      expect(service.getTotalXP()).toBe(50);
    });
  });
});
