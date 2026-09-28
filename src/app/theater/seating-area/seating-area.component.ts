import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  EventEmitter,
  HostListener,
  inject,
  Input,
  Output,
} from '@angular/core';
import { GameService } from '../game.service';
import { Seat, SeatPosition, SeatRow } from '../theater.service';
import {
  ChairComponent,
  type SeatActivity,
  type SeatInteractionMethod,
  type SeatNavigationDirection,
} from './chair/chair.component';
import { StaffLayerComponent } from './staff-layer/staff-layer.component';
import { PatronLayerComponent } from './patron-layer/patron-layer.component';
import { ConcessionCacheService } from '../services/concession-cache.service';
import { auditoriumRowPerspective, AuditoriumRowPerspective } from './auditorium-perspective';

/** Keys that must not resume the game — Tab needs to keep moving focus
 *  toward the LOBBY button, and the modifier keys are meaningless alone. */
const PAUSE_RESUME_IGNORED_KEYS: ReadonlySet<string> = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta']);

/**
 * Elements that own their own key activation (e.g. the LOBBY button's
 * Enter/Space) — the "press any key to resume" affordance must not pre-empt
 * them. Matched via closest(), not tagName, because chairs are `role="button"`
 * divs (not real buttons) and stay tab-stops while paused; tagName alone
 * would miss them and let a chair's Enter/Space fall through to resumeGame().
 */
const PAUSE_RESUME_INTERACTIVE_SELECTOR = '[role="button"], button, a, input, textarea, select';

@Component({
  selector: 'app-seating-area',
  templateUrl: './seating-area.component.html',
  styleUrls: ['./seating-area.component.scss'],
  standalone: true,
  imports: [ChairComponent, StaffLayerComponent, PatronLayerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SeatingAreaComponent {
  public gameService = inject(GameService);
  private concessionCache = inject(ConcessionCacheService);
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  @Input() seatsData: SeatRow[] = [];
  @Input() activeSeat: SeatPosition | null = null;
  @Input() paused = false;

  @Output() seatHovered = new EventEmitter<{ seat: Seat | null }>();
  @Output() seatSelected = new EventEmitter<{ seat: Seat; interaction: SeatInteractionMethod }>();

  private keyboardSeat: SeatPosition | null = null;

  /**
   * True when the seatUpgrade concession has been purchased at least once.
   *
   * Note: getOwned() is called inside computed() on each change-detection cycle
   * but ConcessionCacheService.getOwned is a synchronous snapshot read, not a
   * signal. The computed result is therefore a snapshot that refreshes only
   * when Angular re-evaluates this component. Valid because SeatingAreaComponent
   * is recreated whenever the lobby (purchase UI) closes.
   */
  readonly isVelvetActive = computed(() => this.concessionCache.getOwned('seatUpgrade') >= 1);

  /**
   * Get total number of rows in the theater grid
   */
  get totalRows(): number {
    return this.seatsData.length || 8;
  }

  /**
   * Get total seats per row (left + right sides)
   */
  get seatsPerRow(): number {
    if (!this.seatsData.length) return 8;
    const firstRow = this.seatsData[0];
    return (firstRow?.leftSeats?.length || 4) + (firstRow?.rightSeats?.length || 4);
  }

  /** True when the moving target sits anywhere in this row: the row is
   *  raised above its siblings so the target halo isn't painted under the
   *  next row's carpet (each perspective-scaled row is a stacking context). */
  rowHasTarget(rowIndex: number): boolean {
    return this.activeSeat !== null && this.activeSeat.rowIndex === rowIndex + 1;
  }

  isActiveSeat(side: string, rowIndex: number, seatIndex: number): boolean {
    return (
      this.activeSeat !== null &&
      this.activeSeat.side === side &&
      this.activeSeat.rowIndex === rowIndex + 1 &&
      this.activeSeat.seatIndex === seatIndex
    );
  }

  isKeyboardSeat(seat: Seat): boolean {
    const keyboardSeat = this.findSeat(this.keyboardSeat) ?? this.firstSeat();
    return keyboardSeat ? this.isSameSeat(keyboardSeat, seat) : false;
  }

  handleSeatFocus(seat: Seat): void {
    this.keyboardSeat = this.toPosition(seat);
  }

  moveKeyboardFocus(seat: Seat, direction: SeatNavigationDirection): void {
    const currentRowIndex = this.seatsData.findIndex((row) => row.rowIndex === seat.rowIndex);
    if (currentRowIndex < 0) return;

    const currentRow = this.rowSeats(this.seatsData[currentRowIndex]);
    const currentColumn = currentRow.findIndex((candidate) => this.isSameSeat(candidate, seat));
    if (currentColumn < 0) return;

    let target = seat;
    if (direction === 'left') {
      target = currentRow[Math.max(0, currentColumn - 1)] ?? seat;
    } else if (direction === 'right') {
      target = currentRow[Math.min(currentRow.length - 1, currentColumn + 1)] ?? seat;
    } else if (direction === 'home') {
      target = currentRow[0] ?? seat;
    } else if (direction === 'end') {
      target = currentRow[currentRow.length - 1] ?? seat;
    } else {
      const rowOffset = direction === 'up' ? -1 : 1;
      const targetRowIndex = Math.max(0, Math.min(this.seatsData.length - 1, currentRowIndex + rowOffset));
      const targetRow = this.rowSeats(this.seatsData[targetRowIndex]);
      target = targetRow[Math.min(currentColumn, targetRow.length - 1)] ?? seat;
    }

    this.keyboardSeat = this.toPosition(target);
    queueMicrotask(() => {
      const key = `${target.side}-${target.rowIndex}-${target.seatIndex}`;
      this.element.nativeElement.querySelector<HTMLElement>(`[data-seat-key="${key}"]`)?.focus();
    });
  }

  handleSeatEvent({ eventType, seat, interaction }: SeatActivity): void {
    if (eventType === 'hover') {
      this.seatHovered.emit({ seat });
    } else if (eventType === 'select' && seat) {
      this.seatSelected.emit({ seat, interaction });
    }
  }

  handleAreaClick(): void {
    if (this.paused) {
      this.gameService.resumeGame();
    }
  }

  /**
   * "Click or press any key to resume" — the paused scrim's stated affordance.
   * Tab is excluded so a keyboard user can still reach the LOBBY button
   * instead of being resumed before they get there; keys landing on an
   * interactive element (that button) are left for the element to handle.
   */
  @HostListener('document:keydown', ['$event'])
  handlePausedKeydown(event: KeyboardEvent): void {
    if (!this.paused) return;
    // TheaterComponent's own Escape-to-pause listener is also bound to
    // document:keydown and runs first (it is registered in the constructor,
    // before this component ever mounts). Angular flushes the pending
    // change-detection microtask between same-node listener invocations, so
    // `this.paused` above is already true for the very keydown that just
    // caused the pause — without this check, that same keypress would
    // immediately satisfy "any key resumes" and undo its own pause in the
    // same tick. TheaterComponent marks that keydown with preventDefault()
    // specifically so this listener can back off here; a later, separate
    // Escape press (or any other key/click) is a fresh event and resumes
    // normally.
    if (event.defaultPrevented) return;
    if (PAUSE_RESUME_IGNORED_KEYS.has(event.key)) return;
    // Escape is not an activation key any focusable element inside the
    // paused overlay owns — chairs only handle Enter/Space/arrow navigation
    // (see ChairComponent), and the LOBBY button has no Escape handler of
    // its own. Unlike Enter/Space, which must be left for a focused
    // interactive element to handle, Escape always resumes regardless of
    // where keyboard focus currently sits (most often a chair, since
    // Escape-to-pause does not move focus).
    if (event.key !== 'Escape') {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest(PAUSE_RESUME_INTERACTIVE_SELECTOR)) return;
    }
    this.gameService.resumeGame();
  }

  trackByRow(_index: number, item: SeatRow): string | undefined {
    return item ? `row${item.rowIndex}` : undefined;
  }

  trackBySeat(_index: number, seat: Seat): string {
    return `${seat.side}-${seat.rowIndex}-${seat.seatIndex}`;
  }

  rowPerspective(rowIndex: number): AuditoriumRowPerspective {
    return auditoriumRowPerspective(rowIndex, this.seatsData.length);
  }

  clearHover(): void {
    this.seatHovered.emit({ seat: null });
  }

  private firstSeat(): Seat | null {
    const firstRow = this.seatsData[0];
    return firstRow ? (this.rowSeats(firstRow)[0] ?? null) : null;
  }

  private findSeat(position: SeatPosition | null): Seat | null {
    if (!position) return null;
    const row = this.seatsData.find((candidate) => candidate.rowIndex === position.rowIndex);
    const seats = position.side === 'left' ? row?.leftSeats : row?.rightSeats;
    return seats?.find((seat) => seat.seatIndex === position.seatIndex) ?? null;
  }

  private rowSeats(row: SeatRow): Seat[] {
    return [...row.leftSeats, ...row.rightSeats];
  }

  private toPosition(seat: Seat): SeatPosition {
    return { side: seat.side, rowIndex: seat.rowIndex, seatIndex: seat.seatIndex };
  }

  private isSameSeat(first: SeatPosition, second: SeatPosition): boolean {
    return first.side === second.side && first.rowIndex === second.rowIndex && first.seatIndex === second.seatIndex;
  }
}
