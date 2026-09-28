import { TestBed } from '@angular/core/testing';
import { PowerUpEventsService } from './power-up-events.service';
import { Seat } from '../theater.service';

describe('PowerUpEventsService', () => {
  let service: PowerUpEventsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PowerUpEventsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('auto-click events', () => {
    it('should emit auto-click events', (done) => {
      const mockSeat = {
        seatIndex: 1,
        rowIndex: 1,
        side: 'left' as const,
        showSoda: false,
        showPopcorn: false,
      } as Seat;

      service.autoClick$.subscribe((event) => {
        expect(event.seat.seatIndex).toBe(1);
        expect(event.seat.rowIndex).toBe(1);
        expect(event.seat.side).toBe('left');
        done();
      });

      service.triggerAutoClick(mockSeat);
    });

    it('should emit multiple auto-click events', () => {
      const events: unknown[] = [];

      service.autoClick$.subscribe((event) => events.push(event));

      service.triggerAutoClick({ seatIndex: 1 } as Seat);
      service.triggerAutoClick({ seatIndex: 2 } as Seat);
      service.triggerAutoClick({ seatIndex: 3 } as Seat);

      expect(events.length).toBe(3);
    });

    it('should work with multiple subscribers', () => {
      const subscriber1Events: unknown[] = [];
      const subscriber2Events: unknown[] = [];

      service.autoClick$.subscribe((event) => subscriber1Events.push(event));
      service.autoClick$.subscribe((event) => subscriber2Events.push(event));

      service.triggerAutoClick({ seatIndex: 1 } as Seat);

      expect(subscriber1Events.length).toBe(1);
      expect(subscriber2Events.length).toBe(1);
    });
  });

  describe('magnetic field events', () => {
    it('should emit magnetic field update events', (done) => {
      const testRange = 5;

      service.magneticFieldUpdate$.subscribe((event) => {
        expect(event.range).toBe(testRange);
        done();
      });

      service.updateMagneticField({} as Seat, testRange);
    });

    it('should handle range of 0', (done) => {
      service.magneticFieldUpdate$.subscribe((event) => {
        expect(event.range).toBe(0);
        done();
      });

      service.updateMagneticField({} as Seat, 0);
    });

    it('should handle large range values', (done) => {
      service.magneticFieldUpdate$.subscribe((event) => {
        expect(event.range).toBe(100);
        done();
      });

      service.updateMagneticField({} as Seat, 100);
    });
  });

  describe('usher click events', () => {
    it('should emit usher click events with all properties', (done) => {
      const mockSeat = {
        seatIndex: 2,
        rowIndex: 3,
        side: 'right' as const,
        showSoda: false,
        showPopcorn: false,
      } as Seat;
      const value = 50;
      const percent = 0.75;

      service.usherClick$.subscribe((event) => {
        expect(event.seat.seatIndex).toBe(2);
        expect(event.seat.rowIndex).toBe(3);
        expect(event.seat.side).toBe('right');
        expect(event.value).toBe(value);
        expect(event.percent).toBe(percent);
        done();
      });

      service.triggerUsherClick(mockSeat, value, percent);
    });

    it('should handle 0 value', (done) => {
      service.usherClick$.subscribe((event) => {
        expect(event.value).toBe(0);
        done();
      });

      service.triggerUsherClick({} as Seat, 0, 1.0);
    });

    it('should handle percent greater than 1', (done) => {
      service.usherClick$.subscribe((event) => {
        expect(event.percent).toBe(1.25);
        done();
      });

      service.triggerUsherClick({} as Seat, 100, 1.25);
    });
  });

  describe('blackout events', () => {
    it('should emit blackout events with duration', (done) => {
      const duration = 3000;

      service.blackout$.subscribe((event) => {
        expect(event.duration).toBe(duration);
        done();
      });

      service.triggerBlackout(duration);
    });

    it('should handle short duration', (done) => {
      service.blackout$.subscribe((event) => {
        expect(event.duration).toBe(100);
        done();
      });

      service.triggerBlackout(100);
    });

    it('should handle long duration', (done) => {
      service.blackout$.subscribe((event) => {
        expect(event.duration).toBe(10000);
        done();
      });

      service.triggerBlackout(10000);
    });

    it('should emit multiple blackout events', () => {
      const durations: number[] = [];

      service.blackout$.subscribe((event) => durations.push(event.duration));

      service.triggerBlackout(1000);
      service.triggerBlackout(2000);
      service.triggerBlackout(3000);

      expect(durations).toEqual([1000, 2000, 3000]);
    });
  });

  describe('event isolation', () => {
    it('should not cross-contaminate different event types', () => {
      const autoClickEvents: unknown[] = [];
      const blackoutEvents: unknown[] = [];

      service.autoClick$.subscribe((event) => autoClickEvents.push(event));
      service.blackout$.subscribe((event) => blackoutEvents.push(event));

      service.triggerAutoClick({} as Seat);
      service.triggerBlackout(1000);
      service.triggerAutoClick({} as Seat);

      expect(autoClickEvents.length).toBe(2);
      expect(blackoutEvents.length).toBe(1);
    });

    it('should handle simultaneous events of different types', () => {
      let autoClickReceived = false;
      let magneticReceived = false;
      let usherReceived = false;
      let blackoutReceived = false;

      service.autoClick$.subscribe(() => (autoClickReceived = true));
      service.magneticFieldUpdate$.subscribe(() => (magneticReceived = true));
      service.usherClick$.subscribe(() => (usherReceived = true));
      service.blackout$.subscribe(() => (blackoutReceived = true));

      service.triggerAutoClick({} as Seat);
      service.updateMagneticField({} as Seat, 5);
      service.triggerUsherClick({} as Seat, 10, 1.0);
      service.triggerBlackout(1000);

      expect(autoClickReceived).toBe(true);
      expect(magneticReceived).toBe(true);
      expect(usherReceived).toBe(true);
      expect(blackoutReceived).toBe(true);
    });
  });

  describe('memory management', () => {
    it('should allow unsubscribing from events', () => {
      let eventCount = 0;

      const subscription = service.autoClick$.subscribe(() => eventCount++);

      service.triggerAutoClick({} as Seat);
      expect(eventCount).toBe(1);

      subscription.unsubscribe();

      service.triggerAutoClick({} as Seat);
      expect(eventCount).toBe(1); // Should not increment after unsubscribe
    });

    it('should support late subscribers', (done) => {
      service.triggerAutoClick({} as Seat);

      // Subscribe after event was triggered
      setTimeout(() => {
        service.autoClick$.subscribe((event) => {
          // Should receive next event, not the previous one
          expect(event).toBeDefined();
          done();
        });

        service.triggerAutoClick({} as Seat);
      }, 10);
    });
  });

  describe('passiveIncomeTick$ events', () => {
    it('should emit passiveIncomeTick$ with amount', (done) => {
      service.passiveIncomeTick$.subscribe((event) => {
        expect(event.amount).toBe(25);
        done();
      });
      service.triggerPassiveIncomeTick(25);
    });

    it('should emit multiple passiveIncomeTick$ events', () => {
      const amounts: number[] = [];
      service.passiveIncomeTick$.subscribe((e) => amounts.push(e.amount));
      service.triggerPassiveIncomeTick(10);
      service.triggerPassiveIncomeTick(20);
      expect(amounts).toEqual([10, 20]);
    });

    it('should handle zero amount', (done) => {
      service.passiveIncomeTick$.subscribe((event) => {
        expect(event.amount).toBe(0);
        done();
      });
      service.triggerPassiveIncomeTick(0);
    });
  });

  describe('ticketStormFire$ events', () => {
    it('should emit ticketStormFire$ with amount', (done) => {
      service.ticketStormFire$.subscribe((event) => {
        expect(event.amount).toBe(150);
        done();
      });
      service.triggerTicketStormFire(150);
    });

    it('should emit multiple ticketStormFire$ events', () => {
      const amounts: number[] = [];
      service.ticketStormFire$.subscribe((e) => amounts.push(e.amount));
      service.triggerTicketStormFire(50);
      service.triggerTicketStormFire(100);
      expect(amounts).toEqual([50, 100]);
    });

    it('should not cross-contaminate passiveIncomeTick$ and ticketStormFire$', () => {
      const tickAmounts: number[] = [];
      const stormAmounts: number[] = [];
      service.passiveIncomeTick$.subscribe((e) => tickAmounts.push(e.amount));
      service.ticketStormFire$.subscribe((e) => stormAmounts.push(e.amount));
      service.triggerPassiveIncomeTick(5);
      service.triggerTicketStormFire(100);
      expect(tickAmounts).toEqual([5]);
      expect(stormAmounts).toEqual([100]);
    });
  });

  describe('edge cases', () => {
    it('should handle null seat gracefully', (done) => {
      service.autoClick$.subscribe((event) => {
        expect(event.seat).toBeNull();
        done();
      });

      service.triggerAutoClick(null as unknown as Seat);
    });

    it('should handle undefined values in events', (done) => {
      service.usherClick$.subscribe((event) => {
        expect(event).toBeDefined();
        done();
      });

      service.triggerUsherClick(undefined as unknown as Seat, 0, 0);
    });

    it('should handle rapid event triggering', () => {
      const events: unknown[] = [];

      service.autoClick$.subscribe((event) => events.push(event));

      for (let i = 0; i < 1000; i++) {
        service.triggerAutoClick({ seatIndex: i } as Seat);
      }

      expect(events.length).toBe(1000);
    });
  });
});
