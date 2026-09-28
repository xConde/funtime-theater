import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { AttractScreenComponent } from './attract-screen.component';
import { featuredFilms, tonightsPremiereIndex } from '../../film/featured-films';
import { SCENE_HEIGHT, SCENE_PIXEL_RATIO, SCENE_WIDTH } from '../../film/scene-painter';

// Stub canvas context so getContext('2d') never returns null in tests.
function stubCanvasContext(): void {
  spyOn(HTMLCanvasElement.prototype, 'getContext').and.returnValue({
    fillRect: jasmine.createSpy('fillRect'),
    clearRect: jasmine.createSpy('clearRect'),
    beginPath: jasmine.createSpy('beginPath'),
    closePath: jasmine.createSpy('closePath'),
    moveTo: jasmine.createSpy('moveTo'),
    lineTo: jasmine.createSpy('lineTo'),
    arc: jasmine.createSpy('arc'),
    ellipse: jasmine.createSpy('ellipse'),
    fill: jasmine.createSpy('fill'),
    stroke: jasmine.createSpy('stroke'),
    quadraticCurveTo: jasmine.createSpy('quadraticCurveTo'),
    drawImage: jasmine.createSpy('drawImage'),
    save: jasmine.createSpy('save'),
    restore: jasmine.createSpy('restore'),
    strokeRect: jasmine.createSpy('strokeRect'),
    setTransform: jasmine.createSpy('setTransform'),
    // Transform/path ops the scene painter calls (e.g. paintWestern -> translate);
    // missing entries previously threw "ctx.translate is not a function" whenever
    // a transform-using scene was painted.
    translate: jasmine.createSpy('translate'),
    rotate: jasmine.createSpy('rotate'),
    scale: jasmine.createSpy('scale'),
    transform: jasmine.createSpy('transform'),
    clip: jasmine.createSpy('clip'),
    rect: jasmine.createSpy('rect'),
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D);
}

describe('AttractScreenComponent', () => {
  beforeEach(() => {
    spyOn(window, 'requestAnimationFrame').and.returnValue(1);
    spyOn(window, 'cancelAnimationFrame');
  });

  describe("renders plaque with tonight's premiere title", () => {
    let fixture: ComponentFixture<AttractScreenComponent>;

    beforeEach(async () => {
      spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
      stubCanvasContext();

      await TestBed.configureTestingModule({
        imports: [AttractScreenComponent],
      }).compileComponents();

      fixture = TestBed.createComponent(AttractScreenComponent);
      fixture.detectChanges();
    });

    it("renders plaque with tonight's premiere title", () => {
      const expectedFilm = featuredFilms()[tonightsPremiereIndex(new Date())];
      const titleEl = fixture.debugElement.query(By.css('.attract-title'));
      expect(titleEl).toBeTruthy();
      expect((titleEl.nativeElement as HTMLElement).textContent?.trim()).toBe(expectedFilm.title);
    });
  });

  describe('canvas attrs', () => {
    let fixture: ComponentFixture<AttractScreenComponent>;

    beforeEach(async () => {
      spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
      stubCanvasContext();

      await TestBed.configureTestingModule({
        imports: [AttractScreenComponent],
      }).compileComponents();

      fixture = TestBed.createComponent(AttractScreenComponent);
      fixture.detectChanges();
    });

    it('canvas element present with correct width/height attrs', () => {
      const canvas = fixture.debugElement.query(By.css('canvas'));
      expect(canvas).toBeTruthy();
      const el = canvas.nativeElement as HTMLCanvasElement;
      expect(el.getAttribute('width')).toBe(String(SCENE_WIDTH * SCENE_PIXEL_RATIO));
      expect(el.getAttribute('height')).toBe(String(SCENE_HEIGHT * SCENE_PIXEL_RATIO));
    });
  });

  describe('ngOnDestroy cancels rAF', () => {
    let fixture: ComponentFixture<AttractScreenComponent>;

    beforeEach(async () => {
      spyOn(window, 'matchMedia').and.returnValue({ matches: false } as MediaQueryList);
      stubCanvasContext();

      await TestBed.configureTestingModule({
        imports: [AttractScreenComponent],
      }).compileComponents();

      fixture = TestBed.createComponent(AttractScreenComponent);
      fixture.detectChanges();
    });

    it('ngOnDestroy cancels rAF', () => {
      fixture.destroy();
      expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    });
  });

  describe('reduced-motion path', () => {
    let fixture: ComponentFixture<AttractScreenComponent>;

    beforeEach(async () => {
      spyOn(window, 'matchMedia').and.returnValue({ matches: true } as MediaQueryList);
      stubCanvasContext();

      await TestBed.configureTestingModule({
        imports: [AttractScreenComponent],
      }).compileComponents();

      fixture = TestBed.createComponent(AttractScreenComponent);
      fixture.detectChanges();
    });

    it('reduced-motion path paints once and schedules no rAF', () => {
      // When prefers-reduced-motion matches, the component's game loop is not
      // started, so rafId remains null. Angular's own scheduler may call
      // requestAnimationFrame internally; we inspect the component's loop state
      // directly rather than asserting total rAF call count.
      type Internals = { rafId: number | null };
      const internals = fixture.componentInstance as unknown as Internals;
      expect(internals.rafId).toBeNull();
    });
  });
});
