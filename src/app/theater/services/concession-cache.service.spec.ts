import { TestBed } from '@angular/core/testing';
import { ConcessionCacheService } from './concession-cache.service';
import { StorageService } from './storage.service';
import { SavedGameData } from '../theater.model';

const makeGameData = (powerUps: { id: string; owned: number }[]): SavedGameData => ({
  coins: 0,
  name: 'Player 1',
  totalGamesPlayed: 0,
  totalXP: 0,
  gameModes: [],
  powerUps,
});

describe('ConcessionCacheService', () => {
  let service: ConcessionCacheService;
  let storageSpy: jasmine.SpyObj<StorageService>;

  beforeEach(() => {
    storageSpy = jasmine.createSpyObj<StorageService>('StorageService', ['loadGameData']);
    storageSpy.loadGameData.and.returnValue(
      makeGameData([
        { id: 'ticketMultiplier', owned: 3 },
        { id: 'passiveIncome', owned: 1 },
      ])
    );

    TestBed.configureTestingModule({
      providers: [ConcessionCacheService, { provide: StorageService, useValue: storageSpy }],
    });

    service = TestBed.inject(ConcessionCacheService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getOwned', () => {
    it('should return correct count for known concession IDs after construction', () => {
      expect(service.getOwned('ticketMultiplier')).toBe(3);
      expect(service.getOwned('passiveIncome')).toBe(1);
    });

    it('should return 0 for unknown concession IDs', () => {
      expect(service.getOwned('nonExistentConcession')).toBe(0);
      expect(service.getOwned('')).toBe(0);
    });

    it('should not call loadGameData on subsequent reads when cache is valid', () => {
      // Construction triggers one loadGameData call
      const callsAfterConstruction = storageSpy.loadGameData.calls.count();

      service.getOwned('ticketMultiplier');
      service.getOwned('ticketMultiplier');
      service.getOwned('passiveIncome');

      expect(storageSpy.loadGameData.calls.count()).toBe(callsAfterConstruction);
    });
  });

  describe('getCount', () => {
    it('should behave identically to getOwned', () => {
      expect(service.getCount('ticketMultiplier')).toBe(service.getOwned('ticketMultiplier'));
      expect(service.getCount('passiveIncome')).toBe(service.getOwned('passiveIncome'));
      expect(service.getCount('unknown')).toBe(service.getOwned('unknown'));
    });
  });

  describe('refresh', () => {
    it('should update cache with new values from storage', () => {
      storageSpy.loadGameData.and.returnValue(
        makeGameData([
          { id: 'ticketMultiplier', owned: 7 },
          { id: 'autoClicker', owned: 2 },
        ])
      );

      service.refresh();

      expect(service.getOwned('ticketMultiplier')).toBe(7);
      expect(service.getOwned('autoClicker')).toBe(2);
      // Old entry no longer present after refresh
      expect(service.getOwned('passiveIncome')).toBe(0);
    });

    it('should handle empty powerUps array', () => {
      storageSpy.loadGameData.and.returnValue(makeGameData([]));
      service.refresh();
      expect(service.getOwned('ticketMultiplier')).toBe(0);
    });
  });

  describe('invalidate', () => {
    it('should clear the cache so next getOwned triggers a refresh', () => {
      // Update what storage will return after invalidation
      storageSpy.loadGameData.and.returnValue(makeGameData([{ id: 'ticketMultiplier', owned: 99 }]));

      service.invalidate();
      const callsBefore = storageSpy.loadGameData.calls.count();

      const result = service.getOwned('ticketMultiplier');

      expect(storageSpy.loadGameData.calls.count()).toBe(callsBefore + 1);
      expect(result).toBe(99);
    });

    it('should not trigger additional storage reads after the first refresh post-invalidation', () => {
      storageSpy.loadGameData.and.returnValue(makeGameData([{ id: 'ticketMultiplier', owned: 5 }]));

      service.invalidate();
      service.getOwned('ticketMultiplier'); // triggers refresh
      const callsAfterFirstRead = storageSpy.loadGameData.calls.count();

      service.getOwned('ticketMultiplier');
      service.getOwned('passiveIncome');

      expect(storageSpy.loadGameData.calls.count()).toBe(callsAfterFirstRead);
    });
  });
});
