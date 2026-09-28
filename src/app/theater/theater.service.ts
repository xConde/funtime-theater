import { Injectable, OnDestroy, signal } from '@angular/core';
import { fromEvent, Subject, Subscription } from 'rxjs';
import { debounceTime } from 'rxjs/operators';

export interface SeatRow {
  rowIndex: number;
  seatsPerRow: number;
  leftSeats: Seat[];
  rightSeats: Seat[];
}

export interface Seat extends SeatPosition {
  showSoda: boolean;
  showPopcorn: boolean;
}

export interface SeatPosition {
  side: 'left' | 'right';
  rowIndex: number;
  seatIndex: number;
}

export interface SeatEvent {
  side: 'left' | 'right';
  seatIndex: number;
  rowIndex: number;
  message: string;
}

const MIN_SEATS_PER_ROW = 4;
const MAX_SEATS_PER_ROW = 16;
const MIN_ROWS = 2;
const MAX_ROWS = 16;

@Injectable({
  providedIn: 'root',
})
export class TheaterService implements OnDestroy {
  readonly seatsData = signal<SeatRow[]>([]);
  readonly seatsPerRow = signal(0);

  hoverEventSubject = new Subject<SeatEvent | null>();
  public hoverEvent$ = this.hoverEventSubject.asObservable().pipe(debounceTime(85));

  readonly selectedSeat = signal<SeatPosition | null>(null);
  readonly activeSeat = signal<SeatPosition | null>(null);

  private resizeSubscription!: Subscription;

  previousActiveSeat: SeatPosition | null = null;
  private clickedCount = 0;

  constructor() {
    this.subscribeToResize();
  }

  ngOnDestroy(): void {
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }
  }

  private subscribeToResize(): void {
    this.resizeSubscription = fromEvent(window, 'resize')
      .pipe(debounceTime(100))
      .subscribe(() => {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.handleResize(width, height);
      });

    const width = window.innerWidth;
    const height = window.innerHeight;
    this.handleResize(width, height);
  }

  handleResize(width: number, height: number): void {
    const seatsPerRow = this.determineSeatsPerRow(width, height);
    const rows = this.determineRows(width, height);

    const currentSeatsPerRow = this.seatsPerRow();
    const currentRows = this.seatsData().length;
    if (seatsPerRow !== currentSeatsPerRow || rows !== currentRows) {
      this.seatsPerRow.set(seatsPerRow);
      this.prepareSeatsData(rows, seatsPerRow);
      this.reconcileSeatPositions();
    }
  }

  private determineSeatsPerRow(width: number, height: number): number {
    let calc: number;

    // Example breakpoints:
    if (width < 768) {
      // MOBILE
      calc = Math.floor(width / 125);
    } else if (height < 900 && width < 1024) {
      // SHORT scenario
      calc = Math.floor(width / 145);
    } else {
      // DESKTOP
      calc = Math.floor(width / 160);
    }

    return this.makeEven(this.clamp(calc, MIN_SEATS_PER_ROW, MAX_SEATS_PER_ROW));
  }

  private determineRows(width: number, height: number): number {
    let calc: number;

    if (width < 768) {
      // MOBILE
      calc = Math.floor(height / 140);
    } else if (height < 900 && width < 1024) {
      // SHORT scenario
      calc = Math.floor(height / 150);
    } else {
      // DESKTOP - more rows with reduced screen height
      calc = Math.floor(height / 155);
    }

    return this.clamp(calc, MIN_ROWS, MAX_ROWS);
  }

  private clamp(value: number, minVal: number, maxVal: number): number {
    return Math.max(minVal, Math.min(value, maxVal));
  }

  private makeEven(value: number): number {
    return value % 2 !== 0 ? value + 1 : value;
  }

  private prepareSeatsData(rows: number, seatsPerRow: number): void {
    const oldSeatsData = this.seatsData();
    const newSeatsData = Array.from({ length: rows }, (_, rowIndex) => {
      const existingSeats = (side: 'left' | 'right'): Seat[] => {
        const existingRow: SeatRow = oldSeatsData[rowIndex];
        return existingRow ? this.filterSeatsBySide(existingRow, side) : [];
      };

      return {
        rowIndex: rowIndex + 1,
        seatsPerRow: seatsPerRow,
        leftSeats: this.prepareSeatSide('left', rowIndex + 1, seatsPerRow, existingSeats('left')),
        rightSeats: this.prepareSeatSide('right', rowIndex + 1, seatsPerRow, existingSeats('right')),
      };
    });
    this.seatsData.set(newSeatsData);
  }

  prepareSeatSide(side: 'left' | 'right', rowIndex: number, seatsPerRow: number, existingSeats: Seat[]): Seat[] {
    const length = side === 'left' ? Math.ceil(seatsPerRow / 2) : Math.floor(seatsPerRow / 2);
    return Array.from({ length }, (_, index) => {
      const existingSeat = existingSeats ? existingSeats[index] : undefined;
      return {
        side,
        seatIndex: index + 1,
        rowIndex,
        showSoda: existingSeat ? existingSeat.showSoda : Math.random() < 0.25,
        showPopcorn: existingSeat ? existingSeat.showPopcorn : Math.random() < 0.25,
      };
    });
  }

  public hoverSeat(seat: Seat): void {
    const sideLabel = seat.side === 'left' ? 'Left' : 'Right';
    const messageBase = `Row: ${seat.rowIndex}, ${sideLabel} seat: ${seat.seatIndex}`;
    const activeSeat = this.activeSeat();

    const message =
      activeSeat &&
      activeSeat.side === seat.side &&
      activeSeat.seatIndex === seat.seatIndex &&
      activeSeat.rowIndex === seat.rowIndex
        ? `${messageBase} - Score!`
        : messageBase;
    const seatEvent: SeatEvent = {
      side: seat.side,
      seatIndex: seat.seatIndex,
      rowIndex: seat.rowIndex,
      message,
    };
    this.hoverEventSubject.next(seatEvent);
  }

  public clearHover(): void {
    this.hoverEventSubject.next(null);
  }

  selectSeat(seat: Seat): void {
    const currentSeat = this.selectedSeat();

    // Check all properties including side to avoid false toggles
    const isSameSeat =
      currentSeat &&
      currentSeat.side === seat.side &&
      currentSeat.seatIndex === seat.seatIndex &&
      currentSeat.rowIndex === seat.rowIndex;

    if (isSameSeat) {
      this.selectedSeat.set(null);
    } else {
      this.selectedSeat.set(seat);
    }
  }

  private reconcileSeatPositions(): void {
    const selected = this.selectedSeat();
    if (selected && !this.isAvailableSeat(selected)) {
      this.selectedSeat.set(null);
    }

    const active = this.activeSeat();
    if (active && !this.isAvailableSeat(active)) {
      this.previousActiveSeat = null;
      this.activeSeat.set(this.getRandomSeat());
      return;
    }

    if (this.previousActiveSeat && !this.isAvailableSeat(this.previousActiveSeat)) {
      this.previousActiveSeat = null;
    }
  }

  private isAvailableSeat(position: SeatPosition): boolean {
    const row = this.seatsData()[position.rowIndex - 1];
    if (!row || position.seatIndex < 1) return false;
    const sideSeats = this.filterSeatsBySide(row, position.side);
    return position.seatIndex <= sideSeats.length;
  }

  public filterSeatsBySide(row: SeatRow, side: 'left' | 'right'): Seat[] {
    return side === 'left' ? row.leftSeats : row.rightSeats;
  }

  /**
   * Pick a random seat that is not the one we just left. When a preference is
   * supplied (for example, seats that have a patron in them), keep the first
   * non-previous seat that matches it, but fall back to any non-previous seat so
   * a sparse preference can never loop forever or starve the picker.
   */
  public getRandomSeat(prefer?: (seat: SeatPosition) => boolean): SeatPosition | null {
    const seatsData = this.seatsData();
    if (seatsData.length === 0) return null;

    const MAX_ATTEMPTS = 24;
    let fallback: SeatPosition | null = null;
    let chosen: SeatPosition | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const randomRowIndex = Math.floor(Math.random() * seatsData.length);
      const randomRow = seatsData[randomRowIndex];
      const side: 'left' | 'right' = Math.random() < 0.5 ? 'left' : 'right';
      const sideSeats = this.filterSeatsBySide(randomRow, side);
      if (sideSeats.length === 0) continue;

      const randomSeatIndex = Math.floor(Math.random() * sideSeats.length);
      if (this.isPreviouslyActiveSeat(side, randomRowIndex, randomSeatIndex)) continue;

      const candidate: SeatPosition = { side, rowIndex: randomRowIndex + 1, seatIndex: randomSeatIndex + 1 };
      fallback = candidate;
      if (!prefer || prefer(candidate)) {
        chosen = candidate;
        break;
      }
    }

    const selectedSeat = chosen ?? fallback;
    if (!selectedSeat) return null;

    // Record the pick for the no-repeat guard, but leave applying it to the
    // active-seat signal to the caller — the Memory sequence builds with this
    // method and must not flash the live seat while it assembles the sequence.
    this.previousActiveSeat = selectedSeat;
    return selectedSeat;
  }

  private isPreviouslyActiveSeat(side: string, rowIndex: number, seatIndex: number): boolean {
    return (
      this.previousActiveSeat !== null &&
      this.previousActiveSeat.side === side &&
      this.previousActiveSeat.rowIndex === rowIndex + 1 &&
      this.previousActiveSeat.seatIndex === seatIndex + 1
    );
  }

  public getClickedCount(): number {
    return this.clickedCount;
  }

  public incrementClickedCount(): void {
    this.clickedCount++;
  }

  public restoreClickedCount(clickedCount: number): void {
    this.clickedCount = Math.max(0, Math.floor(clickedCount));
  }

  public resetClickedCount(): void {
    this.clickedCount = 0;
  }

  public getSeatsData(): SeatRow[] {
    return this.seatsData();
  }

  public getActiveSeat(): SeatPosition | null {
    return this.activeSeat();
  }

  public setActiveSeat(seat: SeatPosition | null): void {
    this.activeSeat.set(seat);
  }

  public attractSeatsToPosition(cursorPosition: { x: number; y: number }, range: number): SeatPosition | null {
    if (!cursorPosition || range <= 0) return null;

    const activeSeat = this.getActiveSeat();
    if (!activeSeat) return null;

    const seatsData = this.getSeatsData();
    const currentRow = activeSeat.rowIndex - 1;

    const minRow = Math.max(0, currentRow - range);
    const maxRow = Math.min(seatsData.length - 1, currentRow + range);

    let closestSeat: SeatPosition | null = null;
    let minDistance = Infinity;

    for (let rowIndex = minRow; rowIndex <= maxRow; rowIndex++) {
      const row = seatsData[rowIndex];

      row.leftSeats.forEach((seat, seatIndex) => {
        const distance = this.calculateDistanceToCursor(seat, cursorPosition);
        if (distance < minDistance) {
          minDistance = distance;
          closestSeat = {
            side: 'left',
            rowIndex: rowIndex + 1,
            seatIndex: seatIndex + 1,
          };
        }
      });

      row.rightSeats.forEach((seat, seatIndex) => {
        const distance = this.calculateDistanceToCursor(seat, cursorPosition);
        if (distance < minDistance) {
          minDistance = distance;
          closestSeat = {
            side: 'right',
            rowIndex: rowIndex + 1,
            seatIndex: seatIndex + 1,
          };
        }
      });
    }

    if (closestSeat && closestSeat !== activeSeat) {
      const moveChance = 0.3;
      if (Math.random() < moveChance) {
        return closestSeat;
      }
    }

    return null;
  }

  private calculateDistanceToCursor(seat: Seat, cursorPosition: { x: number; y: number }): number {
    const seatX = seat.side === 'left' ? seat.seatIndex : this.seatsPerRow() - seat.seatIndex;
    const seatY = seat.rowIndex;

    const normalizedCursorX = cursorPosition.x / 100;
    const normalizedCursorY = cursorPosition.y / 100;

    return Math.sqrt(Math.pow(seatX - normalizedCursorX, 2) + Math.pow(seatY - normalizedCursorY, 2));
  }
}
