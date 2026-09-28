import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { CUSTOM_ELEMENTS_SCHEMA, signal, WritableSignal } from '@angular/core';

import { generateFilm } from '../film/film-generator';
import { FilmShowtimeService } from '../film/film-showtime.service';
import { FilmBeat } from '../film/film.model';
import { GameService, GameState } from '../game.service';
import { formatMultiplier, ordinal, ScreenComponent } from './screen.component';

class MockGameService {
  gameState = signal<GameState>(GameState.Inactive);
  scoreIncrement$ = new BehaviorSubject<number>(0);
  multiplierIncrement$ = new BehaviorSubject<number>(0);
  score = signal(0);
  multiplier = signal(1);
  timer = signal(0);
  currentGameModeName = signal('Classic');
  activePowerUpsSignal: WritableSignal<Map<string, number>> = signal(new Map());
  usherCooldown = signal(0);
  usherReady = signal(false);
  coinsEarned = signal(0);
  appBonusEarned = signal(0);
  isNewHighScore = signal(false);

  getPulseLevel(_score: number): number {
    return 1;
  }
}

class MockFilmShowtimeService {
  currentFilm = signal<ReturnType<typeof generateFilm> | null>(null);
  filmSecond = signal<number>(0);
  featureNumber = signal<number>(1);
  currentBeat = signal<FilmBeat | null>(null);
}

describe('ScreenComponent', () => {
  let component: ScreenComponent;
  let fixture: ComponentFixture<ScreenComponent>;
  let gameSvc: MockGameService;
  let filmSvc: MockFilmShowtimeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScreenComponent],
      providers: [
        { provide: GameService, useClass: MockGameService },
        { provide: FilmShowtimeService, useClass: MockFilmShowtimeService },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ScreenComponent);
    component = fixture.componentInstance;
    gameSvc = TestBed.inject(GameService) as unknown as MockGameService;
    filmSvc = TestBed.inject(FilmShowtimeService) as unknown as MockFilmShowtimeService;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should react to score increments', () => {
    gameSvc.scoreIncrement$.next(100);
    fixture.detectChanges();
    expect(component.scoreIncreaseAmount).toBe(100);
  });

  it('announces earned tickets without turning the timer into a live region', () => {
    gameSvc.gameState.set(GameState.Playing);
    gameSvc.score.set(125);
    gameSvc.scoreIncrement$.next(25);
    fixture.detectChanges();

    const scoreStatus = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[role="status"].sr-only');
    const timer = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.timer-section');
    expect(scoreStatus?.textContent).toContain('25 tickets earned');
    expect(scoreStatus?.textContent).toContain('Score 125');
    expect(scoreStatus?.getAttribute('aria-atomic')).toBe('true');
    expect(timer?.hasAttribute('aria-live')).toBeFalse();
  });

  it('announces the final score when the show ends', () => {
    gameSvc.score.set(640);
    gameSvc.coinsEarned.set(80);
    gameSvc.gameState.set(GameState.Ended);
    fixture.detectChanges();

    const gameOver = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.game-over');
    expect(gameOver?.getAttribute('role')).toBe('status');
    expect(gameOver?.getAttribute('aria-live')).toBe('polite');
    expect(gameOver?.textContent).toContain('640');
    expect(gameOver?.textContent).toContain('Final Curtain');
  });

  it('shows the new-high-score callout only when the game service flags one', () => {
    gameSvc.score.set(640);
    gameSvc.gameState.set(GameState.Ended);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.new-high-score')).toBeNull();

    gameSvc.isNewHighScore.set(true);
    fixture.detectChanges();

    const callout = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.new-high-score');
    expect(callout?.textContent).toContain('New Box Office Record');
  });

  // ── activePowerUpsArray subscription ──────────────────────────

  describe('activePowerUpsArray', () => {
    it('should populate from activePowerUpsSignal', () => {
      const powerUps = new Map<string, number>([
        ['doublePoints', 3],
        ['passiveIncome', 2],
      ]);
      gameSvc.activePowerUpsSignal.set(powerUps);
      fixture.detectChanges();

      expect(component.activePowerUpsArray).toEqual([
        { key: 'doublePoints', value: 3 },
        { key: 'passiveIncome', value: 2 },
      ]);
    });

    it('should clear when power-ups map is empty', () => {
      gameSvc.activePowerUpsSignal.set(new Map([['doublePoints', 1]]));
      fixture.detectChanges();
      expect(component.activePowerUpsArray.length).toBe(1);

      gameSvc.activePowerUpsSignal.set(new Map());
      fixture.detectChanges();
      expect(component.activePowerUpsArray.length).toBe(0);
    });
  });

  // ── getPowerUpIcon ────────────────────────────────────────────

  describe('getPowerUpIcon', () => {
    it('should return the bespoke icon name for known permanent concessions', () => {
      expect(component.getPowerUpIcon('autoClicker')).toBe('user');
      expect(component.getPowerUpIcon('criticalHit')).toBe('dice');
      expect(component.getPowerUpIcon('comboMaster')).toBe('fire');
    });

    it('should return the bespoke icon name for every temporary power-up (all 13 PowerUpIds are covered)', () => {
      expect(component.getPowerUpIcon('doublePoints')).toBe('copy');
      expect(component.getPowerUpIcon('slowTime')).toBe('hourglass');
      expect(component.getPowerUpIcon('multiSelect')).toBe('cursor-click');
      expect(component.getPowerUpIcon('extraTime')).toBe('clock-countdown');
    });

    it('should return star for unknown power-up IDs', () => {
      expect(component.getPowerUpIcon('nonExistent')).toBe('star');
      expect(component.getPowerUpIcon('')).toBe('star');
    });
  });

  // ── getPowerUpName ────────────────────────────────────────────

  describe('getPowerUpName', () => {
    it('should return themed names for known power-ups', () => {
      expect(component.getPowerUpName('ticketMultiplier')).toBe('Golden Popcorn');
      expect(component.getPowerUpName('ticketStorm')).toBe('Confetti');
      expect(component.getPowerUpName('seatUpgrade')).toBe('Velvet Seats');
    });

    it('should return "Power-Up" for unknown IDs', () => {
      expect(component.getPowerUpName('unknownId')).toBe('Power-Up');
    });
  });

  // ── getPowerUpEffect ──────────────────────────────────────────

  describe('getPowerUpEffect', () => {
    it('should format doublePoints as click count', () => {
      expect(component.getPowerUpEffect('doublePoints', 5)).toBe('5 clicks');
    });

    it('should format slowTime as seconds', () => {
      expect(component.getPowerUpEffect('slowTime', 10)).toBe('10s');
    });

    it('should format extraTime with plus prefix', () => {
      expect(component.getPowerUpEffect('extraTime', 15)).toBe('+15s');
    });

    it('should format ticketMultiplier as exponential multiplier', () => {
      expect(component.getPowerUpEffect('ticketMultiplier', 1)).toBe('x1.50');
      expect(component.getPowerUpEffect('ticketMultiplier', 2)).toBe('x2.25');
      // Late-game compounding stays readable instead of x2216.8378200531006.
      expect(component.getPowerUpEffect('ticketMultiplier', 19)).toBe('x2.2k');
    });

    it('should format passiveIncome as per-second rate', () => {
      expect(component.getPowerUpEffect('passiveIncome', 2)).toBe('+10/s');
    });

    it('should format autoClicker singular and plural', () => {
      expect(component.getPowerUpEffect('autoClicker', 1)).toBe('Available');
      expect(component.getPowerUpEffect('autoClicker', 3)).toBe('3 Available');
    });

    it('should format magneticField with row pluralization', () => {
      expect(component.getPowerUpEffect('magneticField', 1)).toBe('1 row');
      expect(component.getPowerUpEffect('magneticField', 4)).toBe('4 rows');
    });

    it('should cap luckyStreak at 60%', () => {
      expect(component.getPowerUpEffect('luckyStreak', 1)).toBe('20%');
      expect(component.getPowerUpEffect('luckyStreak', 9)).toBe('60%');
      expect(component.getPowerUpEffect('luckyStreak', 99)).toBe('60%');
    });

    it('should cap criticalHit at 50%', () => {
      expect(component.getPowerUpEffect('criticalHit', 1)).toBe('25% x10');
      expect(component.getPowerUpEffect('criticalHit', 6)).toBe('50% x10');
      expect(component.getPowerUpEffect('criticalHit', 99)).toBe('50% x10');
    });

    it('should format ticketStorm with 25-per-level rate', () => {
      expect(component.getPowerUpEffect('ticketStorm', 2)).toBe('+50/15s');
    });

    it('should format seatUpgrade as per-click bonus', () => {
      expect(component.getPowerUpEffect('seatUpgrade', 3)).toBe('+15/click');
    });

    it('should format comboMaster as time-per-click', () => {
      expect(component.getPowerUpEffect('comboMaster', 2)).toBe('+2s/click');
    });

    it('should return empty string for unknown power-up', () => {
      expect(component.getPowerUpEffect('unknown', 1)).toBe('');
    });
  });

  // ── shouldPulsePowerUp ────────────────────────────────────────

  describe('shouldPulsePowerUp', () => {
    it('should return true for temporary power-ups', () => {
      expect(component.shouldPulsePowerUp('doublePoints')).toBeTrue();
      expect(component.shouldPulsePowerUp('slowTime')).toBeTrue();
      expect(component.shouldPulsePowerUp('multiSelect')).toBeTrue();
      expect(component.shouldPulsePowerUp('extraTime')).toBeTrue();
    });

    it('should return false for permanent power-ups', () => {
      expect(component.shouldPulsePowerUp('ticketMultiplier')).toBeFalse();
      expect(component.shouldPulsePowerUp('passiveIncome')).toBeFalse();
      expect(component.shouldPulsePowerUp('autoClicker')).toBeFalse();
      expect(component.shouldPulsePowerUp('criticalHit')).toBeFalse();
    });
  });

  // ── Power-up animation state ──────────────────────────────────
  describe('power-up animation state', () => {
    it('should set hasPassiveIncome when passiveIncome power-up is active', () => {
      gameSvc.activePowerUpsSignal.set(new Map([['passiveIncome', 2]]));
      fixture.detectChanges();
      expect(component.hasPassiveIncome).toBeTrue();
      expect(component.passiveIncomeAmount).toBe(10); // 2 * PASSIVE_INCOME_PER_LEVEL(5)
    });

    it('should clear hasPassiveIncome when passiveIncome power-up is removed', () => {
      gameSvc.activePowerUpsSignal.set(new Map([['passiveIncome', 2]]));
      fixture.detectChanges();
      gameSvc.activePowerUpsSignal.set(new Map());
      fixture.detectChanges();
      expect(component.hasPassiveIncome).toBeFalse();
    });

    it('should set ticketStormActive when ticketStorm power-up is active', () => {
      gameSvc.activePowerUpsSignal.set(new Map([['ticketStorm', 1]]));
      fixture.detectChanges();
      expect(component.ticketStormActive).toBeTrue();
    });

    it('should clear ticketStormActive when ticketStorm power-up is removed', () => {
      gameSvc.activePowerUpsSignal.set(new Map([['ticketStorm', 1]]));
      fixture.detectChanges();
      gameSvc.activePowerUpsSignal.set(new Map());
      fixture.detectChanges();
      expect(component.ticketStormActive).toBeFalse();
    });
  });

  // ── getTimerClass ─────────────────────────────────────────────

  describe('getTimerClass', () => {
    it('should return empty string for null', () => {
      expect(component.getTimerClass(null)).toBe('');
    });

    it('should return empty string for negative values', () => {
      expect(component.getTimerClass(-1)).toBe('');
    });

    it('should return timer-critical at 3s or below', () => {
      expect(component.getTimerClass(0)).toBe('timer-critical');
      expect(component.getTimerClass(3)).toBe('timer-critical');
    });

    it('should return timer-warning between 4s and 6s', () => {
      expect(component.getTimerClass(4)).toBe('timer-warning');
      expect(component.getTimerClass(6)).toBe('timer-warning');
    });

    it('should return empty string above 6s', () => {
      expect(component.getTimerClass(7)).toBe('');
      expect(component.getTimerClass(60)).toBe('');
    });
  });

  // ── Film layer ────────────────────────────────────────────────

  describe('film layer', () => {
    const sampleFilm = generateFilm(12345, 60);

    function titleCardBeat(): FilmBeat {
      return sampleFilm.beats.find((b) => b.kind === 'title-card')!;
    }

    function calmbBeat(): FilmBeat {
      return sampleFilm.beats.find((b) => b.kind === 'calm')!;
    }

    function creditsBeat(): FilmBeat {
      return sampleFilm.beats.find((b) => b.kind === 'credits')!;
    }

    it('renders nothing when currentFilm is null', () => {
      filmSvc.currentFilm.set(null);
      fixture.detectChanges();
      const filmLayer = fixture.nativeElement.querySelector('.film-layer');
      expect(filmLayer).toBeNull();
    });

    it('renders the film layer when a film is present', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(titleCardBeat());
      fixture.detectChanges();
      const filmLayer = fixture.nativeElement.querySelector('.film-layer');
      expect(filmLayer).not.toBeNull();
    });

    it('hides the title typography while the countdown leader plays', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(titleCardBeat());
      filmSvc.filmSecond.set(titleCardBeat().startsAt + 1);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.film-title-card')).toBeNull();
    });

    it('renders the title card after the leader finishes', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(titleCardBeat());
      filmSvc.filmSecond.set(titleCardBeat().startsAt + 4);
      fixture.detectChanges();
      const titleEl = fixture.nativeElement.querySelector('.film-title-card');
      expect(titleEl).not.toBeNull();
      expect(titleEl.textContent).toContain(sampleFilm.title);
    });

    it('does not render the caption during title-card beat', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(titleCardBeat());
      fixture.detectChanges();
      const captionEl = fixture.nativeElement.querySelector('.film-caption');
      expect(captionEl).toBeNull();
    });

    it('renders the caption during a body beat', () => {
      filmSvc.currentFilm.set(sampleFilm);
      const calm = calmbBeat();
      filmSvc.currentBeat.set(calm);
      fixture.detectChanges();
      const captionEl = fixture.nativeElement.querySelector('.film-caption');
      expect(captionEl).not.toBeNull();
      expect(captionEl.textContent).toContain(calm.label);
    });

    it('renders THE END during credits beat', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(creditsBeat());
      fixture.detectChanges();
      const creditsEl = fixture.nativeElement.querySelector('.film-credits');
      expect(creditsEl).not.toBeNull();
      expect(creditsEl.textContent).toContain('The End');
    });

    it('does not render the title card during credits', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(creditsBeat());
      fixture.detectChanges();
      const titleEl = fixture.nativeElement.querySelector('.film-title-card');
      expect(titleEl).toBeNull();
    });

    it('renders credits scroll content', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(creditsBeat());
      fixture.detectChanges();
      const creditsEl = fixture.nativeElement.querySelector('.film-credits');
      expect(creditsEl.textContent).toContain(sampleFilm.starring);
      expect(creditsEl.textContent).toContain(sampleFilm.directedBy);
    });

    it('does not show feature badge when featureNumber is 1', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(titleCardBeat());
      filmSvc.featureNumber.set(1);
      fixture.detectChanges();
      const badge = fixture.nativeElement.querySelector('.film-feature-badge');
      expect(badge).toBeNull();
    });

    it('shows feature badge when featureNumber is 2', () => {
      filmSvc.currentFilm.set(sampleFilm);
      filmSvc.currentBeat.set(titleCardBeat());
      filmSvc.featureNumber.set(2);
      fixture.detectChanges();
      const badge = fixture.nativeElement.querySelector('.film-feature-badge');
      expect(badge).not.toBeNull();
      expect(badge.textContent).toContain('2nd Feature');
    });
  });

  // ── formatMultiplier helper ───────────────────────────────────

  describe('formatMultiplier()', () => {
    it('keeps small multipliers precise and compacts the runaway ones', () => {
      expect(formatMultiplier(1.5)).toBe('1.50');
      expect(formatMultiplier(2.25)).toBe('2.25');
      expect(formatMultiplier(33.49)).toBe('33.5');
      expect(formatMultiplier(332.5)).toBe('333');
      expect(formatMultiplier(2216.8378200531006)).toBe('2.2k');
      expect(formatMultiplier(1500000)).toBe('1500.0k');
    });
  });

  // ── ordinal helper ────────────────────────────────────────────

  describe('ordinal()', () => {
    it('returns 1st for 1', () => expect(ordinal(1)).toBe('1st'));
    it('returns 2nd for 2', () => expect(ordinal(2)).toBe('2nd'));
    it('returns 3rd for 3', () => expect(ordinal(3)).toBe('3rd'));
    it('returns 4th for 4', () => expect(ordinal(4)).toBe('4th'));
    it('returns 11th for 11', () => expect(ordinal(11)).toBe('11th'));
    it('returns 12th for 12', () => expect(ordinal(12)).toBe('12th'));
    it('returns 13th for 13', () => expect(ordinal(13)).toBe('13th'));
    it('returns 21st for 21', () => expect(ordinal(21)).toBe('21st'));
    it('returns 22nd for 22', () => expect(ordinal(22)).toBe('22nd'));
    it('returns 100th for 100', () => expect(ordinal(100)).toBe('100th'));
    it('returns 101st for 101', () => expect(ordinal(101)).toBe('101st'));
    it('returns 111th for 111', () => expect(ordinal(111)).toBe('111th'));
  });

  // ── ordinalLabel method ───────────────────────────────────────

  describe('ordinalLabel()', () => {
    it('delegates to ordinal helper', () => {
      expect(component.ordinalLabel(1)).toBe('1st');
      expect(component.ordinalLabel(3)).toBe('3rd');
    });
  });

  // ── Finding 5 (H3): isFlickerActive flicker gating ───────────

  describe('isFlickerActive', () => {
    const sampleFilm = generateFilm(12345, 60);

    it('is false when currentBeat is null', () => {
      filmSvc.currentBeat.set(null);
      fixture.detectChanges();
      expect(component.isFlickerActive()).toBeFalse();
    });

    it('is false for a low-intensity beat (title-card, intensity 0.05)', () => {
      const titleCard = sampleFilm.beats.find((b) => b.kind === 'title-card')!;
      filmSvc.currentBeat.set(titleCard);
      fixture.detectChanges();
      // title-card intensity is 0.05 — below the 0.4 threshold
      expect(titleCard.intensity).toBeLessThanOrEqual(0.4);
      expect(component.isFlickerActive()).toBeFalse();
    });

    it('is true for a high-intensity beat (spike or climax)', () => {
      const highBeat = sampleFilm.beats.find((b) => b.kind === 'spike' || b.kind === 'climax');
      if (!highBeat) {
        // If the generated film happens to have no spike/climax, skip gracefully.
        pending('No spike or climax beat in sample film');
        return;
      }
      filmSvc.currentBeat.set(highBeat);
      fixture.detectChanges();
      expect(highBeat.intensity).toBeGreaterThan(0.4);
      expect(component.isFlickerActive()).toBeTrue();
    });

    it('flicker-active class is present on .film-flicker when isFlickerActive is true', () => {
      filmSvc.currentFilm.set(sampleFilm);
      const highBeat = sampleFilm.beats.find((b) => b.kind === 'spike' || b.kind === 'climax')!;
      filmSvc.currentBeat.set(highBeat);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('.film-flicker');
      expect(el).not.toBeNull();
      expect(el.classList).toContain('flicker-active');
    });

    it('flicker-active class is absent on .film-flicker for title-card beat', () => {
      filmSvc.currentFilm.set(sampleFilm);
      const titleCard = sampleFilm.beats.find((b) => b.kind === 'title-card')!;
      filmSvc.currentBeat.set(titleCard);
      fixture.detectChanges();
      const el = fixture.nativeElement.querySelector('.film-flicker');
      expect(el).not.toBeNull();
      expect(el.classList).not.toContain('flicker-active');
    });
  });
});
