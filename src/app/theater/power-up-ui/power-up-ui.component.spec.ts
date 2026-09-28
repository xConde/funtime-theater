import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';

import { PowerUpUiComponent } from './power-up-ui.component';
import { GameService } from '../game.service';
import { StorageService } from '../services/storage.service';
import { SavedGameData } from '../theater.model';

class MockGameService {
  private activePowerUps: Map<string, number> = new Map();

  getActivePowerUps(): Map<string, number> {
    return this.activePowerUps;
  }

  setActivePowerUps(map: Map<string, number>): void {
    this.activePowerUps = map;
  }

  activatePowerUp(_id: string): void {}
}

class MockStorageService {
  private data: Partial<SavedGameData> = {};

  setData(data: Partial<SavedGameData>): void {
    this.data = data;
  }

  loadGameData(): SavedGameData {
    return this.data as SavedGameData;
  }
}

describe('PowerUpUiComponent', () => {
  let component: PowerUpUiComponent;
  let fixture: ComponentFixture<PowerUpUiComponent>;
  let gameSvc: MockGameService;
  let storageSvc: MockStorageService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PowerUpUiComponent],
      providers: [
        { provide: GameService, useClass: MockGameService },
        { provide: StorageService, useClass: MockStorageService },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(PowerUpUiComponent);
    component = fixture.componentInstance;
    gameSvc = TestBed.inject(GameService) as unknown as MockGameService;
    storageSvc = TestBed.inject(StorageService) as unknown as MockStorageService;
  });

  afterEach(() => {
    // Ensure interval is always cleared to prevent test leakage
    component.ngOnDestroy();
  });

  // ── Component creation ───────────────────────────────────────

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  // ── loadPowerUps ─────────────────────────────────────────────

  describe('loadPowerUps', () => {
    it('should load doublePoints from StorageService when available', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 3 }],
      });

      fixture.detectChanges();

      expect(component.powerUps.length).toBe(1);
      expect(component.powerUps[0].id).toBe('doublePoints');
      expect(component.powerUps[0].count).toBe(3);
      expect(component.powerUps[0].isPermanent).toBeFalse();
    });

    it('should handle empty storage data gracefully', () => {
      storageSvc.setData({});

      fixture.detectChanges();

      expect(component.powerUps.length).toBe(0);
    });

    it('should handle storage with no powerUps array gracefully', () => {
      storageSvc.setData({ coins: 100 });

      fixture.detectChanges();

      expect(component.powerUps.length).toBe(0);
    });

    it('should NOT load doublePoints when owned count is 0', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 0 }],
      });

      fixture.detectChanges();

      expect(component.powerUps.length).toBe(0);
    });

    it('should NOT load permanent power-ups (only temporary ones like doublePoints)', () => {
      storageSvc.setData({
        powerUps: [
          { id: 'ticketMultiplier', owned: 2 },
          { id: 'passiveIncome', owned: 3 },
          { id: 'autoClicker', owned: 1 },
        ],
      });

      fixture.detectChanges();

      expect(component.powerUps.length).toBe(0);
    });
  });

  // ── updateActivePowerUps ─────────────────────────────────────
  // Tests call the private method directly to avoid fakeAsync + window.setInterval
  // timing fragility. The interval mechanism is tested via ngOnDestroy cleanup.

  describe('updateActivePowerUps', () => {
    it('should mark power-ups as active with remaining count from gameService', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 2 }],
      });

      fixture.detectChanges();

      gameSvc.setActivePowerUps(new Map([['doublePoints', 5]]));
      component['updateActivePowerUps']();

      expect(component.powerUps[0].active).toBeTrue();
      expect(component.powerUps[0].remaining).toBe(5);
    });

    it('should mark power-ups as inactive when not in active map', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 2 }],
      });

      fixture.detectChanges();

      // First make it active
      gameSvc.setActivePowerUps(new Map([['doublePoints', 3]]));
      component['updateActivePowerUps']();
      expect(component.powerUps[0].active).toBeTrue();

      // Then remove from active map
      gameSvc.setActivePowerUps(new Map());
      component['updateActivePowerUps']();
      expect(component.powerUps[0].active).toBeFalse();
      expect(component.powerUps[0].remaining).toBeUndefined();
    });
  });

  // ── usePowerUp ───────────────────────────────────────────────

  describe('usePowerUp', () => {
    it('should call gameService.activatePowerUp and decrement local count', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 2 }],
      });
      const activateSpy = spyOn(gameSvc, 'activatePowerUp');

      fixture.detectChanges();
      expect(component.powerUps[0].count).toBe(2);

      component.usePowerUp('doublePoints');

      expect(activateSpy).toHaveBeenCalledWith('doublePoints');
      expect(component.powerUps[0].count).toBe(1);
    });

    it('should NOT write to storage (service handles persistence)', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 2 }],
      });
      const setItemSpy = spyOn(Storage.prototype, 'setItem');

      fixture.detectChanges();
      component.usePowerUp('doublePoints');

      expect(setItemSpy).not.toHaveBeenCalled();
    });

    it('should NOT activate power-up if count is 0', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 1 }],
      });
      const activateSpy = spyOn(gameSvc, 'activatePowerUp');

      fixture.detectChanges();
      // Deplete the count
      component.powerUps[0].count = 0;

      component.usePowerUp('doublePoints');

      expect(activateSpy).not.toHaveBeenCalled();
    });

    it('should NOT activate power-up if already active', () => {
      storageSvc.setData({
        powerUps: [{ id: 'doublePoints', owned: 2 }],
      });
      const activateSpy = spyOn(gameSvc, 'activatePowerUp');

      fixture.detectChanges();
      // Mark as already active
      component.powerUps[0].active = true;

      component.usePowerUp('doublePoints');

      expect(activateSpy).not.toHaveBeenCalled();
      expect(component.powerUps[0].count).toBe(2); // unchanged
    });
  });

  // ── ngOnDestroy ──────────────────────────────────────────────

  describe('ngOnDestroy', () => {
    it('should clear the update interval', () => {
      // NOT fakeAsync: spying on window.clearInterval inside a fakeAsync zone
      // captures zone's fake-patched timer, and Jasmine then restores that
      // disposed fake onto window after the zone exits — leaking a broken
      // clearInterval that null-derefs in later, unrelated suites. The interval
      // started by ngOnInit is a real Zone timer; ngOnDestroy clears it
      // synchronously, so no fake clock is needed to assert the cleanup.
      const clearIntervalSpy = spyOn(window, 'clearInterval').and.callThrough();

      fixture.detectChanges(); // triggers ngOnInit → setInterval

      component.ngOnDestroy();

      expect(clearIntervalSpy).toHaveBeenCalled();
    });
  });
});
