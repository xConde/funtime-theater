import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { AchievementsService } from './achievements.service';
import { SoundService } from './sound.service';
import { StorageService } from './services/storage.service';
import { SavedAchievement } from './theater.model';

describe('AchievementsService', () => {
  let service: AchievementsService;
  let soundServiceSpy: jasmine.SpyObj<SoundService>;
  let storageServiceSpy: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    // Clear localStorage before each test
    window.localStorage.clear();

    const soundSpy = jasmine.createSpyObj('SoundService', ['play']);
    const storageSpy = jasmine.createSpyObj('StorageService', ['loadAchievements', 'saveAchievements']);
    storageSpy.loadAchievements.and.returnValue([]);

    TestBed.configureTestingModule({
      providers: [
        AchievementsService,
        { provide: SoundService, useValue: soundSpy },
        { provide: StorageService, useValue: storageSpy },
      ],
    });

    service = TestBed.inject(AchievementsService);
    soundServiceSpy = TestBed.inject(SoundService) as jasmine.SpyObj<SoundService>;
    storageServiceSpy = TestBed.inject(StorageService) as jasmine.SpyObj<StorageService>;
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe('Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should initialize with all achievements locked', () => {
      const achievements = service.achievements();
      expect(achievements.length).toBeGreaterThan(0);
      achievements.forEach((achievement) => {
        expect(achievement.unlocked).toBe(false);
      });
    });

    it('should call loadAchievements on StorageService during init', () => {
      expect(storageServiceSpy.loadAchievements).toHaveBeenCalled();
    });
  });

  describe('Achievement Unlocking', () => {
    it('should unlock achievement and play sound', fakeAsync(() => {
      service.checkAchievement('first_game');
      tick(100);

      const achievements = service.achievements();
      const achievement = achievements.find((a) => a.id === 'first_game');
      expect(achievement?.unlocked).toBe(true);
      expect(achievement?.unlockedAt).toBeDefined();
      expect(soundServiceSpy.play).toHaveBeenCalled();
    }));

    it('should emit unlocked achievement', fakeAsync(() => {
      service.checkAchievement('score_100', 150);
      tick(100);

      const unlockedAchievement = service.achievementUnlocked();
      expect(unlockedAchievement).not.toBeNull();
      if (unlockedAchievement) {
        expect(unlockedAchievement.id).toBe('score_100');
      }
    }));

    it('should not unlock already unlocked achievement', fakeAsync(() => {
      service.checkAchievement('first_game');
      tick(100);

      soundServiceSpy.play.calls.reset();

      service.checkAchievement('first_game');
      tick(100);

      expect(soundServiceSpy.play).not.toHaveBeenCalled();
    }));

    it('should save achievements via StorageService after unlocking', fakeAsync(() => {
      service.checkAchievement('score_500', 600);
      tick(100);

      expect(storageServiceSpy.saveAchievements).toHaveBeenCalled();

      const savedArg = storageServiceSpy.saveAchievements.calls.mostRecent().args[0];
      const achievement = savedArg.find((a) => a.id === 'score_500');
      expect(achievement).toBeDefined();
      expect(achievement?.unlocked).toBe(true);
    }));

    // WS2c fix 2: GameService.endGame() passes a delay so the unlock sting
    // doesn't pile up on the GameOver/new-high-score stings it already played
    // in the same call. Plumbed through to SoundService.play(), which is the
    // one place that actually schedules onto the AudioContext timeline.
    it('threads an optional delaySeconds through to the unlock sting', fakeAsync(() => {
      service.checkAchievement('first_game', undefined, 1.03);
      tick(100);

      expect(soundServiceSpy.play).toHaveBeenCalledWith(jasmine.anything(), 1.03);
    }));

    it('defaults to an immediate sting when no delay is given', fakeAsync(() => {
      service.checkAchievement('first_game');
      tick(100);

      expect(soundServiceSpy.play).toHaveBeenCalledWith(jasmine.anything(), 0);
    }));
  });

  describe('Progress Tracking', () => {
    it('should update achievement progress', () => {
      service.updateProgress('coin_collector', 150);

      const achievements = service.achievements();
      const coinCollector = achievements.find((a) => a.id === 'coin_collector');
      expect(coinCollector?.progress).toBe(150);
    });

    it('should auto-unlock when progress reaches max', fakeAsync(() => {
      service.updateProgress('coin_collector', 1000);
      tick(100);

      const achievements = service.achievements();
      const coinCollector = achievements.find((a) => a.id === 'coin_collector');
      expect(coinCollector?.unlocked).toBe(true);
      expect(soundServiceSpy.play).toHaveBeenCalled();
    }));

    it('threads delaySeconds through an updateProgress-triggered unlock too', fakeAsync(() => {
      service.updateProgress('coin_collector', 1000, 1.03);
      tick(100);

      expect(soundServiceSpy.play).toHaveBeenCalledWith(jasmine.anything(), 1.03);
    }));

    it('should not exceed max progress', () => {
      service.updateProgress('coin_collector', 2000);

      const achievements = service.achievements();
      const coinCollector = achievements.find((a) => a.id === 'coin_collector');
      expect(coinCollector?.progress).toBe(1000);
    });
  });

  describe('Checking Achievements', () => {
    it('should check and unlock score-based achievements', fakeAsync(() => {
      service.checkAchievement('score_100', 150);
      tick(100);

      const achievements = service.achievements();
      const achievement = achievements.find((a) => a.id === 'score_100');
      expect(achievement?.unlocked).toBe(true);
    }));

    it('should check and unlock level-based achievements', fakeAsync(() => {
      service.checkAchievement('level_5', 6);
      tick(100);

      const achievements = service.achievements();
      const achievement = achievements.find((a) => a.id === 'level_5');
      expect(achievement?.unlocked).toBe(true);
    }));
  });

  describe('Statistics', () => {
    it('should calculate unlocked count correctly', fakeAsync(() => {
      service.checkAchievement('first_game');
      service.checkAchievement('score_100', 100);
      service.checkAchievement('level_5', 5);
      tick(100);

      expect(service.getUnlockedCount()).toBe(3);
    }));

    it('should return total count correctly', () => {
      const total = service.getTotalCount();
      expect(total).toBeGreaterThan(0);

      const achievements = service.achievements();
      expect(total).toBe(achievements.length);
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid achievement IDs gracefully', () => {
      expect(() => service.checkAchievement('invalid_achievement')).not.toThrow();
      expect(() => service.updateProgress('invalid_achievement', 100)).not.toThrow();
    });
  });

  describe('Persistence via StorageService', () => {
    it('should restore saved achievements on init', () => {
      const savedAchievements: SavedAchievement[] = [
        { id: 'first_game', unlocked: true, unlockedAt: new Date('2026-01-01') },
      ];

      storageServiceSpy.loadAchievements.and.returnValue(savedAchievements);

      // Re-create service with pre-populated storage spy
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          AchievementsService,
          { provide: SoundService, useValue: soundServiceSpy },
          { provide: StorageService, useValue: storageServiceSpy },
        ],
      });
      const freshService = TestBed.inject(AchievementsService);

      const achievements = freshService.achievements();
      const firstGame = achievements.find((a) => a.id === 'first_game');
      expect(firstGame?.unlocked).toBe(true);
    });
  });
});
