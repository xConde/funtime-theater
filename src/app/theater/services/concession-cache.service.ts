import { Injectable } from '@angular/core';
import { StorageService } from './storage.service';

/**
 * In-memory cache for concession (power-up) ownership counts.
 * Eliminates localStorage reads from the gameplay hot path.
 *
 * Call refresh() at game start / resume / after purchases.
 * Call getOwned() / getCount() freely during gameplay — Map lookups only.
 */
@Injectable({
  providedIn: 'root',
})
export class ConcessionCacheService {
  private cache: Map<string, number> = new Map();
  private valid = false;

  constructor(private storageService: StorageService) {
    this.refresh();
  }

  /**
   * Returns the owned count for a concession ID.
   * Falls back to 0 for unknown IDs.
   * If the cache has been invalidated, refreshes first.
   */
  getOwned(id: string): number {
    if (!this.valid) {
      this.refresh();
    }
    return this.cache.get(id) ?? 0;
  }

  /**
   * Alias for getOwned — replaces getPowerUpCount usage.
   */
  getCount(id: string): number {
    return this.getOwned(id);
  }

  /**
   * Reloads all concession counts from localStorage.
   * Call at game start, resume, and after purchases.
   */
  refresh(): void {
    this.cache.clear();
    const data = this.storageService.loadGameData();
    for (const powerUp of data.powerUps ?? []) {
      this.cache.set(powerUp.id, powerUp.owned);
    }
    this.valid = true;
  }

  /**
   * Marks the cache as stale.
   * The next getOwned() call will trigger a refresh.
   */
  invalidate(): void {
    this.valid = false;
  }
}
