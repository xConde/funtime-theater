import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  NgZone,
  OnDestroy,
  OnInit,
  Output,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { GameService, GameState } from '../game.service';
import { AnimationTimeout } from '../theater.model';
import { GAME_MECHANICS, POWER_UP_FORMULAS } from '../theater.constants';
import { DisposableTimer } from '../utils/disposable-timer';
import { FilmShowtimeService } from '../film/film-showtime.service';
import { AudienceService } from '../services/audience.service';
import { TheaterIconService } from '../services/theater-icon.service';
import { LEADER_SECONDS } from '../film/film-generator';
import { paintScene, SCENE_HEIGHT, SCENE_PIXEL_RATIO, SCENE_WIDTH } from '../film/scene-painter';
import { getPowerUpIcon } from '../utils/icons';

/**
 * Compact display for compounding multipliers, which grow without bound in
 * long runs: 2.25 → "2.25", 33.49 → "33.5", 332.5 → "333", 2216.84 → "2.2k".
 */
export function formatMultiplier(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return `${Math.round(value)}`;
  if (value >= 10) return `${value.toFixed(1)}`;
  return `${value.toFixed(2)}`;
}

/**
 * Convert a 1-based positive integer to its English ordinal string.
 * Examples: 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 21 → "21st".
 */
export function ordinal(n: number): string {
  const abs = Math.abs(Math.floor(n));
  const mod100 = abs % 100;
  // 11-13 are always "th" (eleven*th*, twelve*th*, thirteen*th*).
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

interface AnimationProperties {
  scoreIncreaseAmount: number;
  multiplierIncreaseAmount: number;
  pulseAnimationClass: string;
}

@Component({
  selector: 'app-screen',
  templateUrl: './screen.component.html',
  styleUrls: ['./screen.component.scss'],
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScreenComponent implements OnInit, OnDestroy, AnimationProperties {
  @Input() gameState: GameState | null = null;
  @Input() isMuted = false;
  @Output() soundToggle = new EventEmitter<void>();
  isGameActive = false;
  isGameEnded = false;
  isLoading = true;
  isGamePaused = false;
  isGameStarting = false;
  GameState = GameState;
  currentGameModeName = '';
  activePowerUpsArray: { key: string; value: number }[] = [];
  hasPassiveIncome = false;
  passiveIncomeAmount = 0;
  ticketStormActive = false;
  private timers = new DisposableTimer();

  usherCooldown = 0;
  usherReady = true;

  public gameService = inject(GameService);
  public filmShowtime = inject(FilmShowtimeService);
  public audience = inject(AudienceService);
  public iconService = inject(TheaterIconService);
  private readonly ngZone = inject(NgZone);

  /** Bespoke icon name for a live power-up HUD chip — see utils/icons.ts. */
  readonly getPowerUpIcon = getPowerUpIcon;

  private readonly filmCanvas = viewChild<ElementRef<HTMLCanvasElement>>('filmCanvas');
  private sceneCtx: CanvasRenderingContext2D | null = null;
  private sceneRafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;
  // The scene renders at a fixed logical height; only the width breathes to
  // match the panel's aspect ratio, so the full frame (countdown leader, hero
  // moments) is always in view. Floor at the design width (480, ~3.2:1) for
  // phones, ceiling near 5.3:1 for wide monitors before cover takes over.
  private static readonly MIN_RENDER_WIDTH = SCENE_WIDTH;
  private static readonly MAX_RENDER_WIDTH = 800;
  private lastFilmSecond = -1;
  private lastFilmSecondTs = 0;
  private lastScenePaintTs = 0;
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /**
   * True when the current beat's intensity exceeds the flicker threshold (0.4).
   * Used to gate the CSS animation on .film-flicker so the animation only runs
   * during high-intensity beats — never during title-card or credits.
   */
  readonly isFlickerActive = computed(() => (this.filmShowtime.currentBeat()?.intensity ?? 0) > 0.4);

  /**
   * The DOM title typography waits in the wings while the canvas plays the
   * countdown leader, then takes the rest of the title-card beat alone.
   * Without this gate the title and the 3-2-1 play on top of each other.
   */
  readonly isTitleCardVisible = computed(() => {
    const beat = this.filmShowtime.currentBeat();
    if (beat?.kind !== 'title-card') return false;
    return this.filmShowtime.filmSecond() >= beat.startsAt + LEADER_SECONDS;
  });

  private cdr = inject(ChangeDetectorRef);
  private elRef = inject(ElementRef);

  private static readonly ANIMATION_DURATION = 600;
  private timeouts: AnimationTimeout = {};
  private readonly destroyRef = inject(DestroyRef);
  currentPulseClass: string = '';
  pulseAnimationClass: string = '';
  scoreIncreaseAmount: number = 0;
  multiplierIncreaseAmount: number = 0;

  constructor() {
    effect(() => {
      const gameState = this.gameService.gameState();
      this.isGameActive = gameState === GameState.Playing;
      this.isGamePaused = gameState === GameState.Paused;
      this.isGameEnded = gameState === GameState.Ended;
      this.isGameStarting = gameState === GameState.Starting;
    });

    effect(() => {
      this.currentGameModeName = this.gameService.currentGameModeName();
    });

    // React to active power-ups signal
    effect(() => {
      const powerUps = this.gameService.activePowerUpsSignal();
      this.activePowerUpsArray = Array.from(powerUps.entries()).map(([key, value]) => ({ key, value }));
      this.updatePowerUpEffects(powerUps);
      this.cdr.detectChanges();
    });

    effect(() => {
      this.usherCooldown = this.gameService.usherCooldown();
      this.cdr.detectChanges();
    });

    effect(() => {
      this.usherReady = this.gameService.usherReady();
      this.cdr.detectChanges();
    });

    // Sync CSS custom properties for the film layer — cheap, no per-frame JS.
    effect(() => {
      const beat = this.filmShowtime.currentBeat();
      const film = this.filmShowtime.currentFilm();
      const el = this.elRef.nativeElement as HTMLElement;
      el.style.setProperty('--film-intensity', beat ? String(beat.intensity) : '0');
      el.style.setProperty('--film-tint', film ? `${film.poster.palette[0]}1a` : 'transparent');
    });

    // Drive the projection canvas. The canvas exists only while a film is
    // loaded (it lives inside the film-layer @if), so the viewChild signal
    // doubles as the start/stop trigger. Reduced motion paints one static
    // frame per beat change instead of running the animation loop.
    effect(() => {
      const canvasRef = this.filmCanvas();
      const film = this.filmShowtime.currentFilm();
      const beat = this.filmShowtime.currentBeat();

      if (!canvasRef || !film) {
        this.stopSceneLoop();
        this.disconnectResizeObserver();
        this.sceneCtx = null;
        return;
      }
      if (!this.sceneCtx) {
        this.sceneCtx = canvasRef.nativeElement.getContext('2d');
      }
      if (!this.sceneCtx) return;

      // Match the buffer to the panel before the first paint, then keep it in
      // sync as the panel resizes. Set up once per canvas instance.
      if (!this.resizeObserver) {
        this.sizeCanvasToPanel(canvasRef.nativeElement);
        this.observeCanvasResize(canvasRef.nativeElement);
      }

      if (this.reducedMotion) {
        paintScene(this.sceneCtx, film, beat, this.filmShowtime.filmSecond(), { frontRow: false });
        return;
      }
      this.startSceneLoop();
    });
  }

  private startSceneLoop(): void {
    if (this.sceneRafId !== null) return;
    this.ngZone.runOutsideAngular(() => {
      this.sceneRafId = requestAnimationFrame(this.renderSceneFrame);
    });
  }

  private stopSceneLoop(): void {
    if (this.sceneRafId !== null) {
      cancelAnimationFrame(this.sceneRafId);
      this.sceneRafId = null;
    }
  }

  /**
   * Resize the canvas buffer so its aspect ratio matches the rendered panel,
   * holding a fixed logical height. Within the clamp range the buffer matches
   * the panel exactly, so object-fit cover is a no-op and nothing crops; on a
   * phone (panel narrower than the design 3.2:1) the width floors at 480 and
   * cover trims the side gutters as it did before. A buffer resize clears the
   * canvas, so only resize when the target actually changes.
   */
  private sizeCanvasToPanel(canvas: HTMLCanvasElement): void {
    const rect = canvas.getBoundingClientRect();
    const aspect = rect.height > 0 ? rect.width / rect.height : SCENE_WIDTH / SCENE_HEIGHT;
    const logicalWidth = Math.round(
      Math.min(ScreenComponent.MAX_RENDER_WIDTH, Math.max(ScreenComponent.MIN_RENDER_WIDTH, SCENE_HEIGHT * aspect))
    );
    const targetWidth = logicalWidth * SCENE_PIXEL_RATIO;
    const targetHeight = SCENE_HEIGHT * SCENE_PIXEL_RATIO;
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;
  }

  private observeCanvasResize(canvas: HTMLCanvasElement): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.disconnectResizeObserver();
    this.resizeObserver = new ResizeObserver(() => {
      this.ngZone.runOutsideAngular(() => {
        const before = canvas.width;
        this.sizeCanvasToPanel(canvas);
        // The animation loop repaints every frame and picks up the new size on
        // its own. Reduced motion paints once per beat, so a resize that
        // actually changed the buffer needs an explicit repaint to refill it.
        if (canvas.width !== before && this.reducedMotion && this.sceneCtx) {
          const film = this.filmShowtime.currentFilm();
          if (film)
            paintScene(this.sceneCtx, film, this.filmShowtime.currentBeat(), this.filmShowtime.filmSecond(), {
              frontRow: false,
            });
        }
      });
    });
    this.resizeObserver.observe(canvas);
  }

  private disconnectResizeObserver(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }

  /**
   * One projection frame. The showtime clock ticks at 4 Hz; for smooth
   * motion we extrapolate up to one tick past the last observed value.
   * While paused the clock stops changing, the extrapolation caps out,
   * and the scene freezes on its current frame, which is exactly what a
   * paused projector should do.
   */
  private readonly renderSceneFrame = (): void => {
    const film = this.filmShowtime.currentFilm();
    if (!film || !this.sceneCtx) {
      this.sceneRafId = null;
      return;
    }
    const filmSecond = this.filmShowtime.filmSecond();
    const now = globalThis.performance.now();
    if (filmSecond !== this.lastFilmSecond) {
      this.lastFilmSecond = filmSecond;
      this.lastFilmSecondTs = now;
    }
    // 30fps cap: identical on screen, half the paint work or better.
    if (now - this.lastScenePaintTs >= 33) {
      const smoothSecond = filmSecond + Math.min((now - this.lastFilmSecondTs) / 1000, 0.25);
      paintScene(this.sceneCtx, film, this.filmShowtime.currentBeat(), smoothSecond, { frontRow: false });
      this.lastScenePaintTs = now;
    }
    this.sceneRafId = requestAnimationFrame(this.renderSceneFrame);
  };

  /** Convert a 1-based feature number to its ordinal label (1st, 2nd, 3rd, 4th...). */
  ordinalLabel(n: number): string {
    return ordinal(n);
  }

  ngOnInit(): void {
    this.gameService.scoreIncrement$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((score) => {
      this.handleScoreIncrement(score);
    });

    this.gameService.multiplierIncrement$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((multiplier) => {
      this.handleMultiplierIncrement(multiplier);
    });
  }

  private updatePowerUpEffects(powerUps: Map<string, number>): void {
    const passiveIncome = powerUps.get('passiveIncome');
    if (passiveIncome && passiveIncome > 0) {
      this.hasPassiveIncome = true;
      this.passiveIncomeAmount = passiveIncome * POWER_UP_FORMULAS.PASSIVE_INCOME_PER_LEVEL;
      this.startPassiveIncomeAnimation();
    } else {
      this.hasPassiveIncome = false;
      this.stopPassiveIncomeAnimation();
    }

    const ticketStorm = powerUps.get('ticketStorm');
    if (ticketStorm && ticketStorm > 0) {
      this.startTicketStormEffect();
    } else {
      this.stopTicketStormEffect();
    }
  }

  private passiveIncomeRafId: number | null = null;

  private startPassiveIncomeAnimation(): void {
    this.timers.clearInterval('passiveIncome');
    // Pure DOM classList work — no Angular state touched, so run outside the
    // zone to avoid triggering app-wide change detection every second.
    this.ngZone.runOutsideAngular(() => {
      this.timers.setInterval(
        'passiveIncome',
        () => {
          const indicator = document.querySelector('.passive-income-indicator') as HTMLElement;
          if (indicator) {
            indicator.classList.remove('show');
            // Track the RAF id so destroy can cancel any in-flight frame
            // that the interval scheduled before clearInterval ran.
            this.passiveIncomeRafId = requestAnimationFrame(() => {
              this.passiveIncomeRafId = null;
              indicator.classList.add('show');
            });
          }
        },
        1000
      );
    });
  }

  private stopPassiveIncomeAnimation(): void {
    this.timers.clearInterval('passiveIncome');
    if (this.passiveIncomeRafId !== null) {
      cancelAnimationFrame(this.passiveIncomeRafId);
      this.passiveIncomeRafId = null;
    }
  }

  private startTicketStormEffect(): void {
    this.timers.clearInterval('ticketStorm');
    this.ticketStormActive = true;
    // Schedule the blink interval outside Angular's zone so it does not drive
    // app-wide change detection every 15 s. Re-enter with ngZone.run() only
    // for the two lines that mutate a template-visible field (ticketStormActive)
    // so OnPush change detection still picks them up.
    this.ngZone.runOutsideAngular(() => {
      this.timers.setInterval(
        'ticketStorm',
        () => {
          this.ngZone.run(() => {
            this.ticketStormActive = false;
          });
          this.timers.setTimeout(
            'ticketStormBlink',
            () => {
              this.ngZone.run(() => {
                this.ticketStormActive = true;
              });
            },
            100
          );
        },
        15000
      );
    });
  }

  private stopTicketStormEffect(): void {
    this.ticketStormActive = false;
    this.timers.clearInterval('ticketStorm');
    this.timers.clearTimeout('ticketStormBlink');
  }

  ngOnDestroy(): void {
    for (const timeout of Object.values(this.timeouts)) {
      clearTimeout(timeout);
    }
    this.timers.clearAll();
    this.stopPassiveIncomeAnimation();
    this.stopSceneLoop();
    this.disconnectResizeObserver();
  }

  private handleScoreIncrement(score: number): void {
    this.triggerAnimation('scoreIncreaseAmount', score, 'scoreTimeout', 0);
    const pulseLevel = this.gameService.getPulseLevel(score);
    const pulseClass = `current-level-${pulseLevel}`;
    this.currentPulseClass = pulseClass;
    this.triggerAnimation('pulseAnimationClass', 'pulse-animation', 'pulseTimeout', '');
  }

  private handleMultiplierIncrement(multiplier: number): void {
    this.triggerAnimation('multiplierIncreaseAmount', multiplier, 'multiplierTimeout', 0);
  }

  private triggerAnimation<K extends keyof AnimationProperties>(
    propertyKey: string,
    value: AnimationProperties[K],
    timeoutKey: string,
    resetValue: AnimationProperties[K]
  ): void {
    if (this.timeouts[timeoutKey]) {
      clearTimeout(this.timeouts[timeoutKey]);
    }

    (this as unknown as Record<string, AnimationProperties[K]>)[propertyKey] = value;
    this.cdr.detectChanges();

    if (resetValue !== null) {
      this.timeouts[timeoutKey] = setTimeout(() => {
        (this as unknown as Record<string, AnimationProperties[K]>)[propertyKey] = resetValue;
        this.cdr.detectChanges();
      }, ScreenComponent.ANIMATION_DURATION);
    }
  }

  getPowerUpName(powerUpId: string): string {
    const nameMap: { [key: string]: string } = {
      doublePoints: 'Double Points',
      slowTime: 'Slow Time',
      multiSelect: 'Multi-Select',
      extraTime: 'Extra Time',
      ticketMultiplier: 'Golden Popcorn',
      passiveIncome: 'Box Office',
      autoClicker: 'Usher',
      magneticField: 'Spotlight',
      luckyStreak: 'Fortune',
      ticketStorm: 'Confetti',
      seatUpgrade: 'Velvet Seats',
      criticalHit: 'Lucky Dice',
      comboMaster: 'Hot Streak',
    };
    return nameMap[powerUpId] || 'Power-Up';
  }

  getPowerUpEffect(powerUpId: string, value: number): string {
    switch (powerUpId) {
      case 'doublePoints':
        return `${value} clicks`;
      case 'slowTime':
        return `${value}s`;
      case 'multiSelect':
        return `${value} clicks`;
      case 'extraTime':
        return `+${value}s`;
      case 'ticketMultiplier':
        return `x${formatMultiplier(Math.pow(POWER_UP_FORMULAS.TICKET_MULTIPLIER_BASE, value))}`;
      case 'passiveIncome':
        return `+${value * POWER_UP_FORMULAS.PASSIVE_INCOME_PER_LEVEL}/s`;
      case 'autoClicker':
        return value === 1 ? 'Available' : `${value} Available`;
      case 'magneticField':
        return `${value} row${value > 1 ? 's' : ''}`;
      case 'luckyStreak':
        return `${Math.min(POWER_UP_FORMULAS.LUCKY_STREAK_BASE_CHANCE + value * POWER_UP_FORMULAS.LUCKY_STREAK_PER_LEVEL, POWER_UP_FORMULAS.LUCKY_STREAK_MAX_CHANCE)}%`;
      case 'ticketStorm':
        return `+${value * POWER_UP_FORMULAS.TICKET_STORM_PER_LEVEL}/15s`;
      case 'seatUpgrade':
        return `+${value * POWER_UP_FORMULAS.SEAT_UPGRADE_BONUS_PER_LEVEL}/click`;
      case 'criticalHit':
        return `${Math.min(POWER_UP_FORMULAS.CRITICAL_HIT_BASE_CHANCE + value * POWER_UP_FORMULAS.CRITICAL_HIT_PER_LEVEL, POWER_UP_FORMULAS.CRITICAL_HIT_MAX_CHANCE)}% x${GAME_MECHANICS.CRITICAL_HIT_MULTIPLIER}`;
      case 'comboMaster':
        return `+${Math.min(value, POWER_UP_FORMULAS.COMBO_MASTER_MAX_BONUS_SECONDS)}s/click`;
      default:
        return '';
    }
  }

  shouldPulsePowerUp(powerUpId: string): boolean {
    return ['doublePoints', 'slowTime', 'multiSelect', 'extraTime'].includes(powerUpId);
  }

  getTimerClass(timerValue: number | null): string {
    if (timerValue == null || timerValue < 0) return '';
    if (timerValue <= 3) return 'timer-critical';
    if (timerValue <= 6) return 'timer-warning';
    return '';
  }
}
