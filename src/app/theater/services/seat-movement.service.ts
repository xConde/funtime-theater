import { Injectable, OnDestroy } from '@angular/core';
import { interval, Subscription } from 'rxjs';
import { SeatPosition, TheaterService } from '../theater.service';
import { ConcessionCacheService } from './concession-cache.service';
import { ScoringService } from './scoring.service';
import { ProgressionService } from './progression.service';
import { BEAT_AGITATION, effectivePowerUpLevel, SPECIAL_EFFECTS } from '../theater.constants';
import { GameMode } from '../game.service';
import { FilmShowtimeService } from '../film/film-showtime.service';

const DEFAULT_TICK = SPECIAL_EFFECTS.SEAT_MOVEMENT_TICK;

@Injectable({
  providedIn: 'root',
})
export class SeatMovementService implements OnDestroy {
  private seatMovementSubscription: Subscription | null = null;
  private hopCooldown = false;
  private cursorPosition: { x: number; y: number } | null = null;

  private currentGameMode: GameMode = GameMode.Classic;
  private slowTimeActive = false;
  private endlessSpeedMultiplier = 1;
  private carnivalMode = false;
  private carnivalPattern = 0;

  constructor(
    private theaterService: TheaterService,
    private scoringService: ScoringService,
    private progressionService: ProgressionService,
    private concessionCache: ConcessionCacheService,
    private filmShowtime: FilmShowtimeService
  ) {}

  ngOnDestroy(): void {
    this.clearSeatMovement();
  }

  setGameMode(mode: GameMode): void {
    this.currentGameMode = mode;
  }

  setSlowTimeActive(active: boolean): void {
    this.slowTimeActive = active;
  }

  setEndlessSpeedMultiplier(multiplier: number): void {
    this.endlessSpeedMultiplier = multiplier;
  }

  setCarnivalMode(enabled: boolean): void {
    this.carnivalMode = enabled;
    if (!enabled) {
      this.carnivalPattern = 0;
    }
  }

  getEndlessSpeedMultiplier(): number {
    return this.endlessSpeedMultiplier;
  }

  updateCursorPosition(x: number, y: number): void {
    this.cursorPosition = { x, y };
  }

  startSeatMovement(): void {
    this.clearSeatMovement();

    let tickSpeed: number = DEFAULT_TICK;

    if (this.currentGameMode === GameMode.Endless || this.currentGameMode === GameMode.Finale) {
      tickSpeed = Math.max(SPECIAL_EFFECTS.MIN_TICK_SPEED, DEFAULT_TICK / this.endlessSpeedMultiplier);
    } else if (this.currentGameMode === GameMode.Midnight) {
      tickSpeed = DEFAULT_TICK / 2;
    } else if (this.currentGameMode === GameMode.Carnival) {
      tickSpeed = DEFAULT_TICK / 1.5;
    }

    if (this.slowTimeActive) {
      tickSpeed = tickSpeed * 2;
    }

    const difficultyModifier = this.progressionService.getDifficultyModifier();
    tickSpeed = Math.max(SPECIAL_EFFECTS.MIN_TICK_SPEED, tickSpeed / difficultyModifier);

    this.seatMovementSubscription = interval(tickSpeed).subscribe(() => {
      if (this.hopCooldown) {
        this.hopCooldown = false;
        return;
      }
      const movementChance = this.getMovementChance();
      if (Math.random() < movementChance) {
        this.moveActiveSeat();
        this.hopCooldown = true;
      }
    });
  }

  clearSeatMovement(): void {
    if (this.seatMovementSubscription) {
      this.seatMovementSubscription.unsubscribe();
      this.seatMovementSubscription = null;
    }
    this.hopCooldown = false;
  }

  getMovementChance(): number {
    const multiplier = this.scoringService.getMultiplier();
    const MIN_MOVEMENT_CHANCE = 0.05;
    const MAX_MOVEMENT_CHANCE = 0.85;
    const MAX_MULTIPLIER_FOR_MAX_CHANCE = 70;
    const cappedMultiplier = Math.min(multiplier, MAX_MULTIPLIER_FOR_MAX_CHANCE);

    const multiplierProportion = (cappedMultiplier - 1) / (MAX_MULTIPLIER_FOR_MAX_CHANCE - 1);
    const normalizedProportion = Math.max(0, Math.min(multiplierProportion, 1));
    const chanceRange = MAX_MOVEMENT_CHANCE - MIN_MOVEMENT_CHANCE;
    const chanceIncrease = chanceRange * normalizedProportion;

    const difficultyModifier = this.progressionService.getDifficultyModifier();
    const baseChance = MIN_MOVEMENT_CHANCE + chanceIncrease;

    // The film drives the floor: the active seat is more restless during the
    // intense beats and calmer in the quiet ones. Defaults to neutral (0.5) when
    // no film is on, so non-screening callers are unaffected. The hard cap still
    // applies, so an agitated seat never becomes unhittable.
    const intensity = this.filmShowtime.currentBeat()?.intensity ?? 0.5;
    const beatAgitation = BEAT_AGITATION.MIN_FACTOR + BEAT_AGITATION.INTENSITY_SPAN * intensity;

    return Math.min(MAX_MOVEMENT_CHANCE, baseChance * difficultyModifier * beatAgitation);
  }

  private moveActiveSeat(): void {
    const activeSeat = this.theaterService.getActiveSeat();
    if (!activeSeat) {
      return;
    }

    const magneticRange = effectivePowerUpLevel('magneticField', this.concessionCache.getOwned('magneticField'));
    if (magneticRange > 0 && this.cursorPosition) {
      const magneticSeat = this.theaterService.attractSeatsToPosition(this.cursorPosition, magneticRange);
      if (magneticSeat) {
        this.theaterService.setActiveSeat(magneticSeat);
        return;
      }
    }

    let direction: string;

    if (this.carnivalMode) {
      const pattern = ['right', 'down', 'left', 'up'];
      const currentPattern = this.carnivalPattern;
      direction = pattern[currentPattern % 4];
      this.carnivalPattern = currentPattern + 1;
    } else {
      const directions = ['up', 'down', 'left', 'right'];
      direction = directions[Math.floor(Math.random() * directions.length)];
    }

    const newSeat = this.hopSeatPosition(activeSeat, direction);

    if (newSeat) {
      this.theaterService.setActiveSeat(newSeat);
    }
  }

  hopSeatPosition(seat: SeatPosition, direction: string): SeatPosition | null {
    const seatsData = this.theaterService.getSeatsData();
    const totalRows = seatsData.length;
    let { rowIndex, seatIndex, side } = seat;

    const row = seatsData[rowIndex - 1];
    if (!row) {
      return null;
    }

    switch (direction) {
      case 'up':
        rowIndex = rowIndex - 1;
        if (rowIndex < 1) {
          rowIndex = totalRows;
        }
        break;
      case 'down':
        rowIndex = rowIndex + 1;
        if (rowIndex > totalRows) {
          rowIndex = 1;
        }
        break;
      case 'left':
      case 'right': {
        const isRight = direction === 'right';
        let currentSideSeats = side === 'left' ? row.leftSeats : row.rightSeats;
        const oppositeSide = side === 'left' ? 'right' : 'left';
        const oppositeSideSeats = oppositeSide === 'left' ? row.leftSeats : row.rightSeats;

        seatIndex += isRight ? 1 : -1;

        if (seatIndex < 1 || seatIndex > currentSideSeats.length) {
          if (!oppositeSideSeats || oppositeSideSeats.length === 0) {
            return null;
          }
          side = oppositeSide;
          currentSideSeats = oppositeSideSeats;
          seatIndex = isRight ? 1 : currentSideSeats.length;
        }
        break;
      }
      default:
        return null;
    }

    return {
      side,
      rowIndex,
      seatIndex,
    };
  }
}
