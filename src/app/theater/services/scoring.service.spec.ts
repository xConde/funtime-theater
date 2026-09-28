import { TestBed } from '@angular/core/testing';
import { ScoringService } from './scoring.service';
import { Seat } from '../theater.service';
import { GAME_MECHANICS } from '../theater.constants';

describe('ScoringService', () => {
  let service: ScoringService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ScoringService);
  });

  afterEach(() => {
    service.reset();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('score management', () => {
    it('should initialize with score of 0', () => {
      expect(service.getScore()).toBe(0);
    });

    it('should update score when adding points', () => {
      service.addScore(50);
      expect(service.getScore()).toBe(50);
    });

    it('should emit score increment events', (done) => {
      service.scoreIncrement$.subscribe((increment) => {
        expect(increment).toBe(25);
        done();
      });

      service.addScore(25);
    });

    it('should accumulate multiple score additions', () => {
      service.addScore(10);
      service.addScore(20);
      service.addScore(15);

      expect(service.getScore()).toBe(45);
    });

    it('should set score directly', () => {
      service.setScore(100);
      expect(service.getScore()).toBe(100);
    });

    it('should floor decimal scores', () => {
      service.addScore(10.7);
      expect(service.getScore()).toBe(10);
    });

    it('should reset score to 0', () => {
      service.addScore(100);
      service.reset();
      expect(service.getScore()).toBe(0);
    });
  });

  describe('multiplier management', () => {
    it('should initialize with multiplier of 1.0', () => {
      expect(service.getMultiplier()).toBe(1.0);
    });

    it('should update multiplier based on seat properties', () => {
      const seat: Partial<Seat> = {
        showSoda: true,
        showPopcorn: false,
      };

      service.updateMultiplier(seat as Seat);

      expect(service.getMultiplier()).toBeCloseTo(1.03, 2); // 1.0 + 0.01 + 0.02
    });

    it('should increase multiplier for both soda and popcorn', () => {
      const seat: Partial<Seat> = {
        showSoda: true,
        showPopcorn: true,
      };

      service.updateMultiplier(seat as Seat);

      expect(service.getMultiplier()).toBeCloseTo(1.06, 2); // 1.0 + 0.01 + 0.02 + 0.02 + 0.01
    });

    it('should emit multiplier increment when threshold crossed', (done) => {
      let incrementCount = 0;

      service.multiplierIncrement$.subscribe((increment) => {
        incrementCount++;
        expect(increment).toBe(0.1);
        if (incrementCount === 1) done();
      });

      // Add enough to cross 0.1 threshold
      for (let i = 0; i < 10; i++) {
        const seat: Partial<Seat> = {
          showSoda: false,
          showPopcorn: false,
        };
        service.updateMultiplier(seat as Seat);
      }
    });

    it('should round multiplier to 2 decimal places', () => {
      const seat: Partial<Seat> = {
        showSoda: false,
        showPopcorn: false,
      };

      for (let i = 0; i < 5; i++) {
        service.updateMultiplier(seat as Seat);
      }

      const multiplier = service.getMultiplier();
      expect(multiplier.toString().split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });

    it('should set multiplier directly', () => {
      service.setMultiplier(2.5);
      expect(service.getMultiplier()).toBe(2.5);
    });

    it('should reset multiplier to 1.0', () => {
      service.setMultiplier(5.0);
      service.reset();
      expect(service.getMultiplier()).toBe(1.0);
    });
  });

  describe('calculateBasePoints', () => {
    it('should return 1 for empty seat', () => {
      const seat: Partial<Seat> = {
        showSoda: false,
        showPopcorn: false,
      };

      const points = service.calculateBasePoints(seat as Seat);
      expect(points).toBe(1);
    });

    it('should return 2 for seat with soda', () => {
      const seat: Partial<Seat> = {
        showSoda: true,
        showPopcorn: false,
      };

      const points = service.calculateBasePoints(seat as Seat);
      expect(points).toBe(2);
    });

    it('should return 2 for seat with popcorn', () => {
      const seat: Partial<Seat> = {
        showSoda: false,
        showPopcorn: true,
      };

      const points = service.calculateBasePoints(seat as Seat);
      expect(points).toBe(2);
    });

    it('should return 3 for seat with both soda and popcorn', () => {
      const seat: Partial<Seat> = {
        showSoda: true,
        showPopcorn: true,
      };

      const points = service.calculateBasePoints(seat as Seat);
      expect(points).toBe(3);
    });
  });

  describe('calculateFinalPoints', () => {
    it('should return base points with no modifiers', () => {
      const result = service.calculateFinalPoints(10, {});

      expect(result.points).toBe(10);
      expect(result.wasLucky).toBe(false);
      expect(result.wasCritical).toBe(false);
    });

    it('should apply multiplier', () => {
      const result = service.calculateFinalPoints(10, { multiplier: 2.0 });

      expect(result.points).toBe(20);
      expect(result.wasCritical).toBe(false);
    });

    it('should apply golden popcorn multiplier', () => {
      const result = service.calculateFinalPoints(10, { goldenPopcornMultiplier: 1.5 });

      expect(result.points).toBe(15);
      expect(result.wasCritical).toBe(false);
    });

    it('should apply double points power-up', () => {
      const result = service.calculateFinalPoints(10, { doublePointsActive: true });

      expect(result.points).toBe(20);
      expect(result.wasCritical).toBe(false);
    });

    it('should apply all multipliers together', () => {
      const result = service.calculateFinalPoints(10, {
        multiplier: 2.0,
        goldenPopcornMultiplier: 1.5,
        doublePointsActive: true,
      });

      expect(result.points).toBe(60); // 10 * 2.0 * 1.5 * 2
      expect(result.wasCritical).toBe(false);
    });

    it('should apply lucky streak with 100% chance', () => {
      const result = service.calculateFinalPoints(10, { luckyStreakChance: 100 });

      expect(result.points).toBe(10 * GAME_MECHANICS.LUCKY_STREAK_MULTIPLIER);
      expect(result.wasLucky).toBe(true);
      expect(result.wasCritical).toBe(false);
    });

    it('should not apply lucky streak with 0% chance', () => {
      const result = service.calculateFinalPoints(10, { luckyStreakChance: 0 });

      expect(result.points).toBe(10);
      expect(result.wasLucky).toBe(false);
      expect(result.wasCritical).toBe(false);
    });

    it('should apply seat upgrade flat bonus before multipliers', () => {
      const result = service.calculateFinalPoints(1, {
        seatUpgradeBonus: 10,
        multiplier: 2.0,
      });

      // (1 + 10) * 2.0 = 22
      expect(result.points).toBe(22);
      expect(result.wasLucky).toBe(false);
      expect(result.wasCritical).toBe(false);
    });

    it('should apply critical hit with 100% chance', () => {
      const result = service.calculateFinalPoints(10, {
        criticalHitChance: 100,
        criticalHitMultiplier: 15,
      });

      expect(result.points).toBe(150); // 10 * 15
      expect(result.wasCritical).toBe(true);
    });

    it('should not apply critical hit with 0% chance', () => {
      const result = service.calculateFinalPoints(10, {
        criticalHitChance: 0,
        criticalHitMultiplier: 15,
      });

      expect(result.points).toBe(10);
      expect(result.wasCritical).toBe(false);
    });

    it('should make critical hit and lucky streak mutually exclusive (critical wins)', () => {
      const result = service.calculateFinalPoints(10, {
        luckyStreakChance: 100,
        criticalHitChance: 100,
        criticalHitMultiplier: 15,
      });

      // Critical (x15) takes priority — lucky doesn't stack
      expect(result.points).toBe(150);
      expect(result.wasLucky).toBe(false);
      expect(result.wasCritical).toBe(true);
    });

    it('should apply all modifiers in correct order', () => {
      const result = service.calculateFinalPoints(1, {
        seatUpgradeBonus: 4, // +4 flat → 5
        multiplier: 2.0, // *2 → 10
        goldenPopcornMultiplier: 1.5, // *1.5 → 15
        doublePointsActive: true, // *2 → 30
      });

      expect(result.points).toBe(30);
      expect(result.wasLucky).toBe(false);
      expect(result.wasCritical).toBe(false);
    });
  });

  describe('getPulseLevel', () => {
    it('should return level 1 for 0 points', () => {
      expect(service.getPulseLevel(0)).toBe(1);
    });

    it('should return level 2 for 100+ points', () => {
      expect(service.getPulseLevel(100)).toBe(2);
      expect(service.getPulseLevel(500)).toBe(2);
    });

    it('should return level 3 for 1000+ points', () => {
      expect(service.getPulseLevel(1000)).toBe(3);
      expect(service.getPulseLevel(5000)).toBe(3);
    });

    it('should return level 4 for 10000+ points', () => {
      expect(service.getPulseLevel(10000)).toBe(4);
      expect(service.getPulseLevel(50000)).toBe(4);
    });

    it('should return level 5 for 100000+ points', () => {
      expect(service.getPulseLevel(100000)).toBe(5);
      expect(service.getPulseLevel(999999)).toBe(5);
    });
  });

  describe('signal behavior', () => {
    it('should reflect score changes immediately', () => {
      service.addScore(50);
      expect(service.score()).toBe(50);
    });

    it('should provide latest score when read', () => {
      service.addScore(75);
      expect(service.score()).toBe(75);
    });
  });

  describe('power-up stacking (integration)', () => {
    it('should apply golden popcorn + doublePoints correctly', () => {
      const result = service.calculateFinalPoints(10, {
        multiplier: 2.0,
        goldenPopcornMultiplier: 1.5,
        doublePointsActive: true,
      });
      // 10 * 2.0 * 1.5 * 2 = 60
      expect(result.points).toBe(60);
    });

    it('should apply seat upgrade + golden popcorn + critical correctly', () => {
      const result = service.calculateFinalPoints(1, {
        seatUpgradeBonus: 5,
        multiplier: 1.5,
        goldenPopcornMultiplier: 2.0,
        criticalHitChance: 100,
        criticalHitMultiplier: 15,
      });
      // (1+5) * 1.5 * 2.0 * 15 = 270
      expect(result.points).toBe(270);
      expect(result.wasCritical).toBe(true);
      expect(result.wasLucky).toBe(false);
    });

    it('should apply lucky when critical does not trigger', () => {
      const result = service.calculateFinalPoints(10, {
        luckyStreakChance: 100,
        criticalHitChance: 0,
      });
      expect(result.points).toBe(10 * GAME_MECHANICS.LUCKY_STREAK_MULTIPLIER);
      expect(result.wasLucky).toBe(true);
      expect(result.wasCritical).toBe(false);
    });

    it('should apply no bonus when both chances are 0', () => {
      const result = service.calculateFinalPoints(10, {
        luckyStreakChance: 0,
        criticalHitChance: 0,
      });
      expect(result.points).toBe(10);
      expect(result.wasLucky).toBe(false);
      expect(result.wasCritical).toBe(false);
    });

    it('should handle all modifiers at maximum values', () => {
      const result = service.calculateFinalPoints(3, {
        seatUpgradeBonus: 25,
        multiplier: 5.0,
        goldenPopcornMultiplier: 8.0,
        criticalHitChance: 100,
        criticalHitMultiplier: 15,
        doublePointsActive: true,
      });
      // (3+25) * 5.0 * 8.0 * 15 * 2 = 33600
      expect(result.points).toBe(33600);
      expect(result.wasCritical).toBe(true);
    });
  });
});
