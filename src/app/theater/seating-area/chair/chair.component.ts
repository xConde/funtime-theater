import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  EventEmitter,
  inject,
  Input,
  OnDestroy,
  OnInit,
  Output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Seat } from '../../theater.service';
import { PowerUpEventsService } from '../../services/power-up-events.service';
import { SoundService } from '../../sound.service';
import { SEAT_SOUND_INTENSITY, type SeatSoundIntensity } from '../../theater.constants';
import { ThemeService } from '@services/theme.service';

export type SeatNavigationDirection = 'left' | 'right' | 'up' | 'down' | 'home' | 'end';
export type SeatInteractionMethod = 'pointer' | 'keyboard';

export interface SeatActivity {
  eventType: string;
  seat: Seat | null;
  interaction: SeatInteractionMethod;
}

@Component({
  selector: 'app-chair',
  templateUrl: './chair.component.html',
  styleUrls: ['./chair.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [],
})
export class ChairComponent implements OnInit, OnDestroy {
  @Input() seat!: Seat;
  @Input() leftSeatsLength?: number;
  @Input() isActive: boolean = false;
  @Input() isTabStop = false;
  @Input() totalRows: number = 8; // Grid dimensions from parent
  @Input() seatsPerRow: number = 8;
  @Output() activity = new EventEmitter<SeatActivity>();
  @Output() seatFocused = new EventEmitter<Seat>();
  @Output() navigate = new EventEmitter<{ seat: Seat; direction: SeatNavigationDirection }>();

  isClicked = false;
  isAutoClicked = false;
  isMagneticRange = false;
  isDayMode = false;

  private readonly destroyRef = inject(DestroyRef);
  private clickAnimationTimer: ReturnType<typeof setTimeout> | null = null;
  private autoClickAnimationTimer: ReturnType<typeof setTimeout> | null = null;

  // Constants for better code readability
  private readonly CLICK_ANIMATION_DURATION = 500;

  get side(): 'left' | 'right' {
    return this.seat.side;
  }

  get seatIndex(): number {
    return this.seat.seatIndex;
  }

  get rowIndex(): number {
    return this.seat.rowIndex;
  }

  get showSoda(): boolean {
    return this.seat.showSoda;
  }

  get showPopcorn(): boolean {
    return this.seat.showPopcorn;
  }

  get mutatedSeat(): Seat {
    return {
      side: this.side,
      seatIndex: this.seatIndex,
      rowIndex: this.rowIndex,
      showSoda: this.showSoda,
      showPopcorn: this.showPopcorn,
    };
  }

  /** SVG paint-server IDs must be unique across the full seat grid. */
  svgId(token: string): string {
    return `theater-seat-${token}-${this.side}-${this.rowIndex}-${this.seatIndex}`;
  }

  svgUrl(token: string): string {
    return `url(#${this.svgId(token)})`;
  }

  emitEvent(eventType: 'hover' | 'select', interaction: SeatInteractionMethod = 'pointer'): void {
    // Play appropriate sound using DRY principle
    this.playSeatSound(eventType);

    // Handle select animation
    if (eventType === SEAT_SOUND_INTENSITY.SELECT) {
      this.triggerClickAnimation();
    }

    this.activity.emit({ eventType, seat: this.mutatedSeat, interaction });
  }

  emitEventLeave(): void {
    this.activity.emit({ eventType: SEAT_SOUND_INTENSITY.HOVER, seat: null, interaction: 'pointer' });
  }

  /**
   * Keyboard activation parity with click. preventDefault stops Space from
   * scrolling the page (which would normally happen on a focused div).
   */
  onActivate(event: Event): void {
    event.preventDefault();
    this.emitEvent('select', 'keyboard');
  }

  onNavigate(event: Event, direction: SeatNavigationDirection): void {
    event.preventDefault();
    event.stopPropagation();
    this.navigate.emit({ seat: this.mutatedSeat, direction });
  }

  /**
   * Play seat sound with proper grid dimensions
   * Consolidated method to avoid code duplication
   */
  private playSeatSound(intensity: SeatSoundIntensity): void {
    this.soundService.playSeatSound(this.seat, intensity, this.totalRows, this.seatsPerRow, this.isActive);
  }

  /**
   * Trigger click animation effect with proper cleanup
   */
  private triggerClickAnimation(): void {
    // Clear any pending animation timer
    if (this.clickAnimationTimer) {
      clearTimeout(this.clickAnimationTimer);
    }
    this.isClicked = true;
    this.clickAnimationTimer = setTimeout(() => {
      this.isClicked = false;
      this.clickAnimationTimer = null;
    }, this.CLICK_ANIMATION_DURATION);
  }

  constructor(
    private cdr: ChangeDetectorRef,
    private powerUpEventsService: PowerUpEventsService,
    private soundService: SoundService,
    private themeService: ThemeService
  ) {}

  ngOnInit(): void {
    // Listen for theme changes
    this.themeService.isDayMode$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((isDayMode) => {
      this.isDayMode = isDayMode;
      this.cdr.markForCheck();
    });

    // Listen for auto-click events
    this.powerUpEventsService.autoClick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (this.isSameSeat(event.seat)) {
        this.triggerAutoClickAnimation();
      }
    });

    // Listen for magnetic field events
    this.powerUpEventsService.magneticFieldUpdate$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (this.isInMagneticRange(event.seat, event.range)) {
        this.isMagneticRange = true;
      } else {
        this.isMagneticRange = false;
      }
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    // Clean up animation timers
    if (this.clickAnimationTimer) {
      clearTimeout(this.clickAnimationTimer);
    }
    if (this.autoClickAnimationTimer) {
      clearTimeout(this.autoClickAnimationTimer);
    }
  }

  private isSameSeat(seat: Seat): boolean {
    return (
      seat &&
      seat.side === this.seat.side &&
      seat.rowIndex === this.seat.rowIndex &&
      seat.seatIndex === this.seat.seatIndex
    );
  }

  private triggerAutoClickAnimation(): void {
    // Clear any pending animation timer
    if (this.autoClickAnimationTimer) {
      clearTimeout(this.autoClickAnimationTimer);
    }
    this.isAutoClicked = true;
    this.cdr.markForCheck();
    this.autoClickAnimationTimer = setTimeout(() => {
      this.isAutoClicked = false;
      this.autoClickAnimationTimer = null;
      this.cdr.markForCheck();
    }, 600);
  }

  private isInMagneticRange(centerSeat: Seat, range: number): boolean {
    if (!centerSeat || range <= 0) return false;

    const rowDiff = Math.abs(this.seat.rowIndex - centerSeat.rowIndex);
    return rowDiff <= range;
  }
}
