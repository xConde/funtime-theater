import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConcessionCacheService } from '../../services/concession-cache.service';
import { PowerUpEventsService } from '../../services/power-up-events.service';
import { TheaterService } from '../../theater.service';
import { STAFF_ANIMATION } from '../../theater.constants';

type UsherState = 'idle' | 'dashing' | 'catching' | 'returning';

@Component({
  selector: 'app-staff-layer',
  templateUrl: './staff-layer.component.html',
  styleUrls: ['./staff-layer.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'pointer-events: none' },
})
export class StaffLayerComponent implements OnInit, OnDestroy {
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly concessionCache = inject(ConcessionCacheService);
  private readonly powerUpEvents = inject(PowerUpEventsService);
  private readonly theaterService = inject(TheaterService);

  // --- Owned-count signals (snapshot read on init, not reactive).
  //     Valid because the component is recreated whenever the lobby (purchase UI) closes. ---
  readonly usherOwned = signal(0);
  readonly passiveIncomeOwned = signal(0);
  readonly magneticFieldOwned = signal(0);
  readonly ticketStormOwned = signal(0);
  readonly ticketMultiplierOwned = signal(0);
  readonly seatUpgradeOwned = signal(0);

  readonly showUsher = computed(() => this.usherOwned() >= 1);
  readonly showBoxOffice = computed(() => this.passiveIncomeOwned() >= 1);
  readonly showSpotlight = computed(() => this.magneticFieldOwned() >= 1);
  readonly showConfettiCannons = computed(() => this.ticketStormOwned() >= 1);
  readonly showPopcornCart = computed(() => this.ticketMultiplierOwned() >= 1);

  /** CSS custom property value for popcorn cart glow, clamped 1-5. */
  readonly cartGlowLevel = computed(() => Math.min(this.ticketMultiplierOwned(), 5));

  // --- Usher state machine ---
  usherState = signal<UsherState>('idle');
  /** Row fraction (0-1) for usher vertical dash position, relative to seating area height. */
  usherDashFraction = signal(0);
  /** Which side the usher flashes the light toward. */
  usherFlashSide = signal<'left' | 'right'>('left');
  usherFlashVisible = signal(false);

  // --- Box office state ---
  boxOfficeGlow = signal(false);

  // --- Spotlight state ---
  /** CSS rotate angle (deg) for spotlight cone pointing toward a seat. */
  spotlightAngle = signal(0);

  // --- Confetti state ---
  confettiFiring = signal(false);

  private usherTimers: ReturnType<typeof setTimeout>[] = [];

  ngOnInit(): void {
    this.refreshOwnedCounts();

    this.powerUpEvents.usherClick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (!this.showUsher()) return;
      this.runUsherAnimation(event.seat.rowIndex, event.seat.side);
    });

    this.powerUpEvents.passiveIncomeTick$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.showBoxOffice()) return;
      this.triggerBoxOfficeGlow();
    });

    this.powerUpEvents.magneticFieldUpdate$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (!this.showSpotlight()) return;
      this.updateSpotlightAngle(event.seat.rowIndex, event.seat.side);
    });

    this.powerUpEvents.ticketStormFire$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (!this.showConfettiCannons()) return;
      this.triggerConfetti();
    });
  }

  ngOnDestroy(): void {
    this.clearUsherTimers();
    if (this.boxOfficeTimer !== null) {
      clearTimeout(this.boxOfficeTimer);
      this.boxOfficeTimer = null;
    }
    if (this.confettiTimer !== null) {
      clearTimeout(this.confettiTimer);
      this.confettiTimer = null;
    }
  }

  private refreshOwnedCounts(): void {
    this.usherOwned.set(this.concessionCache.getOwned('autoClicker'));
    this.passiveIncomeOwned.set(this.concessionCache.getOwned('passiveIncome'));
    this.magneticFieldOwned.set(this.concessionCache.getOwned('magneticField'));
    this.ticketStormOwned.set(this.concessionCache.getOwned('ticketStorm'));
    this.ticketMultiplierOwned.set(this.concessionCache.getOwned('ticketMultiplier'));
    this.seatUpgradeOwned.set(this.concessionCache.getOwned('seatUpgrade'));
  }

  // ---------------------------------------------------------------------------
  // Usher state machine
  // ---------------------------------------------------------------------------

  private runUsherAnimation(rowIndex: number, side: 'left' | 'right'): void {
    // Cancel any in-flight animation
    this.clearUsherTimers();

    const totalRows = this.theaterService.seatsData().length || 8;
    // row 1 = top of seating; higher row = lower in the seating area.
    // Fraction 0 = top, 1 = bottom. Map rowIndex so row 1 = near top (~10%).
    const fraction = (rowIndex - 1) / Math.max(totalRows - 1, 1);
    // Invert: usher starts at the bottom (entry) and dashes up toward lower row index.
    // We represent position as distance from bottom: high row index = small fraction from bottom.
    // The template positions the usher from bottom via translateY, so we pass the row fraction directly.
    this.usherDashFraction.set(fraction);
    this.usherFlashSide.set(side);
    this.usherState.set('dashing');
    this.cdr.markForCheck();

    this.scheduleUsher(STAFF_ANIMATION.USHER_DASH_MS, () => {
      this.usherState.set('catching');
      this.usherFlashVisible.set(true);
      this.cdr.markForCheck();
    });

    this.scheduleUsher(STAFF_ANIMATION.USHER_DASH_MS + STAFF_ANIMATION.USHER_CATCH_MS, () => {
      this.usherFlashVisible.set(false);
      this.usherState.set('returning');
      this.usherDashFraction.set(0);
      this.cdr.markForCheck();
    });

    this.scheduleUsher(
      STAFF_ANIMATION.USHER_DASH_MS + STAFF_ANIMATION.USHER_CATCH_MS + STAFF_ANIMATION.USHER_RETURN_MS,
      () => {
        this.usherState.set('idle');
        // Clear the timer handles now that the full animation sequence has
        // completed — prevents stale references from lingering in the array.
        this.usherTimers = [];
        this.cdr.markForCheck();
      }
    );
  }

  private scheduleUsher(ms: number, fn: () => void): void {
    this.usherTimers.push(setTimeout(fn, ms));
  }

  private clearUsherTimers(): void {
    for (const t of this.usherTimers) {
      clearTimeout(t);
    }
    this.usherTimers = [];
  }

  // ---------------------------------------------------------------------------
  // Box office glow
  // ---------------------------------------------------------------------------

  private boxOfficeTimer: ReturnType<typeof setTimeout> | null = null;

  private triggerBoxOfficeGlow(): void {
    if (this.boxOfficeTimer) {
      clearTimeout(this.boxOfficeTimer);
    }
    this.boxOfficeGlow.set(true);
    this.cdr.markForCheck();
    this.boxOfficeTimer = setTimeout(() => {
      this.boxOfficeGlow.set(false);
      this.boxOfficeTimer = null;
      this.cdr.markForCheck();
    }, STAFF_ANIMATION.BOX_OFFICE_GLOW_MS);
  }

  // ---------------------------------------------------------------------------
  // Spotlight
  // ---------------------------------------------------------------------------

  private updateSpotlightAngle(rowIndex: number, side: 'left' | 'right'): void {
    const totalRows = this.theaterService.seatsData().length || 8;
    // Row fraction: 0 = top of audience, 1 = bottom.
    const rowFraction = (rowIndex - 1) / Math.max(totalRows - 1, 1);
    // Side offset: right = positive angle (tilts beam toward stage-right), left = negative.
    const sideOffset = side === 'right' ? 1 : -1;
    // The spotlight-beam hangs from the top of the overlay (transform-origin: top center)
    // and points downward into the audience. rotate(0deg) = straight down; positive rotate
    // tilts right. Max tilt is ~30deg at outermost seat + lowest row.
    const angle = sideOffset * (15 + rowFraction * 15);
    this.spotlightAngle.set(angle);
    this.cdr.markForCheck();
  }

  // ---------------------------------------------------------------------------
  // Confetti
  // ---------------------------------------------------------------------------

  private confettiTimer: ReturnType<typeof setTimeout> | null = null;

  private triggerConfetti(): void {
    if (this.confettiFiring()) return;
    this.confettiFiring.set(true);
    this.cdr.markForCheck();
    if (this.confettiTimer) {
      clearTimeout(this.confettiTimer);
    }
    this.confettiTimer = setTimeout(() => {
      this.confettiFiring.set(false);
      this.confettiTimer = null;
      this.cdr.markForCheck();
    }, STAFF_ANIMATION.CONFETTI_MS);
  }

  /** Confetti particle indices for @for track. Pre-allocated, not created per fire. */
  readonly confettiParticles = [0, 1, 2, 3, 4, 5];
}
