import { Injectable, signal } from '@angular/core';
import { SoundService, SoundType } from './sound.service';
import { StorageService } from './services/storage.service';
import { SavedAchievement } from './theater.model';
import { ACHIEVEMENT_THRESHOLDS, ANIMATION_CONSTANTS } from './theater.constants';
import { TheaterIconName } from './utils/icons';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: TheaterIconName;
  unlocked: boolean;
  unlockedAt?: Date;
  progress?: number;
  maxProgress?: number;
}

@Injectable({
  providedIn: 'root',
})
export class AchievementsService {
  readonly achievements = signal<Achievement[]>([]);
  readonly achievementUnlocked = signal<Achievement | null>(null);

  private achievementsList: Achievement[] = [
    {
      id: 'first_game',
      name: 'Opening Night',
      description: 'Complete your first show',
      icon: 'baby',
      unlocked: false,
    },
    {
      id: 'score_100',
      name: 'Box Office Hit',
      description: 'Sell 100 tickets in a single show',
      icon: 'medal',
      unlocked: false,
    },
    {
      id: 'score_500',
      name: 'Blockbuster',
      description: 'Sell 500 tickets in a single show',
      icon: 'crown',
      unlocked: false,
    },
    {
      id: 'score_1000',
      name: 'Funtime Legend',
      description: 'Sell 1000 tickets in a single show',
      icon: 'star',
      unlocked: false,
    },
    {
      id: 'level_5',
      name: 'Matinee Idol',
      description: 'Reach star rating 5',
      icon: 'trend-up',
      unlocked: false,
    },
    {
      id: 'level_10',
      name: 'Silver Screen Star',
      description: 'Reach star rating 10',
      icon: 'certificate',
      unlocked: false,
    },
    {
      id: 'level_25',
      name: 'Hollywood Legend',
      description: 'Reach star rating 25',
      icon: 'trophy',
      unlocked: false,
    },
    {
      id: 'speed_demon',
      name: 'Fast & Furious',
      description: 'Fill 10 seats in rapid succession',
      icon: 'gauge',
      unlocked: false,
    },
    {
      id: 'perfect_memory',
      name: 'Total Recall',
      description: 'Remember a perfect sequence',
      icon: 'brain',
      unlocked: false,
    },
    {
      id: 'endless_warrior',
      name: 'The Never-Ending Story',
      description: 'Keep the show going in Grand Finale',
      icon: 'infinity',
      unlocked: false,
    },
    {
      id: 'coin_collector',
      name: 'Ticket Master',
      description: 'Collect 1000 tickets total',
      icon: 'coins',
      unlocked: false,
      progress: 0,
      maxProgress: 1000,
    },
    {
      id: 'power_user',
      name: 'Concession King',
      description: 'Use 50 concession items',
      icon: 'lightning',
      unlocked: false,
      progress: 0,
      maxProgress: 50,
    },
    {
      id: 'game_master',
      name: 'Theater Mogul',
      description: 'Host 100 shows',
      icon: 'game-controller',
      unlocked: false,
      progress: 0,
      maxProgress: 100,
    },
    {
      id: 'all_modes',
      name: 'Double Feature',
      description: 'Try all show types',
      icon: 'dice',
      unlocked: false,
    },
    {
      id: 'no_miss',
      name: 'Standing Ovation',
      description: 'Fill 200 seats without a miss',
      icon: 'target',
      unlocked: false,
    },
  ];

  constructor(
    private soundService: SoundService,
    private storageService: StorageService
  ) {
    this.loadAchievements();
  }

  private loadAchievements(): void {
    const saved = this.storageService.loadAchievements();
    if (saved.length > 0) {
      this.achievementsList = this.achievementsList.map((achievement) => {
        const savedAchievement = saved.find((a) => a.id === achievement.id);
        if (savedAchievement) {
          return {
            ...achievement,
            unlocked: savedAchievement.unlocked,
            unlockedAt: savedAchievement.unlockedAt,
            progress: savedAchievement.progress,
          };
        }
        return achievement;
      });
    }
    this.achievements.set([...this.achievementsList]);
  }

  private saveAchievements(): void {
    const toSave: SavedAchievement[] = this.achievementsList.map((a) => ({
      id: a.id,
      unlocked: a.unlocked,
      unlockedAt: a.unlockedAt,
      progress: a.progress,
    }));
    this.storageService.saveAchievements(toSave);
  }

  /**
   * `delaySeconds` pushes the unlock sting later on the AudioContext's own
   * timeline (see SoundService.play()). Callers that already played another
   * sting in the same synchronous pass (e.g. GameService.endGame()'s
   * GameOver/new-high-score stings) pass one so this doesn't pile up on it.
   */
  checkAchievement(id: string, value?: number, delaySeconds = 0): void {
    const achievement = this.achievementsList.find((a) => a.id === id);
    if (!achievement || achievement.unlocked) return;

    let shouldUnlock = false;

    switch (id) {
      case 'first_game':
      case 'all_modes':
      case 'speed_demon':
      case 'perfect_memory':
      case 'endless_warrior':
      case 'no_miss':
        shouldUnlock = true;
        break;

      case 'score_100':
        shouldUnlock = value !== undefined && value >= ACHIEVEMENT_THRESHOLDS.SCORE_100;
        break;

      case 'score_500':
        shouldUnlock = value !== undefined && value >= ACHIEVEMENT_THRESHOLDS.SCORE_500;
        break;

      case 'score_1000':
        shouldUnlock = value !== undefined && value >= ACHIEVEMENT_THRESHOLDS.SCORE_1000;
        break;

      case 'level_5':
        shouldUnlock = value !== undefined && value >= ACHIEVEMENT_THRESHOLDS.LEVEL_5;
        break;

      case 'level_10':
        shouldUnlock = value !== undefined && value >= ACHIEVEMENT_THRESHOLDS.LEVEL_10;
        break;

      case 'level_25':
        shouldUnlock = value !== undefined && value >= ACHIEVEMENT_THRESHOLDS.LEVEL_25;
        break;

      case 'coin_collector':
      case 'power_user':
      case 'game_master':
        if (value !== undefined && achievement.maxProgress) {
          achievement.progress = Math.min(value, achievement.maxProgress);
          shouldUnlock = achievement.progress >= achievement.maxProgress;
        }
        break;
    }

    if (shouldUnlock) {
      this.unlockAchievement(achievement, delaySeconds);
    } else {
      this.achievements.set([...this.achievementsList]);
      this.saveAchievements();
    }
  }

  private unlockAchievement(achievement: Achievement, delaySeconds = 0): void {
    achievement.unlocked = true;
    achievement.unlockedAt = new Date();

    this.achievements.set([...this.achievementsList]);
    this.achievementUnlocked.set(achievement);
    this.saveAchievements();

    // Play achievement sound
    this.soundService.play(SoundType.LevelUp, delaySeconds);

    // Clear notification after duration
    setTimeout(() => {
      this.achievementUnlocked.set(null);
    }, ANIMATION_CONSTANTS.NOTIFICATION_DURATION);
  }

  updateProgress(id: string, progress: number, delaySeconds = 0): void {
    const achievement = this.achievementsList.find((a) => a.id === id);
    if (achievement && !achievement.unlocked && achievement.maxProgress) {
      achievement.progress = Math.min(progress, achievement.maxProgress);
      if (achievement.progress >= achievement.maxProgress) {
        this.unlockAchievement(achievement, delaySeconds);
      } else {
        this.achievements.set([...this.achievementsList]);
        this.saveAchievements();
      }
    }
  }

  getUnlockedCount(): number {
    return this.achievementsList.filter((a) => a.unlocked).length;
  }

  getTotalCount(): number {
    return this.achievementsList.length;
  }
}
