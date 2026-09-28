import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  QueryList,
  signal,
  ViewChildren,
} from '@angular/core';
import { lobbyProgram } from '../../film/featured-films';
import { Film } from '../../film/film.model';
import { paintPoster, POSTER_HEIGHT, POSTER_PIXEL_RATIO, POSTER_WIDTH } from '../../film/poster-painter';

/** How long the billsticker takes to cross the wall. */
const WALK_MS = 3200;
/** Stagger between each poster's paste-over as he passes. */
const PASTE_STAGGER_MS = 700;
/** How long a single paste-over wipe runs (matches the SCSS animation). */
const PASTE_MS = 900;

/**
 * The Coming Soon wall: one-sheets for the next four features after the
 * picture currently on the marquee. When the marquee film hits its credits
 * the billsticker walks the wall and pastes the new lineup over the old,
 * so the wall is already current when the next feature starts.
 */
@Component({
  selector: 'app-coming-soon',
  templateUrl: './coming-soon.component.html',
  styleUrls: ['./coming-soon.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComingSoonComponent implements AfterViewInit, OnDestroy {
  @ViewChildren('posterCanvas') private posterCanvases!: QueryList<ElementRef<HTMLCanvasElement>>;

  readonly posterWidth = POSTER_WIDTH * POSTER_PIXEL_RATIO;
  readonly posterHeight = POSTER_HEIGHT * POSTER_PIXEL_RATIO;

  private readonly films = lobbyProgram();
  private baseIndex = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** The four features after the film on the marquee. */
  readonly upcoming = signal<readonly Film[]>(this.slate(0));
  /** True while the billsticker crosses the wall. */
  readonly stickerWalking = signal(false);
  /** Which slots are mid-paste (paper wipe running). */
  readonly pasting = signal<readonly boolean[]>([false, false, false, false]);
  /** Slots still wearing blank paper before the opening walk reaches them. */
  readonly covered = signal<readonly boolean[]>([true, true, true, true]);
  /** Slots whose opening paper is dissolving to reveal the poster. */
  readonly revealing = signal<readonly boolean[]>([false, false, false, false]);

  ngAfterViewInit(): void {
    if (this.reducedMotion) {
      this.covered.set([false, false, false, false]);
      this.paintAll();
      return;
    }
    // Opening shift: the billsticker walks on and hangs the first slate.
    this.stickerWalking.set(true);
    this.upcoming().forEach((film, slot) => {
      this.timers.push(
        setTimeout(
          () => {
            this.repaintSlot(slot, film);
            this.revealing.update((r) => r.map((v, i) => (i === slot ? true : v)));
            this.timers.push(
              setTimeout(() => {
                this.covered.update((c) => c.map((v, i) => (i === slot ? false : v)));
                this.revealing.update((r) => r.map((v, i) => (i === slot ? false : v)));
              }, 700)
            );
          },
          500 + slot * PASTE_STAGGER_MS
        )
      );
    });
    this.timers.push(setTimeout(() => this.stickerWalking.set(false), WALK_MS));
  }

  ngOnDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
  }

  /** The marquee announces which film it is playing; the wall follows. */
  syncTo(marqueeIndex: number): void {
    if (this.baseIndex === marqueeIndex) return;
    this.baseIndex = marqueeIndex;
    // If the billsticker already repainted ahead of this moment the slate
    // matches and nothing happens; otherwise (first load, reduced motion)
    // swap directly.
    const target = this.slate(marqueeIndex);
    if (this.upcoming() !== target && !this.slatesEqual(this.upcoming(), target)) {
      this.upcoming.set(target);
      this.paintAll();
    }
  }

  /**
   * The credits are rolling upstairs: walk the wall and paste the next
   * slate over the old one before the feature changes.
   */
  beginRepaint(nextMarqueeIndex: number): void {
    const target = this.slate(nextMarqueeIndex);
    if (this.slatesEqual(this.upcoming(), target)) return;

    if (this.reducedMotion) {
      this.upcoming.set(target);
      this.paintAll();
      return;
    }

    this.clearTimers();
    this.stickerWalking.set(true);

    target.forEach((film, slot) => {
      // Paper goes up as the billsticker reaches each frame.
      this.timers.push(
        setTimeout(
          () => {
            this.pasting.update((p) => p.map((v, i) => (i === slot ? true : v)));
            // Swap the artwork at the midpoint of the wipe, under the paper.
            this.timers.push(
              setTimeout(() => {
                this.repaintSlot(slot, film);
              }, PASTE_MS / 2)
            );
            this.timers.push(
              setTimeout(() => {
                this.pasting.update((p) => p.map((v, i) => (i === slot ? false : v)));
              }, PASTE_MS)
            );
          },
          400 + slot * PASTE_STAGGER_MS
        )
      );
    });

    this.timers.push(
      setTimeout(() => {
        this.upcoming.set(target);
        this.stickerWalking.set(false);
      }, WALK_MS)
    );
  }

  private slate(marqueeIndex: number): readonly Film[] {
    const next: Film[] = [];
    for (let offset = 1; offset <= 4; offset++) {
      next.push(this.films[(marqueeIndex + offset) % this.films.length]);
    }
    return next;
  }

  private slatesEqual(a: readonly Film[], b: readonly Film[]): boolean {
    return a.length === b.length && a.every((film, i) => film.seed === b[i].seed);
  }

  private repaintSlot(slot: number, film: Film): void {
    const canvasRef = this.posterCanvases?.get(slot);
    const ctx = canvasRef?.nativeElement.getContext('2d');
    if (ctx) {
      paintPoster(ctx, film);
    }
  }

  private paintAll(): void {
    this.posterCanvases?.forEach((canvasRef, i) => {
      const ctx = canvasRef.nativeElement.getContext('2d');
      const film = this.upcoming()[i];
      if (ctx && film) {
        paintPoster(ctx, film);
      }
    });
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}
