import { TestBed } from '@angular/core/testing';
import { Seat, SeatPosition, TheaterService } from './theater.service';
import { take } from 'rxjs/operators';

describe('TheaterService', () => {
  let service: TheaterService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TheaterService],
    });
    service = TestBed.inject(TheaterService);
  });

  describe('Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should initialize with seats data', () => {
      const seatsData = service.getSeatsData();
      expect(seatsData.length).toBeGreaterThan(0);

      seatsData.forEach((row) => {
        expect(row.leftSeats.length).toBeGreaterThan(0);
        expect(row.rightSeats.length).toBeGreaterThan(0);
      });
    });

    it('should start with no active seat', () => {
      expect(service.activeSeat()).toBeNull();
    });

    it('should start with zero clicked count', () => {
      expect(service.getClickedCount()).toBe(0);
    });
  });

  describe('Active Seat Management', () => {
    it('should set active seat correctly', () => {
      const testSeat = { rowIndex: 3, seatIndex: 5, side: 'left' as const };
      service.setActiveSeat(testSeat);
      expect(service.activeSeat()).toEqual(testSeat);
    });

    it('should clear active seat', () => {
      const testSeat = { rowIndex: 3, seatIndex: 5, side: 'left' as const };
      service.setActiveSeat(testSeat);
      service.setActiveSeat(null);
      expect(service.activeSeat()).toBeNull();
    });

    it('should handle rapid seat changes', () => {
      const seats: SeatPosition[] = [
        { rowIndex: 1, seatIndex: 1, side: 'left' },
        { rowIndex: 2, seatIndex: 3, side: 'right' },
        { rowIndex: 5, seatIndex: 7, side: 'left' },
      ];

      seats.forEach((seat) => service.setActiveSeat(seat));
      expect(service.activeSeat()).toEqual(seats[2]);
    });

    it('getRandomSeat prefers seats the predicate accepts', () => {
      // The whole left side is easily satisfiable, so the pick should be left.
      const picked = service.getRandomSeat((s) => s.side === 'left');
      expect(picked?.side).toBe('left');
    });

    it('getRandomSeat falls back to any valid seat when the preference matches nothing', () => {
      const picked = service.getRandomSeat(() => false);
      expect(picked).not.toBeNull();
    });
  });

  describe('Hover Event Management', () => {
    it('should emit hover events correctly', (done) => {
      const seat = {
        rowIndex: 2,
        seatIndex: 4,
        side: 'right' as const,
        showSoda: false,
        showPopcorn: false,
      };

      service.hoverEvent$.pipe(take(1)).subscribe((event) => {
        expect(event).toBeTruthy();
        expect(event?.side).toBe('right');
        expect(event?.rowIndex).toBe(2);
        expect(event?.seatIndex).toBe(4);
        done();
      });

      service.hoverSeat(seat);
    });

    it('should handle hover clear', (done) => {
      service.hoverEvent$.pipe(take(1)).subscribe((event) => {
        expect(event).toBeNull();
        done();
      });

      service.clearHover();
    });

    it('does not score the opposite-side seat with the same row and number', (done) => {
      service.setActiveSeat({ side: 'left', rowIndex: 2, seatIndex: 1 });
      const oppositeSeat: Seat = {
        side: 'right',
        rowIndex: 2,
        seatIndex: 1,
        showSoda: false,
        showPopcorn: false,
      };

      service.hoverEvent$.pipe(take(1)).subscribe((event) => {
        expect(event?.side).toBe('right');
        expect(event?.message).not.toContain('Score!');
        done();
      });

      service.hoverSeat(oppositeSeat);
    });

    it('scores only the exact active seat', (done) => {
      service.setActiveSeat({ side: 'right', rowIndex: 2, seatIndex: 1 });
      const activeSeat: Seat = {
        side: 'right',
        rowIndex: 2,
        seatIndex: 1,
        showSoda: false,
        showPopcorn: false,
      };

      service.hoverEvent$.pipe(take(1)).subscribe((event) => {
        expect(event?.message).toContain('Score!');
        done();
      });

      service.hoverSeat(activeSeat);
    });
  });

  describe('Resize reconciliation', () => {
    it('clears a selected seat that no longer exists on its side', () => {
      service.selectSeat({ side: 'left', rowIndex: 1, seatIndex: 4, showSoda: false, showPopcorn: false });

      service.handleResize(500, 500);

      expect(service.selectedSeat()).toBeNull();
    });

    it('moves an active target onto a seat that still exists after shrink', () => {
      service.setActiveSeat({ side: 'right', rowIndex: 8, seatIndex: 4 });

      service.handleResize(500, 500);

      const active = service.getActiveSeat();
      expect(active).not.toBeNull();
      const activeRow = service.getSeatsData()[active!.rowIndex - 1];
      const activeSide = active!.side === 'left' ? activeRow.leftSeats : activeRow.rightSeats;
      expect(active!.seatIndex).toBeLessThanOrEqual(activeSide.length);
    });

    it('preserves an active target that remains valid', () => {
      const active: SeatPosition = { side: 'left', rowIndex: 1, seatIndex: 1 };
      service.setActiveSeat(active);

      service.handleResize(500, 500);

      expect(service.getActiveSeat()).toEqual(active);
    });
  });

  describe('Click Count Management', () => {
    it('should increment click count', () => {
      expect(service.getClickedCount()).toBe(0);

      service.incrementClickedCount();
      expect(service.getClickedCount()).toBe(1);

      service.incrementClickedCount();
      service.incrementClickedCount();
      expect(service.getClickedCount()).toBe(3);
    });

    it('should reset click count', () => {
      service.incrementClickedCount();
      service.incrementClickedCount();
      expect(service.getClickedCount()).toBe(2);

      service.resetClickedCount();
      expect(service.getClickedCount()).toBe(0);
    });
  });

  describe('Seats Data', () => {
    it('should return immutable seats data', () => {
      const seatsData1 = service.getSeatsData();
      const seatsData2 = service.getSeatsData();

      // Should return the same reference (not creating new array each time)
      expect(seatsData1).toBe(seatsData2);
    });

    it('should have valid seat structure', () => {
      const seatsData = service.getSeatsData();

      seatsData.forEach((row) => {
        expect(row.leftSeats).toBeDefined();
        expect(row.rightSeats).toBeDefined();

        // Each seat should be an object (empty in this case)
        row.leftSeats.forEach((seat) => {
          expect(typeof seat).toBe('object');
        });

        row.rightSeats.forEach((seat) => {
          expect(typeof seat).toBe('object');
        });
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle invalid seat positions gracefully', () => {
      // Service should handle these without throwing
      expect(() => {
        service.setActiveSeat({ rowIndex: -1, seatIndex: 0, side: 'left' });
      }).not.toThrow();

      expect(() => {
        service.setActiveSeat({ rowIndex: 100, seatIndex: 100, side: 'right' });
      }).not.toThrow();
    });

    it('should handle multiple hover events in quick succession', () => {
      const seats: Seat[] = [];
      for (let i = 0; i < 10; i++) {
        seats.push({
          rowIndex: (i % 8) + 1,
          seatIndex: (i % 8) + 1,
          side: i % 2 === 0 ? 'left' : 'right',
          showSoda: false,
          showPopcorn: false,
        });
      }

      expect(() => {
        seats.forEach((seat) => service.hoverSeat(seat));
      }).not.toThrow();
    });
  });

  describe('Signal Behavior', () => {
    it('should reflect active seat changes immediately', () => {
      const testSeat = { rowIndex: 1, seatIndex: 1, side: 'left' as const };

      expect(service.activeSeat()).toBeNull();
      service.setActiveSeat(testSeat);
      expect(service.activeSeat()).toEqual(testSeat);
      service.setActiveSeat(testSeat); // Same seat again
      expect(service.activeSeat()).toEqual(testSeat);
    });
  });
});
