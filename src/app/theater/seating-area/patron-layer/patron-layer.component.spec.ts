import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, WritableSignal } from '@angular/core';
import { PatronLayerComponent } from './patron-layer.component';
import { GameService, GameState } from '../../game.service';
import { Seat, SeatPosition, SeatRow, TheaterService } from '../../theater.service';
import { AudienceService, HouseReaction } from '../../services/audience.service';

function mk(side: 'left' | 'right', rowIndex: number, seatIndex: number): Seat {
  return { side, rowIndex, seatIndex, showSoda: false, showPopcorn: false };
}

function makeRows(): SeatRow[] {
  return [
    {
      rowIndex: 1,
      seatsPerRow: 4,
      leftSeats: [mk('left', 1, 1), mk('left', 1, 2)],
      rightSeats: [mk('right', 1, 1), mk('right', 1, 2)],
    },
    {
      rowIndex: 2,
      seatsPerRow: 4,
      leftSeats: [mk('left', 2, 1), mk('left', 2, 2)],
      rightSeats: [mk('right', 2, 1), mk('right', 2, 2)],
    },
  ];
}

describe('PatronLayerComponent', () => {
  let fixture: ComponentFixture<PatronLayerComponent>;
  let seatsData: WritableSignal<SeatRow[]>;
  let activeSeat: WritableSignal<SeatPosition | null>;
  let houseReaction: WritableSignal<HouseReaction>;
  let gameState: WritableSignal<GameState>;
  let occupiedAll: boolean;

  function build(): void {
    seatsData = signal<SeatRow[]>(makeRows());
    activeSeat = signal<SeatPosition | null>(null);
    houseReaction = signal<HouseReaction>('flinch');
    gameState = signal<GameState>(GameState.Playing);
    occupiedAll = true;

    const theaterStub = { seatsData, activeSeat };
    const gameStub = { gameState };
    const audienceStub = {
      houseReaction,
      isOccupied: () => occupiedAll,
      hasPhone: () => false,
      reactionPhase: () => 0.5,
      patronStyle: () => ({
        size: 1,
        headWidth: 0.44,
        skinColor: '#875b48',
        coatColor: '#273840',
        wear: 'bare' as const,
        wearColor: '#241c14',
        build: 'regular' as const,
        posture: 'upright' as const,
      }),
    };

    TestBed.configureTestingModule({
      imports: [PatronLayerComponent],
      providers: [
        { provide: TheaterService, useValue: theaterStub },
        { provide: GameService, useValue: gameStub },
        { provide: AudienceService, useValue: audienceStub },
      ],
    });
    fixture = TestBed.createComponent(PatronLayerComponent);
    fixture.detectChanges();
  }

  beforeEach(() => build());

  it('renders the house and stamps the current reaction onto it', () => {
    const house = fixture.nativeElement.querySelector('.patron-house');
    expect(house).toBeTruthy();
    expect(house.getAttribute('data-reaction')).toBe('flinch');
    houseReaction.set('restless');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.patron-house').getAttribute('data-reaction')).toBe('restless');
  });

  it('seats a patron in every occupied chair (8 seats across 2 rows)', () => {
    const patrons = fixture.nativeElement.querySelectorAll('.patron');
    expect(patrons.length).toBe(8);
  });

  it('renders authored rear-view figures with separate skin, coat, build, and posture channels', () => {
    const host = fixture.nativeElement as HTMLElement;
    const patron = host.querySelector<HTMLElement>('.patron');

    expect(patron?.querySelector('.patron-figure')).toBeTruthy();
    expect(patron?.querySelector('.patron-neck')).toBeTruthy();
    expect(patron?.getAttribute('data-build')).toBe('regular');
    expect(patron?.getAttribute('data-posture')).toBe('upright');
    expect(patron?.style.getPropertyValue('--skin-color')).toBe('#875b48');
    expect(patron?.style.getPropertyValue('--coat-color')).toBe('#273840');
  });

  it('uses the same near-to-far projection as the chair layer', () => {
    const host = fixture.nativeElement as HTMLElement;
    const rows = host.querySelectorAll<HTMLElement>('.p-row');

    expect(rows[0].style.transform).toBe('scale(0.9)');
    expect(rows[0].style.width).toBe('');
    expect(rows[1].style.transform).toBe('scale(1)');
    expect(rows[0].querySelector<HTMLElement>('.p-stairs')?.style.width).toBe('7%');
    expect(rows[1].querySelector<HTMLElement>('.p-stairs')?.style.width).toBe('10%');
  });

  it('dims the patron sitting in the active target seat', () => {
    activeSeat.set({ side: 'left', rowIndex: 1, seatIndex: 1 });
    fixture.detectChanges();
    const active = fixture.nativeElement.querySelectorAll('.patron.is-active');
    expect(active.length).toBe(1);
  });

  it('shows nothing once the round goes inactive (back to the idle lobby)', () => {
    gameState.set(GameState.Inactive);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.patron-house')).toBeNull();
  });

  it('keeps the house on screen through the game-over screen', () => {
    gameState.set(GameState.Ended);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.patron-house')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('.patron').length).toBe(8);
  });

  it('seats the house during the starting beat and marks it as settling', () => {
    gameState.set(GameState.Starting);
    fixture.detectChanges();

    const house = fixture.nativeElement.querySelector('.patron-house');
    expect(house).toBeTruthy();
    expect(house.classList.contains('is-settling')).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('.patron').length).toBe(8);
  });

  it('never intercepts pointer events (clicks fall through to the chairs)', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.style.pointerEvents).toBe('none');
  });

  it('flags the host as paused so the SCSS can freeze the animations', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('is-paused')).toBe(false);
    fixture.componentRef.setInput('paused', true);
    fixture.detectChanges();
    expect(host.classList.contains('is-paused')).toBe(true);
  });
});
