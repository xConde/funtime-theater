import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';

import { SeatingAreaComponent } from './seating-area.component';
import { GameService, GameState } from '../game.service';
import { Seat, SeatPosition, SeatRow, TheaterService } from '../theater.service';
import { AudienceService, HouseReaction } from '../services/audience.service';
import { StorageService } from '../services/storage.service';

class MockGameService {
  resumeGame = jasmine.createSpy('resumeGame');
  // The child patron-layer reads gameState to decide whether to seat the house.
  gameState = signal<GameState>(GameState.Playing);
}

describe('SeatingAreaComponent', () => {
  let component: SeatingAreaComponent;
  let fixture: ComponentFixture<SeatingAreaComponent>;
  let mockGameService: MockGameService;

  const seatSample: Seat = { side: 'left', rowIndex: 1, seatIndex: 2, showSoda: false, showPopcorn: false };
  const seatRowSample: SeatRow = {
    rowIndex: 1,
    seatsPerRow: 4,
    leftSeats: [seatSample],
    rightSeats: [],
  };

  beforeEach(async () => {
    const storageSpy = jasmine.createSpyObj('StorageService', ['loadGameData', 'saveGameData']);
    storageSpy.loadGameData.and.returnValue({
      coins: 0,
      name: 'Player',
      totalGamesPlayed: 0,
      totalXP: 0,
      gameModes: [],
      powerUps: [],
    });

    await TestBed.configureTestingModule({
      imports: [SeatingAreaComponent],
      providers: [
        { provide: GameService, useClass: MockGameService },
        { provide: StorageService, useValue: storageSpy },
        // Isolate the child patron-layer's service chain so a future non-root
        // dependency there fails its own spec, not this one.
        {
          provide: TheaterService,
          useValue: { seatsData: signal<SeatRow[]>([]), activeSeat: signal<SeatPosition | null>(null) },
        },
        {
          provide: AudienceService,
          useValue: {
            houseReaction: signal<HouseReaction>('idle'),
            screening: signal(false),
            isOccupied: () => false,
            hasPhone: () => false,
            reactionPhase: () => 0,
            patronStyle: () => ({
              size: 1,
              headWidth: 0.44,
              skinColor: '#875b48',
              coatColor: '#273840',
              wear: 'bare',
              wearColor: '#241c14',
              build: 'regular',
              posture: 'upright',
            }),
          },
        },
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(SeatingAreaComponent);
    component = fixture.componentInstance;
    mockGameService = TestBed.inject(GameService) as unknown as MockGameService;
    component.seatsData = [seatRowSample];
    component.activeSeat = { side: 'left', rowIndex: 2, seatIndex: 2 }; // because isActiveSeat increments rowIndex by 1 internally
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('isActiveSeat should return true for active seat', () => {
    expect(component.isActiveSeat('left', 1, 2)).toBeTrue();
  });

  it('widens the rows and aisle toward the viewer', () => {
    component.seatsData = Array.from({ length: 5 }, (_, index) => ({
      ...seatRowSample,
      rowIndex: index + 1,
    }));

    const distantRow = component.rowPerspective(0);
    const nearRow = component.rowPerspective(4);

    expect(distantRow.transform).toBe('scale(0.900)');
    expect(nearRow.transform).toBe('scale(1.000)');
    expect(Number.parseFloat(distantRow.aisleWidth)).toBeLessThan(Number.parseFloat(nearRow.aisleWidth));
    expect(distantRow.flexGrow).toBeLessThan(nearRow.flexGrow);
  });

  it('should emit seatHovered event', () => {
    const emitSpy = spyOn(component.seatHovered, 'emit');
    component.handleSeatEvent({ eventType: 'hover', seat: seatSample, interaction: 'pointer' });
    expect(emitSpy).toHaveBeenCalledWith({ seat: seatSample });
  });

  it('preserves the interaction method when selecting a seat', () => {
    const emitSpy = spyOn(component.seatSelected, 'emit');

    component.handleSeatEvent({ eventType: 'select', seat: seatSample, interaction: 'keyboard' });

    expect(emitSpy).toHaveBeenCalledWith({ seat: seatSample, interaction: 'keyboard' });
  });

  it('provides one roving tab stop even when the lit target is elsewhere', () => {
    const firstSeat: Seat = { ...seatSample, seatIndex: 1 };
    const secondSeat: Seat = { ...seatSample, side: 'right', seatIndex: 1 };
    component.seatsData = [{ ...seatRowSample, leftSeats: [firstSeat], rightSeats: [secondSeat] }];

    expect(component.isKeyboardSeat(firstSeat)).toBeTrue();
    expect(component.isKeyboardSeat(secondSeat)).toBeFalse();

    component.handleSeatFocus(secondSeat);

    expect(component.isKeyboardSeat(firstSeat)).toBeFalse();
    expect(component.isKeyboardSeat(secondSeat)).toBeTrue();
  });

  it('moves the roving tab stop across rows with arrow keys', () => {
    const firstRowLeft: Seat = { ...seatSample, rowIndex: 1, seatIndex: 1 };
    const firstRowRight: Seat = { ...seatSample, side: 'right', rowIndex: 1, seatIndex: 1 };
    const secondRowLeft: Seat = { ...seatSample, rowIndex: 2, seatIndex: 1 };
    const secondRowRight: Seat = { ...seatSample, side: 'right', rowIndex: 2, seatIndex: 1 };
    component.seatsData = [
      { rowIndex: 1, seatsPerRow: 2, leftSeats: [firstRowLeft], rightSeats: [firstRowRight] },
      { rowIndex: 2, seatsPerRow: 2, leftSeats: [secondRowLeft], rightSeats: [secondRowRight] },
    ];

    component.handleSeatFocus(firstRowLeft);
    component.moveKeyboardFocus(firstRowLeft, 'right');
    expect(component.isKeyboardSeat(firstRowRight)).toBeTrue();

    component.moveKeyboardFocus(firstRowRight, 'down');
    expect(component.isKeyboardSeat(secondRowRight)).toBeTrue();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WS2c fix 1: the paused scrim used to be an unlabeled dark overlay whose
  // only documented way out was an undiscoverable click-anywhere. It now
  // carries themed copy and a "press any key to resume" affordance, but Tab
  // and interactive-element targets are excluded so the LOBBY button (a
  // sibling outside this component) stays keyboard-reachable.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Paused overlay', () => {
    it('renders themed intermission copy when paused', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      const backdrop: HTMLElement = fixture.nativeElement.querySelector('.paused-backdrop');
      expect(backdrop).toBeTruthy();
      expect(backdrop.textContent).toContain('Intermission');
      expect(backdrop.textContent).toContain('resume');
    });

    it('does not render the overlay when not paused', () => {
      fixture.componentRef.setInput('paused', false);
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.paused-backdrop')).toBeNull();
    });

    it('resumes the game on any ordinary key press while paused', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(mockGameService.resumeGame).toHaveBeenCalledTimes(1);
    });

    it('does nothing on keypress when not paused', () => {
      fixture.componentRef.setInput('paused', false);
      fixture.detectChanges();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

      expect(mockGameService.resumeGame).not.toHaveBeenCalled();
    });

    it('ignores Tab so keyboard users can still reach the LOBBY button', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

      expect(mockGameService.resumeGame).not.toHaveBeenCalled();
    });

    it('ignores bare modifier keys', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));

      expect(mockGameService.resumeGame).not.toHaveBeenCalled();
    });

    it('lets a focused interactive control (the LOBBY button) handle its own key activation', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      const button = document.createElement('button');
      document.body.appendChild(button);
      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      document.body.removeChild(button);

      expect(mockGameService.resumeGame).not.toHaveBeenCalled();
    });

    // WS2c fix 3: chairs are `role="button"` divs, not real <button> elements,
    // and nothing removes them from the tab order while paused. A tagName-only
    // check misses them, so the roving chair could stay focused and its own
    // Enter/Space would fall through to resumeGame() instead of the chair's
    // own handling. closest() catches role="button" regardless of tag.
    it('lets a role="button" element (e.g. a chair) handle its own key activation too', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      const chairLikeDiv = document.createElement('div');
      chairLikeDiv.setAttribute('role', 'button');
      document.body.appendChild(chairLikeDiv);
      chairLikeDiv.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      document.body.removeChild(chairLikeDiv);

      expect(mockGameService.resumeGame).not.toHaveBeenCalled();
    });

    // aria-atomic matches .game-over's pattern for a role="status" region.
    it('marks the paused-backdrop status region as aria-atomic', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      const backdrop: HTMLElement = fixture.nativeElement.querySelector('.paused-backdrop');
      expect(backdrop.getAttribute('aria-atomic')).toBe('true');
    });

    // Theater fix 1 (Escape-to-pause): unlike Enter/Space, Escape is not an
    // activation key any focusable control in this component owns (chairs
    // only bind keydown.enter/space/arrows — see ChairComponent), so it must
    // resume even when a role="button" chair still holds keyboard focus.
    // Escape-to-pause never moves focus, so the chair that was focused when
    // the round paused is exactly where focus still sits for this keypress.
    it('resumes on Escape even when a role="button" element (e.g. a chair) is focused', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      const chairLikeDiv = document.createElement('div');
      chairLikeDiv.setAttribute('role', 'button');
      document.body.appendChild(chairLikeDiv);
      chairLikeDiv.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.body.removeChild(chairLikeDiv);

      expect(mockGameService.resumeGame).toHaveBeenCalledTimes(1);
    });

    // Theater fix 1: TheaterComponent's own Escape-to-pause listener marks
    // the keydown that just paused the round with preventDefault() so this
    // listener does not treat that SAME keypress as its own resume trigger
    // (both listeners are bound to document:keydown and would otherwise
    // both react to one physical Escape press).
    it('ignores a keydown already marked handled via preventDefault()', () => {
      fixture.componentRef.setInput('paused', true);
      fixture.detectChanges();

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      event.preventDefault();
      document.dispatchEvent(event);

      expect(mockGameService.resumeGame).not.toHaveBeenCalled();
    });
  });
});
