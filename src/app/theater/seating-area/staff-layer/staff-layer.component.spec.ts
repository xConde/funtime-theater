import { fakeAsync, flush, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal } from '@angular/core';
import { StaffLayerComponent } from './staff-layer.component';
import { ConcessionCacheService } from '../../services/concession-cache.service';
import { PowerUpEventsService } from '../../services/power-up-events.service';
import { SeatRow, TheaterService } from '../../theater.service';
import { StorageService } from '../../services/storage.service';

describe('StaffLayerComponent', () => {
  let powerUpEvents: PowerUpEventsService;
  let concessionCacheSpy: jasmine.SpyObj<ConcessionCacheService>;

  const makeSeatsData = (rows = 8): SeatRow[] =>
    Array.from({ length: rows }, (_, i) => ({
      rowIndex: i + 1,
      seatsPerRow: 6,
      leftSeats: [],
      rightSeats: [],
    }));

  const makeTheaterStub = (): Partial<TheaterService> => ({ seatsData: signal(makeSeatsData()) });

  const makeStorageStub = (): jasmine.SpyObj<StorageService> => {
    const s = jasmine.createSpyObj<StorageService>('StorageService', ['loadGameData']);
    s.loadGameData.and.returnValue({
      coins: 0,
      name: 'Player',
      totalGamesPlayed: 0,
      totalXP: 0,
      gameModes: [],
      powerUps: [],
    });
    return s;
  };

  const configure = (ownedFn: (id: string) => number = (): number => 0): void => {
    concessionCacheSpy = jasmine.createSpyObj('ConcessionCacheService', ['getOwned']);
    concessionCacheSpy.getOwned.and.callFake(ownedFn);

    TestBed.configureTestingModule({
      imports: [StaffLayerComponent],
      providers: [
        PowerUpEventsService,
        { provide: ConcessionCacheService, useValue: concessionCacheSpy },
        { provide: TheaterService, useValue: makeTheaterStub() },
        { provide: StorageService, useValue: makeStorageStub() },
      ],
    });

    powerUpEvents = TestBed.inject(PowerUpEventsService);
  };

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ---- pointer-events: none on host ------------------------------------------

  it('should have pointer-events: none on the host element', () => {
    configure();
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    const hostEl: HTMLElement = fixture.nativeElement;
    expect(hostEl.style.pointerEvents).toBe('none');
  });

  // ---- visibility driven by owned counts ------------------------------------

  it('should not show usher when autoClicker owned = 0', () => {
    configure(() => 0);
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.usher'))).toBeNull();
  });

  it('should show usher when autoClicker owned >= 1', () => {
    configure((id) => (id === 'autoClicker' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.usher'))).not.toBeNull();
  });

  it('should not show box office when passiveIncome owned = 0', () => {
    configure(() => 0);
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.box-office'))).toBeNull();
  });

  it('should show box office when passiveIncome owned >= 1', () => {
    configure((id) => (id === 'passiveIncome' ? 2 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.box-office'))).not.toBeNull();
  });

  it('should show spotlight when magneticField owned >= 1', () => {
    configure((id) => (id === 'magneticField' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.spotlight-beam'))).not.toBeNull();
  });

  it('should show confetti cannons when ticketStorm owned >= 1', () => {
    configure((id) => (id === 'ticketStorm' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.cannon--left'))).not.toBeNull();
    expect(fixture.debugElement.query(By.css('.cannon--right'))).not.toBeNull();
  });

  it('should show popcorn cart when ticketMultiplier owned >= 1', () => {
    configure((id) => (id === 'ticketMultiplier' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.popcorn-cart'))).not.toBeNull();
  });

  // ---- usher state machine --------------------------------------------------

  it('should transition usher to dashing state on usherClick$ event', fakeAsync(() => {
    configure((id) => (id === 'autoClicker' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const seat = { side: 'left' as const, rowIndex: 3, seatIndex: 2, showSoda: false, showPopcorn: false };
    powerUpEvents.triggerUsherClick(seat, 10, 1.0);
    fixture.detectChanges();

    expect(comp.usherState()).toBe('dashing');
    tick(1400); // let all timers complete
    fixture.detectChanges();
    expect(comp.usherState()).toBe('idle');
  }));

  it('should set usherFlashSide from the event seat side', fakeAsync(() => {
    configure((id) => (id === 'autoClicker' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const seat = { side: 'right' as const, rowIndex: 2, seatIndex: 1, showSoda: false, showPopcorn: false };
    powerUpEvents.triggerUsherClick(seat, 5, 1.0);
    fixture.detectChanges();

    expect(comp.usherFlashSide()).toBe('right');
    tick(1400);
  }));

  it('should transition: idle -> dashing -> catching -> returning -> idle', fakeAsync(() => {
    configure((id) => (id === 'autoClicker' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const seat = { side: 'left' as const, rowIndex: 4, seatIndex: 1, showSoda: false, showPopcorn: false };
    powerUpEvents.triggerUsherClick(seat, 10, 1.0);
    fixture.detectChanges();
    expect(comp.usherState()).toBe('dashing');

    tick(350);
    fixture.detectChanges();
    expect(comp.usherState()).toBe('catching');

    tick(600);
    fixture.detectChanges();
    expect(comp.usherState()).toBe('returning');

    tick(350);
    fixture.detectChanges();
    expect(comp.usherState()).toBe('idle');
  }));

  // ---- passiveIncomeTick$ pulse class ----------------------------------------

  it('should set boxOfficeGlow to true on passiveIncomeTick$ and false after ~400ms', fakeAsync(() => {
    configure((id) => (id === 'passiveIncome' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    powerUpEvents.triggerPassiveIncomeTick(5);
    fixture.detectChanges();
    expect(comp.boxOfficeGlow()).toBeTrue();

    tick(400);
    fixture.detectChanges();
    expect(comp.boxOfficeGlow()).toBeFalse();
  }));

  // ---- confetti particles pre-allocated -------------------------------------

  it('should have a stable particle count of 6 across multiple fires', fakeAsync(() => {
    configure((id) => (id === 'ticketStorm' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const count1 = comp.confettiParticles.length;
    expect(count1).toBe(6);

    powerUpEvents.triggerTicketStormFire(100);
    fixture.detectChanges();
    expect(comp.confettiParticles.length).toBe(6);

    tick(700);
    fixture.detectChanges();
    expect(comp.confettiParticles.length).toBe(6);

    // Fire again
    powerUpEvents.triggerTicketStormFire(100);
    fixture.detectChanges();
    expect(comp.confettiParticles.length).toBe(6);

    tick(700);
  }));

  it('should set confettiFiring to true on ticketStormFire$ and false after 700ms', fakeAsync(() => {
    configure((id) => (id === 'ticketStorm' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    powerUpEvents.triggerTicketStormFire(50);
    fixture.detectChanges();
    expect(comp.confettiFiring()).toBeTrue();

    tick(700);
    fixture.detectChanges();
    expect(comp.confettiFiring()).toBeFalse();
  }));

  // ---- Finding 3: destroy mid-dash does not throw / no state change after destroy ----

  it('should not throw and emit no state change after destroy mid-dash', fakeAsync(() => {
    configure((id) => (id === 'autoClicker' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const seat = { side: 'left' as const, rowIndex: 3, seatIndex: 2, showSoda: false, showPopcorn: false };
    powerUpEvents.triggerUsherClick(seat, 10, 1.0);
    fixture.detectChanges();
    expect(comp.usherState()).toBe('dashing');

    // Tick partway through the dash
    tick(100);

    // Destroy the fixture mid-animation — must not throw.
    expect(() => {
      fixture.destroy();
    }).not.toThrow();

    // Flush remaining timers — no error should occur and state must not change.
    const stateAfterDestroy = comp.usherState();
    expect(() => flush()).not.toThrow();
    // State remains as-is (timers were cancelled by ngOnDestroy).
    expect(comp.usherState()).toBe(stateAfterDestroy);
  }));

  // ---- Finding 4 (honesty): recreating the component picks up new owned counts ----

  it('should pick up new owned counts when the component is recreated', () => {
    // First fixture: no usher owned
    configure(() => 0);
    const fixture1 = TestBed.createComponent(StaffLayerComponent);
    fixture1.detectChanges();
    expect(fixture1.componentInstance.showUsher()).toBeFalse();

    // Change the mock to return 1 for autoClicker and recreate.
    concessionCacheSpy.getOwned.and.callFake((id: string) => (id === 'autoClicker' ? 1 : 0));
    const fixture2 = TestBed.createComponent(StaffLayerComponent);
    fixture2.detectChanges();
    expect(fixture2.componentInstance.showUsher()).toBeTrue();
  });

  // ---- Finding 10 (L4): usher interrupt — second click restarts the state machine ----

  it('should restart the usher animation when a second usherClick fires mid-dash', fakeAsync(() => {
    configure((id) => (id === 'autoClicker' ? 1 : 0));
    const fixture = TestBed.createComponent(StaffLayerComponent);
    const comp = fixture.componentInstance;
    fixture.detectChanges();

    const seat1 = { side: 'left' as const, rowIndex: 2, seatIndex: 1, showSoda: false, showPopcorn: false };
    const seat2 = { side: 'right' as const, rowIndex: 5, seatIndex: 3, showSoda: false, showPopcorn: false };

    // First click — start dashing toward row 2.
    powerUpEvents.triggerUsherClick(seat1, 10, 1.0);
    fixture.detectChanges();
    expect(comp.usherState()).toBe('dashing');

    // Tick 100ms into the dash, then fire a second click for a different row.
    tick(100);
    powerUpEvents.triggerUsherClick(seat2, 10, 1.0);
    fixture.detectChanges();

    // The state machine should have restarted: still dashing toward the new target.
    expect(comp.usherState()).toBe('dashing');
    expect(comp.usherFlashSide()).toBe('right');

    // Let the full animation complete — no stray timers.
    tick(1400);
    fixture.detectChanges();
    expect(comp.usherState()).toBe('idle');

    // Flush verifies no pending timers remain.
    flush();
  }));
});
