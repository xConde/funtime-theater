import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AchievementNotificationComponent } from './achievement-notification.component';
import { Achievement, AchievementsService } from '../achievements.service';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeAchievement(overrides: Partial<Achievement> = {}): Achievement {
  return {
    id: 'test-achievement',
    name: 'Test Achievement',
    description: 'A test achievement',
    icon: 'star',
    unlocked: true,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AchievementNotificationComponent', () => {
  let fixture: ComponentFixture<AchievementNotificationComponent>;
  let component: AchievementNotificationComponent;
  let achievementsService: jasmine.SpyObj<AchievementsService> & {
    achievementUnlocked: ReturnType<typeof signal<Achievement | null>>;
  };

  beforeEach(async () => {
    const unlockedSignal = signal<Achievement | null>(null);
    const serviceSpy = jasmine.createSpyObj<AchievementsService>('AchievementsService', ['checkAchievement']);
    (
      serviceSpy as unknown as { achievementUnlocked: ReturnType<typeof signal<Achievement | null>> }
    ).achievementUnlocked = unlockedSignal;

    await TestBed.configureTestingModule({
      imports: [AchievementNotificationComponent, NoopAnimationsModule],
      providers: [{ provide: AchievementsService, useValue: serviceSpy }],
    }).compileComponents();

    achievementsService = TestBed.inject(AchievementsService) as typeof achievementsService;
    fixture = TestBed.createComponent(AchievementNotificationComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  // ── creation ──────────────────────────────────────────────────────────────

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('starts with achievement as null', () => {
    expect(component.achievement).toBeNull();
  });

  // ── effect syncs with service signal ──────────────────────────────────────

  it('sets achievement when service signal emits a value', fakeAsync(() => {
    const ach = makeAchievement();
    achievementsService.achievementUnlocked.set(ach);
    tick();
    fixture.detectChanges();
    expect(component.achievement).toEqual(ach);
  }));

  it('clears achievement when service signal returns to null', fakeAsync(() => {
    const ach = makeAchievement();
    achievementsService.achievementUnlocked.set(ach);
    tick();
    fixture.detectChanges();

    achievementsService.achievementUnlocked.set(null);
    tick();
    fixture.detectChanges();
    expect(component.achievement).toBeNull();
  }));

  // ── dismissAchievement ────────────────────────────────────────────────────

  it('dismissAchievement sets achievement to null', fakeAsync(() => {
    const ach = makeAchievement();
    achievementsService.achievementUnlocked.set(ach);
    tick();
    fixture.detectChanges();

    component.dismissAchievement();
    expect(component.achievement).toBeNull();
  }));

  it('dismissAchievement is a no-op when achievement is already null', () => {
    expect(component.achievement).toBeNull();
    component.dismissAchievement();
    expect(component.achievement).toBeNull();
  });

  // ── onEscape ──────────────────────────────────────────────────────────────

  it('onEscape dismisses achievement when one is active', fakeAsync(() => {
    const ach = makeAchievement();
    achievementsService.achievementUnlocked.set(ach);
    tick();
    fixture.detectChanges();

    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    component.onEscape(event);
    expect(component.achievement).toBeNull();
  }));

  it('onEscape is a no-op when achievement is null', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    // Should not throw
    expect(() => component.onEscape(event)).not.toThrow();
    expect(component.achievement).toBeNull();
  });

  it('onEscape does nothing for non-KeyboardEvent events', fakeAsync(() => {
    const ach = makeAchievement();
    achievementsService.achievementUnlocked.set(ach);
    tick();
    fixture.detectChanges();

    const event = new Event('keydown');
    component.onEscape(event);
    // achievement should remain (event was not a KeyboardEvent)
    expect(component.achievement).toEqual(ach);
  }));

  it('document:keydown.escape fires dismissal via HostListener', fakeAsync(() => {
    const ach = makeAchievement();
    achievementsService.achievementUnlocked.set(ach);
    tick();
    fixture.detectChanges();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(component.achievement).toBeNull();
  }));
});
