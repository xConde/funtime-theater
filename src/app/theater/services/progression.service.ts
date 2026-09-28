import { Injectable, signal } from '@angular/core';
import { StorageService } from './storage.service';
import { SoundService, SoundType } from '../sound.service';
import { AchievementsService } from '../achievements.service';
import { PROGRESSION_MILESTONES } from '../theater.constants';

/**
 * Handles player progression: XP, levels, and achievement tracking
 * Extracted from GameService to follow Single Responsibility Principle
 */
@Injectable({
  providedIn: 'root',
})
export class ProgressionService {
  readonly currentLevel = signal(1);
  readonly levelProgress = signal(0);
  readonly totalXP = signal(0);

  constructor(
    private storageService: StorageService,
    private soundService: SoundService,
    private achievementsService: AchievementsService
  ) {
    this.loadLevelData();
  }

  /**
   * Get current player level
   */
  getCurrentLevel(): number {
    return this.currentLevel();
  }

  /**
   * Get total XP
   */
  getTotalXP(): number {
    return this.totalXP();
  }

  /**
   * Load level data from storage
   */
  private loadLevelData(): void {
    const data = this.storageService.loadGameData();
    const xp = data.totalXP || 0;
    this.totalXP.set(xp);
    this.updateLevelFromXP(xp);
  }

  /**
   * Award XP to the player
   */
  awardXP(amount: number): void {
    const currentXP = this.totalXP();
    const newXP = currentXP + amount;
    const oldLevel = this.currentLevel();

    this.totalXP.set(newXP);
    this.updateLevelFromXP(newXP);

    const newLevel = this.currentLevel();
    if (newLevel > oldLevel) {
      this.soundService.play(SoundType.LevelUp);
      this.achievementsService.checkAchievement('level_5', newLevel);
      this.achievementsService.checkAchievement('level_10', newLevel);
      this.achievementsService.checkAchievement('level_25', newLevel);

      // Award milestone bonuses for each level crossed
      for (let level = oldLevel + 1; level <= newLevel; level++) {
        const milestone = PROGRESSION_MILESTONES.find((m) => m.level === level);
        if (milestone) {
          this.storageService.addCoins(milestone.ticketBonus);
        }
      }
    }

    this.storageService.updateXP(newXP);
  }

  /**
   * Calculate level from total XP
   */
  private calculateLevelFromXP(xp: number): number {
    let level = 1;
    while (this.getXPForLevel(level + 1) <= xp) {
      level++;
    }
    return level;
  }

  /**
   * Get XP required for a specific level
   */
  private getXPForLevel(level: number): number {
    if (level <= 1) return 0;
    return Math.floor(100 * Math.pow(level - 1, 1.5));
  }

  /**
   * Update level from total XP
   */
  private updateLevelFromXP(xp: number): void {
    const level = this.calculateLevelFromXP(xp);
    this.currentLevel.set(level);

    const currentLevelXP = this.getXPForLevel(level);
    const nextLevelXP = this.getXPForLevel(level + 1);
    const progressXP = xp - currentLevelXP;
    const levelXPRequired = nextLevelXP - currentLevelXP;
    // Guard division — `getXPForLevel` is a power curve today, but a future
    // formula tweak that makes consecutive levels equal would produce NaN
    // here, which then silently drops into [style.width.%]="levelProgress"
    // in the lobby header and renders an empty progress bar.
    const progress = levelXPRequired > 0 ? Math.floor((progressXP / levelXPRequired) * 100) : 0;

    this.levelProgress.set(progress);
  }

  /**
   * Get difficulty modifier based on player level
   */
  getDifficultyModifier(): number {
    const level = this.currentLevel();
    return 1 + (level - 1) * 0.05;
  }

  /**
   * Get XP multiplier for a specific game mode
   */
  getXPMultiplier(gameMode: string): number {
    switch (gameMode) {
      case 'timeAttack':
        return 0.8; // Less XP for time attack (easier)
      case 'memory':
        return 1.5; // More XP for memory (harder)
      case 'endless':
        return 1.2; // Moderate bonus for endless
      case 'midnight':
        return 1.3; // Bonus for blackout difficulty
      case 'carnival':
        return 1.5; // Bonus for circular patterns
      case 'finale':
        return 2.0; // Maximum XP for hardest mode
      default:
        return 1.0; // Standard XP for classic
    }
  }
}
