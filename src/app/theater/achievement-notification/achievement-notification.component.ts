import { ChangeDetectionStrategy, Component, effect, HostListener, inject } from '@angular/core';
import { Achievement, AchievementsService } from '../achievements.service';
import { animate, style, transition, trigger } from '@angular/animations';
import { TheaterIconService } from '../services/theater-icon.service';

@Component({
  selector: 'app-achievement-notification',
  templateUrl: './achievement-notification.component.html',
  styleUrls: ['./achievement-notification.component.scss'],
  animations: [
    trigger('slideIn', [
      transition(':enter', [
        style({ transform: 'translateX(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateX(0)', opacity: 1 })),
      ]),
      transition(':leave', [animate('300ms ease-in', style({ transform: 'translateX(100%)', opacity: 0 }))]),
    ]),
  ],
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AchievementNotificationComponent {
  private achievementsService = inject(AchievementsService);
  protected iconService = inject(TheaterIconService);

  achievement: Achievement | null = null;

  constructor() {
    effect(() => {
      this.achievement = this.achievementsService.achievementUnlocked();
    });
  }

  dismissAchievement(): void {
    this.achievement = null;
  }

  /**
   * Keyboard escape hatch for screen-reader / keyboard users.
   *
   * Binding shape matches `LobbyComponent.onEscape` for consistency.
   * Angular's prod build types `$event` as `Event` (stricter than
   * `tsc --noEmit`), so narrow with `instanceof KeyboardEvent` here
   * — `KeyboardEvent` directly fails build:prod with TS2345.
   */
  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.achievement) return;
    if (!(event instanceof KeyboardEvent)) return;
    event.preventDefault();
    this.dismissAchievement();
  }
}
