import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { Seat } from '../theater.service';

/**
 * Event interfaces for power-up system
 */
export interface AutoClickEvent {
  seat: Seat;
}

export interface MagneticFieldUpdateEvent {
  seat: Seat;
  range: number;
}

export interface UsherClickEvent {
  seat: Seat;
  value: number;
  percent: number;
}

export interface BlackoutEvent {
  duration: number;
}

export interface PassiveIncomeTickEvent {
  amount: number;
}

export interface TicketStormFireEvent {
  amount: number;
}

/**
 * Centralized service for power-up and game event communication
 * Replaces window-level custom events with proper Angular service pattern
 */
@Injectable({
  providedIn: 'root',
})
export class PowerUpEventsService {
  /**
   * Emitted when usher (auto-clicker) clicks a seat
   */
  private autoClickSubject = new Subject<AutoClickEvent>();
  public readonly autoClick$ = this.autoClickSubject.asObservable();

  /**
   * Emitted when magnetic field power-up updates
   */
  private magneticFieldUpdateSubject = new Subject<MagneticFieldUpdateEvent>();
  public readonly magneticFieldUpdate$ = this.magneticFieldUpdateSubject.asObservable();

  /**
   * Emitted when usher successfully clicks a seat
   */
  private usherClickSubject = new Subject<UsherClickEvent>();
  public readonly usherClick$ = this.usherClickSubject.asObservable();

  /**
   * Emitted when blackout event occurs (Midnight Madness mode)
   */
  private blackoutSubject = new Subject<BlackoutEvent>();
  public readonly blackout$ = this.blackoutSubject.asObservable();

  /**
   * Emitted when usher needs the next random seat selected (replaces callback)
   */
  private selectNextSeatSubject = new Subject<void>();
  public readonly selectNextSeat$ = this.selectNextSeatSubject.asObservable();

  /**
   * Emitted when usher needs seat movement cleared before processing (replaces callback)
   */
  private clearSeatMovementSubject = new Subject<void>();
  public readonly clearSeatMovement$ = this.clearSeatMovementSubject.asObservable();

  /**
   * Emitted each time the passive income interval fires and adds score.
   * Payload is the amount added this tick.
   */
  private passiveIncomeTickSubject = new Subject<PassiveIncomeTickEvent>();
  public readonly passiveIncomeTick$ = this.passiveIncomeTickSubject.asObservable();

  /**
   * Emitted each time the ticket storm interval fires and adds score.
   * Payload is the amount added this fire.
   */
  private ticketStormFireSubject = new Subject<TicketStormFireEvent>();
  public readonly ticketStormFire$ = this.ticketStormFireSubject.asObservable();

  constructor() {}

  /**
   * Trigger auto-click event
   */
  triggerAutoClick(seat: Seat): void {
    this.autoClickSubject.next({ seat });
  }

  /**
   * Update magnetic field
   */
  updateMagneticField(seat: Seat, range: number): void {
    this.magneticFieldUpdateSubject.next({ seat, range });
  }

  /**
   * Trigger usher click event
   */
  triggerUsherClick(seat: Seat, value: number, percent: number): void {
    this.usherClickSubject.next({ seat, value, percent });
  }

  /**
   * Trigger blackout event
   */
  triggerBlackout(duration: number): void {
    this.blackoutSubject.next({ duration });
  }

  /**
   * Request next random seat selection (usher flow)
   */
  requestNextSeat(): void {
    this.selectNextSeatSubject.next();
  }

  /**
   * Request seat movement clear (usher flow)
   */
  requestClearSeatMovement(): void {
    this.clearSeatMovementSubject.next();
  }

  /**
   * Emit a passive income tick event.
   * Called from PowerUpLifecycleService at the exact point income is added.
   */
  triggerPassiveIncomeTick(amount: number): void {
    this.passiveIncomeTickSubject.next({ amount });
  }

  /**
   * Emit a ticket storm fire event.
   * Called from PowerUpLifecycleService at the exact point storm tickets are added.
   */
  triggerTicketStormFire(amount: number): void {
    this.ticketStormFireSubject.next({ amount });
  }
}
