import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AudienceService, PatronStyle } from '../../services/audience.service';
import { GameService, GameState } from '../../game.service';
import { Seat, SeatRow, TheaterService } from '../../theater.service';
import { PATRON_ANIMATION } from '../../theater.constants';
import { auditoriumRowPerspective, AuditoriumRowPerspective } from '../auditorium-perspective';

/**
 * The audience. An absolute overlay that fills a seeded share of the chairs
 * with patron silhouettes and lets them react to the film: they flinch at the
 * scares, lean in for the chase, get restless in the quiet (a few light their
 * phones), and lean to a neighbour at a twist. The reaction for the whole house
 * comes from AudienceService.houseReaction(); a per-seat stagger turns it into
 * a wave instead of a synchronized snap.
 *
 * It mirrors the seating-area's flex skeleton (rows, the stairs gap, per-seat
 * slots, and the same per-row scale) so patrons line up with the chairs without
 * any pixel math. Pointer-events stay off so seat clicks pass straight through.
 */
@Component({
  selector: 'app-patron-layer',
  templateUrl: './patron-layer.component.html',
  styleUrls: ['./patron-layer.component.scss'],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: 'pointer-events: none', '[class.is-paused]': 'paused()' },
})
export class PatronLayerComponent {
  private readonly theater = inject(TheaterService);
  private readonly audience = inject(AudienceService);
  private readonly game = inject(GameService);

  /** Freezes the house animations while the game is paused (the film clock stops too). */
  readonly paused = input(false);

  readonly seatsData = this.theater.seatsData;
  readonly houseReaction = this.audience.houseReaction;

  /**
   * Whether the house is on screen. The crowd settles during Starting so the
   * instruction beat reads as an intentional house-lights transition instead
   * of an empty room. It then stays through pauses and game over.
   */
  readonly showHouse = computed(() => {
    const state = this.game.gameState();
    return (
      state === GameState.Starting ||
      state === GameState.Playing ||
      state === GameState.Paused ||
      state === GameState.Ended
    );
  });

  readonly isSettling = computed(() => this.game.gameState() === GameState.Starting);

  /** Same shared projection the seating-area applies to the chairs. */
  rowPerspective(rowIndex: number): AuditoriumRowPerspective {
    return auditoriumRowPerspective(rowIndex, this.seatsData().length);
  }

  occupied(seat: Seat): boolean {
    return this.audience.isOccupied(seat.side, seat.rowIndex, seat.seatIndex);
  }

  hasPhone(seat: Seat): boolean {
    return this.audience.hasPhone(seat.side, seat.rowIndex, seat.seatIndex);
  }

  /** Per-seat screenprint treatment: silhouette, posture, coat, skin, and headwear. */
  patronStyle(seat: Seat): PatronStyle {
    return this.audience.patronStyle(seat.side, seat.rowIndex, seat.seatIndex);
  }

  /** Stagger delay (ms) for this seat's reaction so the room ripples. */
  delayMs(seat: Seat): number {
    return Math.round(
      this.audience.reactionPhase(seat.side, seat.rowIndex, seat.seatIndex) * PATRON_ANIMATION.REACTION_STAGGER_MS
    );
  }

  /** The current target seat's patron dims so the gold highlight reads through. */
  isActiveSeat(seat: Seat): boolean {
    const active = this.theater.activeSeat();
    return (
      active !== null &&
      active.side === seat.side &&
      active.rowIndex === seat.rowIndex &&
      active.seatIndex === seat.seatIndex
    );
  }

  trackRow(_i: number, row: SeatRow): number {
    return row.rowIndex;
  }

  trackSeat(_i: number, seat: Seat): string {
    return `${seat.side}-${seat.rowIndex}-${seat.seatIndex}`;
  }
}
