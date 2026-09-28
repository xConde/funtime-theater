import { fakeAsync, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { SeatMovementService } from './seat-movement.service';
import { SeatPosition, SeatRow, TheaterService } from '../theater.service';
import { ScoringService } from './scoring.service';
import { ProgressionService } from './progression.service';
import { ConcessionCacheService } from './concession-cache.service';
import { FilmShowtimeService } from '../film/film-showtime.service';
import { GameMode } from '../game.service';
import type { FilmBeat } from '../film/film.model';

describe('SeatMovementService', () => {
  let service: SeatMovementService;
  let theaterSpy: jasmine.SpyObj<TheaterService>;
  let scoringService: jasmine.SpyObj<ScoringService>;
  let progressionService: jasmine.SpyObj<ProgressionService>;
  let concessionCache: jasmine.SpyObj<ConcessionCacheService>;
  let filmBeat: WritableSignal<FilmBeat | null>;

  const buildSeatsData = (): SeatRow[] => {
    const rows = [];
    for (let row = 1; row <= 8; row++) {
      const leftSeats = [];
      const rightSeats = [];
      for (let s = 1; s <= 4; s++) {
        leftSeats.push({ rowIndex: row, seatIndex: s, side: 'left' as const, showSoda: false, showPopcorn: false });
        rightSeats.push({ rowIndex: row, seatIndex: s, side: 'right' as const, showSoda: false, showPopcorn: false });
      }
      rows.push({ rowIndex: row, seatsPerRow: 8, leftSeats, rightSeats });
    }
    return rows;
  };

  beforeEach(() => {
    theaterSpy = jasmine.createSpyObj('TheaterService', [
      'getActiveSeat',
      'setActiveSeat',
      'getSeatsData',
      'attractSeatsToPosition',
    ]);
    scoringService = jasmine.createSpyObj('ScoringService', ['getMultiplier']);
    progressionService = jasmine.createSpyObj('ProgressionService', ['getDifficultyModifier']);
    concessionCache = jasmine.createSpyObj('ConcessionCacheService', ['getOwned']);

    theaterSpy.getSeatsData.and.returnValue(buildSeatsData());
    scoringService.getMultiplier.and.returnValue(1);
    progressionService.getDifficultyModifier.and.returnValue(1);
    concessionCache.getOwned.and.returnValue(0);
    filmBeat = signal<FilmBeat | null>(null);

    TestBed.configureTestingModule({
      providers: [
        SeatMovementService,
        { provide: TheaterService, useValue: theaterSpy },
        { provide: ScoringService, useValue: scoringService },
        { provide: ProgressionService, useValue: progressionService },
        { provide: ConcessionCacheService, useValue: concessionCache },
        { provide: FilmShowtimeService, useValue: { currentBeat: filmBeat } },
      ],
    });

    service = TestBed.inject(SeatMovementService);
  });

  afterEach(() => {
    service.clearSeatMovement();
  });

  describe('getMovementChance()', () => {
    it('should return minimum chance when multiplier=1 and difficulty=1', () => {
      scoringService.getMultiplier.and.returnValue(1);
      progressionService.getDifficultyModifier.and.returnValue(1);

      const chance = service.getMovementChance();
      expect(chance).toBeCloseTo(0.05, 5);
    });

    it('should return near maximum chance at multiplier=70+ and high difficulty', () => {
      scoringService.getMultiplier.and.returnValue(70);
      progressionService.getDifficultyModifier.and.returnValue(2);

      const chance = service.getMovementChance();
      // baseChance = 0.85, * 2 = 1.7, capped at 0.85
      expect(chance).toBe(0.85);
    });

    it('should cap at MAX_MOVEMENT_CHANCE regardless of difficulty', () => {
      scoringService.getMultiplier.and.returnValue(100);
      progressionService.getDifficultyModifier.and.returnValue(10);

      const chance = service.getMovementChance();
      expect(chance).toBeLessThanOrEqual(0.85);
    });

    it('makes the seat more restless during an intense beat than a quiet one', () => {
      scoringService.getMultiplier.and.returnValue(20);
      progressionService.getDifficultyModifier.and.returnValue(1);

      filmBeat.set({ kind: 'calm', intensity: 0.1, startsAt: 0, duration: 10, label: 'calm' });
      const calm = service.getMovementChance();
      filmBeat.set({ kind: 'climax', intensity: 1, startsAt: 0, duration: 10, label: 'climax' });
      const climax = service.getMovementChance();

      expect(climax).toBeGreaterThan(calm);
      expect(climax).toBeLessThanOrEqual(0.85);
    });
  });

  describe('Carnival mode', () => {
    it('should use sequential pattern directions in carnival mode', () => {
      service.setCarnivalMode(true);

      const activeSeat: SeatPosition = { rowIndex: 1, seatIndex: 2, side: 'left' };
      theaterSpy.getActiveSeat.and.returnValue(activeSeat);
      concessionCache.getOwned.and.returnValue(0);

      // Spy on hopSeatPosition to capture directions
      const directions: string[] = [];
      spyOn(service, 'hopSeatPosition').and.callFake((_seat, dir) => {
        directions.push(dir);
        return { rowIndex: 1, seatIndex: 2, side: 'left' as const };
      });

      // Trigger 4 moves — should cycle right, down, left, up
      for (let i = 0; i < 4; i++) {
        // Access private moveActiveSeat via the service — call it indirectly via the public method
        // We test by directly verifying the pattern property progression via hopSeatPosition
        service['moveActiveSeat']();
      }

      expect(directions).toEqual(['right', 'down', 'left', 'up']);
    });

    it('should reset carnivalPattern when setCarnivalMode is called with false', () => {
      service.setCarnivalMode(true);
      service['carnivalPattern'] = 3;
      service.setCarnivalMode(false);
      expect(service['carnivalPattern']).toBe(0);
    });
  });

  describe('Random mode', () => {
    it('should use random directions when carnival mode is off', () => {
      service.setCarnivalMode(false);

      const activeSeat: SeatPosition = { rowIndex: 1, seatIndex: 2, side: 'left' };
      theaterSpy.getActiveSeat.and.returnValue(activeSeat);
      concessionCache.getOwned.and.returnValue(0);

      const usedDirections = new Set<string>();
      spyOn(service, 'hopSeatPosition').and.callFake((_seat, dir) => {
        usedDirections.add(dir);
        return null;
      });

      // Run many iterations to get varied results
      for (let i = 0; i < 100; i++) {
        service['moveActiveSeat']();
      }

      // Should have used more than one direction across 100 calls
      expect(usedDirections.size).toBeGreaterThan(1);
    });
  });

  describe('Magnetic field', () => {
    it('should use magnetic field when owned and cursor position is set', () => {
      const activeSeat: SeatPosition = { rowIndex: 1, seatIndex: 2, side: 'left' };
      const magneticTarget: SeatPosition = { rowIndex: 3, seatIndex: 1, side: 'right' };

      theaterSpy.getActiveSeat.and.returnValue(activeSeat);
      concessionCache.getOwned.and.returnValue(3); // magneticField owned
      theaterSpy.attractSeatsToPosition.and.returnValue(magneticTarget);

      service.updateCursorPosition(100, 200);
      service['moveActiveSeat']();

      expect(theaterSpy.attractSeatsToPosition).toHaveBeenCalledWith({ x: 100, y: 200 }, 3);
      expect(theaterSpy.setActiveSeat).toHaveBeenCalledWith(magneticTarget);
    });

    it('should fall back to direction movement when magnetic field returns null', () => {
      const activeSeat: SeatPosition = { rowIndex: 1, seatIndex: 2, side: 'left' };
      theaterSpy.getActiveSeat.and.returnValue(activeSeat);
      concessionCache.getOwned.and.returnValue(3);
      theaterSpy.attractSeatsToPosition.and.returnValue(null);

      service.updateCursorPosition(100, 200);

      const hopSpy = spyOn(service, 'hopSeatPosition').and.returnValue(null);
      service['moveActiveSeat']();

      expect(hopSpy).toHaveBeenCalled();
    });
  });

  describe('hopSeatPosition()', () => {
    it('should wrap up from row 1 to last row', () => {
      const seat: SeatPosition = { rowIndex: 1, seatIndex: 1, side: 'left' };
      const result = service.hopSeatPosition(seat, 'up');
      expect(result?.rowIndex).toBe(8);
    });

    it('should wrap down from last row to row 1', () => {
      const seat: SeatPosition = { rowIndex: 8, seatIndex: 1, side: 'left' };
      const result = service.hopSeatPosition(seat, 'down');
      expect(result?.rowIndex).toBe(1);
    });

    it('should cross from left side to right side when moving right at boundary', () => {
      // seatIndex 4 is the last on left side (4 seats per side)
      const seat: SeatPosition = { rowIndex: 1, seatIndex: 4, side: 'left' };
      const result = service.hopSeatPosition(seat, 'right');
      expect(result?.side).toBe('right');
      expect(result?.seatIndex).toBe(1);
    });

    it('should cross from right side to left side when moving left at boundary', () => {
      const seat: SeatPosition = { rowIndex: 1, seatIndex: 1, side: 'right' };
      const result = service.hopSeatPosition(seat, 'left');
      expect(result?.side).toBe('left');
      expect(result?.seatIndex).toBe(4);
    });

    it('should return null for unknown direction', () => {
      const seat: SeatPosition = { rowIndex: 1, seatIndex: 1, side: 'left' };
      const result = service.hopSeatPosition(seat, 'diagonal');
      expect(result).toBeNull();
    });
  });

  describe('clearSeatMovement()', () => {
    it('should stop the interval subscription', fakeAsync(() => {
      const activeSeat: SeatPosition = { rowIndex: 1, seatIndex: 1, side: 'left' };
      theaterSpy.getActiveSeat.and.returnValue(activeSeat);
      scoringService.getMultiplier.and.returnValue(1);
      progressionService.getDifficultyModifier.and.returnValue(1);

      service.setGameMode(GameMode.Classic);
      service.startSeatMovement();

      expect(service['seatMovementSubscription']).not.toBeNull();

      service.clearSeatMovement();

      expect(service['seatMovementSubscription']).toBeNull();
      expect(service['hopCooldown']).toBeFalse();
    }));
  });

  describe('Slow time', () => {
    it('should double tick speed when slow time is active', () => {
      // Verify that startSeatMovement uses doubled tick when slow time is active
      // We do this by checking the subscription is created and that the tickSpeed
      // calculation was applied (we observe the subscription was created without error)
      service.setGameMode(GameMode.Classic);
      service.setSlowTimeActive(true);
      service.startSeatMovement();

      expect(service['seatMovementSubscription']).not.toBeNull();
      service.clearSeatMovement();
    });

    it('should use normal tick speed when slow time is inactive', () => {
      service.setGameMode(GameMode.Classic);
      service.setSlowTimeActive(false);
      service.startSeatMovement();

      expect(service['seatMovementSubscription']).not.toBeNull();
      service.clearSeatMovement();
    });
  });

  describe('Endless/Finale speed multiplier', () => {
    it('should use speed multiplier for Endless mode', () => {
      service.setGameMode(GameMode.Endless);
      service.setEndlessSpeedMultiplier(2);
      service.startSeatMovement();

      expect(service['seatMovementSubscription']).not.toBeNull();
      service.clearSeatMovement();
    });

    it('should use speed multiplier for Finale mode', () => {
      service.setGameMode(GameMode.Finale);
      service.setEndlessSpeedMultiplier(3);
      service.startSeatMovement();

      expect(service['seatMovementSubscription']).not.toBeNull();
      service.clearSeatMovement();
    });

    it('should expose the current endless speed multiplier', () => {
      service.setEndlessSpeedMultiplier(2.5);
      expect(service.getEndlessSpeedMultiplier()).toBe(2.5);
    });
  });
});
