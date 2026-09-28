import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { Seat } from '../theater.service';
import { GAME_MECHANICS } from '../theater.constants';

/**
 * Handles all scoring, multiplier, and points calculation logic
 * Extracted from GameService to follow Single Responsibility Principle
 */
@Injectable({
  providedIn: 'root',
})
export class ScoringService {
  readonly score = signal(0);

  private scoreIncrementSubject = new Subject<number>();
  public readonly scoreIncrement$ = this.scoreIncrementSubject.asObservable();

  readonly multiplier = signal(1.0);

  private multiplierIncrementSubject = new Subject<number>();
  public readonly multiplierIncrement$ = this.multiplierIncrementSubject.asObservable();

  private cumulativeMultiplier = 1;
  private lastMultiplierThreshold = 0;
  private pulseScales = [0, 100, 1000, 10000, 100000];

  constructor() {}

  /**
   * Get current score
   */
  getScore(): number {
    return this.score();
  }

  /**
   * Get current multiplier
   */
  getMultiplier(): number {
    return this.multiplier();
  }

  /**
   * Reset all scoring state
   */
  reset(): void {
    this.score.set(0);
    this.cumulativeMultiplier = 1;
    this.multiplier.set(this.cumulativeMultiplier);
    this.lastMultiplierThreshold = 0;
  }

  /**
   * Add points to score
   */
  addScore(points: number): void {
    const newScore = this.score() + Math.floor(points);
    this.score.set(newScore);
    this.scoreIncrementSubject.next(Math.floor(points));
  }

  /**
   * Set score directly (used for paused game resume)
   */
  setScore(score: number): void {
    this.score.set(score);
  }

  /**
   * Set multiplier directly (used for paused game resume)
   */
  setMultiplier(multiplier: number): void {
    this.cumulativeMultiplier = multiplier;
    this.multiplier.set(multiplier);
  }

  /**
   * Update multiplier based on seat properties
   */
  updateMultiplier(seat: Seat): void {
    let additionalMultiplier = 0;
    if (seat.showSoda) additionalMultiplier += 0.02;
    if (seat.showPopcorn) additionalMultiplier += 0.02;
    if (seat.showSoda && seat.showPopcorn) additionalMultiplier += 0.01;

    this.cumulativeMultiplier += 0.01 + additionalMultiplier;
    const roundedCumulativeMultiplier = Number(this.cumulativeMultiplier.toFixed(2));
    this.multiplier.set(roundedCumulativeMultiplier);

    if (roundedCumulativeMultiplier >= this.lastMultiplierThreshold + 0.1) {
      this.lastMultiplierThreshold = Math.floor(roundedCumulativeMultiplier * 10) / 10;
      this.multiplierIncrementSubject.next(0.1);
    }
  }

  /**
   * Calculate base points for a seat click
   */
  calculateBasePoints(seat: Seat): number {
    let basePoints = 1;

    if (seat.showSoda) basePoints += 1;
    if (seat.showPopcorn) basePoints += 1;

    return basePoints;
  }

  /**
   * Calculate final points including all modifiers
   */
  calculateFinalPoints(
    basePoints: number,
    options: {
      multiplier?: number;
      goldenPopcornMultiplier?: number;
      luckyStreakChance?: number;
      doublePointsActive?: boolean;
      seatUpgradeBonus?: number;
      criticalHitChance?: number;
      criticalHitMultiplier?: number;
    } = {}
  ): { points: number; wasLucky: boolean; wasCritical: boolean } {
    let points = basePoints;

    // Apply flat seat upgrade bonus (before multipliers)
    if (options.seatUpgradeBonus) {
      points += options.seatUpgradeBonus;
    }

    // Apply multiplier
    if (options.multiplier) {
      points *= options.multiplier;
    }

    // Apply golden popcorn multiplier
    if (options.goldenPopcornMultiplier) {
      points *= options.goldenPopcornMultiplier;
    }

    // Check for critical hit first (higher value, takes priority over lucky)
    let wasCritical = false;
    let wasLucky = false;
    if (options.criticalHitChance && Math.random() * 100 < options.criticalHitChance) {
      points *= options.criticalHitMultiplier || 15;
      wasCritical = true;
    } else if (options.luckyStreakChance && Math.random() * 100 < options.luckyStreakChance) {
      // Lucky streak only triggers if critical hit didn't — mutually exclusive
      points *= GAME_MECHANICS.LUCKY_STREAK_MULTIPLIER;
      wasLucky = true;
    }

    // Apply double points power-up
    if (options.doublePointsActive) {
      points *= 2;
    }

    return { points, wasLucky, wasCritical };
  }

  /**
   * Get pulse level based on points scored
   */
  getPulseLevel(pointsScored: number): number {
    const scales = this.pulseScales;
    for (let i = scales.length - 1; i >= 0; i--) {
      if (pointsScored >= scales[i]) {
        return i + 1;
      }
    }
    return 1;
  }
}
