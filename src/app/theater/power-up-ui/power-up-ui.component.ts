import { ChangeDetectionStrategy, ChangeDetectorRef, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { GameService } from '../game.service';
import { PowerUpId } from '../theater.model';
import { StorageService } from '../services/storage.service';

interface PowerUpDisplay {
  id: PowerUpId;
  name: string;
  icon: string;
  count: number;
  active: boolean;
  remaining?: number;
  isPermanent?: boolean;
  effectText?: string;
}

@Component({
  selector: 'app-power-up-ui',
  templateUrl: './power-up-ui.component.html',
  styleUrls: ['./power-up-ui.component.scss'],
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PowerUpUiComponent implements OnInit, OnDestroy {
  private gameService = inject(GameService);
  private storageService = inject(StorageService);
  private cdr = inject(ChangeDetectorRef);

  powerUps: PowerUpDisplay[] = [];
  private updateInterval: number | undefined;

  ngOnInit(): void {
    this.loadPowerUps();

    // Update active power-ups display
    this.updateInterval = window.setInterval(() => {
      this.updateActivePowerUps();
    }, 100);
  }

  ngOnDestroy(): void {
    if (this.updateInterval) {
      window.clearInterval(this.updateInterval);
    }
  }

  private loadPowerUps(): void {
    const data = this.storageService.loadGameData();
    if (data.powerUps) {
      this.powerUps = [];

      // Only load temporary power-ups in the bottom UI
      // Permanent concessions are now shown on the TV screen
      const doublePointsOwned = data.powerUps.find((p) => p.id === 'doublePoints')?.owned || 0;
      if (doublePointsOwned > 0) {
        this.powerUps.push({
          id: 'doublePoints',
          name: 'Double Points',
          icon: 'fa-times-circle',
          count: doublePointsOwned,
          active: false,
          isPermanent: false,
        });
      }
    }
  }

  private updateActivePowerUps(): void {
    const activePowerUps = this.gameService.getActivePowerUps();

    this.powerUps.forEach((powerUp) => {
      const remaining = activePowerUps.get(powerUp.id);
      powerUp.active = remaining !== undefined;
      powerUp.remaining = remaining;
    });
    // Explicit markForCheck for OnPush — today this works under zone because
    // setInterval is patched, but a zoneless migration would silently stop
    // updating the active timer countdown without this call.
    this.cdr.markForCheck();
  }

  usePowerUp(powerUpId: PowerUpId): void {
    const powerUp = this.powerUps.find((p) => p.id === powerUpId);
    if (powerUp && powerUp.count > 0 && !powerUp.active) {
      this.gameService.activatePowerUp(powerUpId);
      // PowerUpLifecycleService.usePowerUp() already decrements storage count,
      // so we only update the local display count here — no double-write.
      powerUp.count--;
      this.cdr.markForCheck();
    }
  }

  /**
   * Keyboard activation parity. Permanent concessions are non-interactive
   * (role="img"); temporary power-ups respect the same disabled rules as
   * the click branch.
   */
  onPowerUpKeydown(event: Event, powerUp: PowerUpDisplay): void {
    if (powerUp.isPermanent) return;
    event.preventDefault();
    this.usePowerUp(powerUp.id);
  }
}
