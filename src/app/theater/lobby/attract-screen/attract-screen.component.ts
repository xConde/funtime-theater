import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  NgZone,
  OnDestroy,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import { lobbyProgram } from '../../film/featured-films';
import { beatAt } from '../../film/film-generator';
import { paintScene, SCENE_HEIGHT, SCENE_PIXEL_RATIO, SCENE_WIDTH } from '../../film/scene-painter';
import { Film } from '../../film/film.model';

/** Seconds before a feature ends that filmEnding fires (the credits roll). */
const ENDING_NOTICE_SECONDS = 6;

@Component({
  selector: 'app-attract-screen',
  templateUrl: './attract-screen.component.html',
  styleUrls: ['./attract-screen.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AttractScreenComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvasEl') private canvasRef!: ElementRef<HTMLCanvasElement>;

  /** A paused game turns the marquee eyebrow into the intermission sign. */
  readonly intermission = input(false);

  /** Index into the featured catalog of the film currently on the marquee. */
  readonly filmIndexChange = output<number>();
  /**
   * Fires once per feature as its credits begin, so the lobby can send the
   * billsticker to repaint the Coming Soon wall before the next picture
   * takes the marquee.
   */
  readonly filmEnding = output<number>();

  readonly sceneWidth = SCENE_WIDTH * SCENE_PIXEL_RATIO;
  readonly sceneHeight = SCENE_HEIGHT * SCENE_PIXEL_RATIO;

  /** Signal updated (on zone.run boundary) whenever the feature film changes. */
  readonly currentFilm = signal<Film | null>(null);

  private films: Film[] = [];
  private filmIndex = 0;
  private rafId: number | null = null;
  private startTs = 0;
  private reducedMotion = false;
  private endingAnnounced = false;
  private lastPaintTs = 0;
  private onScreen = true;
  private intersection: IntersectionObserver | null = null;

  constructor(private zone: NgZone) {}

  ngAfterViewInit(): void {
    // The session program: tonight's premiere first, the rest shuffled.
    this.films = [...lobbyProgram()];
    this.filmIndex = 0;

    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Signals update their own change detection regardless of zone; no zone.run needed.
    this.currentFilm.set(this.films[this.filmIndex]);
    this.filmIndexChange.emit(this.filmIndex);

    if (this.reducedMotion) {
      // Paint a single still frame at second=10 of tonight's premiere; schedule no rAF.
      const film = this.films[this.filmIndex];
      const ctx = this.canvasRef.nativeElement.getContext('2d');
      if (ctx) {
        paintScene(ctx, film, beatAt(film, 10), 10);
      }
      return;
    }

    // No point painting a marquee nobody can see: pause rendering while
    // the screen is scrolled out of view (the film clock keeps running).
    if (typeof IntersectionObserver !== 'undefined') {
      this.intersection = new IntersectionObserver((entries) => {
        this.onScreen = entries[0]?.isIntersecting ?? true;
      });
      this.intersection.observe(this.canvasRef.nativeElement);
    }

    this.startTs = globalThis.performance.now();
    this.zone.runOutsideAngular(() => {
      this.scheduleFrame();
    });
  }

  ngOnDestroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.intersection?.disconnect();
  }

  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame(() => this.tick());
  }

  private tick(): void {
    const elapsed = (globalThis.performance.now() - this.startTs) / 1000;
    const film = this.films[this.filmIndex];

    if (!this.endingAnnounced && elapsed >= film.runtimeSeconds - ENDING_NOTICE_SECONDS) {
      this.endingAnnounced = true;
      const nextIndex = (this.filmIndex + 1) % this.films.length;
      this.zone.run(() => this.filmEnding.emit(nextIndex));
    }

    if (elapsed >= film.runtimeSeconds) {
      this.filmIndex = (this.filmIndex + 1) % this.films.length;
      this.startTs = globalThis.performance.now();
      this.endingAnnounced = false;
      const nextFilm = this.films[this.filmIndex];
      const nextIndex = this.filmIndex;
      // Signal set inside zone.run so Angular's CD sees the update from outside NgZone.
      this.zone.run(() => {
        this.currentFilm.set(nextFilm);
        this.filmIndexChange.emit(nextIndex);
      });
      this.scheduleFrame();
      return;
    }

    // 30fps cap: the scenes read identically and high-refresh displays
    // stop paying for frames the art never uses.
    const now = globalThis.performance.now();
    if (this.onScreen && now - this.lastPaintTs >= 33) {
      const ctx = this.canvasRef.nativeElement.getContext('2d');
      if (ctx) {
        paintScene(ctx, film, beatAt(film, elapsed), elapsed);
        this.lastPaintTs = now;
      }
    }

    this.scheduleFrame();
  }
}
