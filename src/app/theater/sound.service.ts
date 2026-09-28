import { Injectable, OnDestroy } from '@angular/core';
import { noteFrequency } from './utils/equal-temperament';
import {
  COMBO_SOUND,
  CUE_SOUND,
  MALLET_VOICE,
  MASTER_LIMITER,
  REWARD_SOUND,
  SEAT_SOUND,
  SEAT_SOUND_INTENSITY,
  type SeatSoundIntensity,
  SOUND_DEFAULTS,
  STORAGE_KEYS,
  WRONG_CLICK_SOUND,
} from './theater.constants';
import { Seat, SeatPosition } from './theater.service';

export enum SoundType {
  Click = 'click',
  Success = 'success',
  GameOver = 'gameOver',
  LevelUp = 'levelUp',
  PowerUp = 'powerUp',
}

/** The one-shot cues callers ask for by name. */
export type SoundPresetName = 'pickupCoin' | 'blipSelect' | 'powerUp';

/** Musical note representation */
interface MusicalNote {
  name: string;
  frequency: number;
  octave: number;
}

/** One partial of a struck voice: a ratio of the fundamental with its own decay. */
interface StrikePartial {
  readonly ratio: number;
  readonly gain: number;
  readonly decayScale: number;
  readonly waveType: OscillatorType;
}

/** Everything that varies between one strike of the mallet voice and another. */
interface StrikeSpec {
  /** Peak gain of the whole voice, before the SFX bus applies the user's volume. */
  readonly gain: number;
  /** Ring time of the fundamental. Upper partials scale their own decay from this. */
  readonly seconds: number;
  readonly attack: number;
  /** How many of MALLET_VOICE.PARTIALS sound. Fewer is plainer. */
  readonly partialCount?: number;
  /** Gain of the sub-octave body partial. Zero leaves it out entirely. */
  readonly subGain?: number;
  /** Multiplier on every partial's ring time, for a voice that should linger. */
  readonly decayFactor?: number;
  /** -1 (left) to 1 (right). */
  readonly pan?: number;
  /** Onset delay on the AudioContext's own timeline, never a JS timer. */
  readonly delaySeconds?: number;
  /** Pitch the voice falls or rises to across its ring time. */
  readonly glideToFrequency?: number;
}

/** A short melodic figure: the same voice struck once per scale degree. */
interface FigureSpec {
  readonly semitones: readonly number[];
  readonly gain: number;
  readonly seconds: number;
  /** Ring time of the closing note, which is left to sound out under whatever follows. */
  readonly finalSeconds: number;
  readonly gapSeconds: number;
  readonly attack: number;
  readonly partialCount: number;
  readonly subGain?: number;
}

/** A figure plus the octave its root sits in. */
type CueSpec = FigureSpec & { readonly rootOctave: number };

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SEMITONES_PER_OCTAVE = 12;

/** A neutral multiplier, for a voice that rings for exactly its stated time. */
const UNCHANGED_DECAY = 1;

@Injectable({
  providedIn: 'root',
})
export class SoundService implements OnDestroy {
  private isMuted = false;
  private masterVolume: number = SOUND_DEFAULTS.MASTER_VOLUME;
  private sfxVolume: number = SOUND_DEFAULTS.SFX_VOLUME;
  private musicVolume: number = SOUND_DEFAULTS.MUSIC_VOLUME;

  // Professional Web Audio API components
  private audioContext: AudioContext;
  private masterCompressor: DynamicsCompressorNode;
  // Dedicated bus for the procedural film score (FilmScoreService), so it
  // automatically follows mute/volume without either service polling the other.
  private musicBus: GainNode;
  // The matching bus for every effect. Carrying the user's levels here rather
  // than folding them into each voice's peak is what keeps an envelope's shape
  // identical at every volume setting.
  private sfxBus: GainNode;
  // Fired once ensureAudioContextResumed() actually resumes the context — the
  // ONE resume path, already triggered by every SFX hover/select. Lets a
  // caller queue work that needs a running context without a second resume
  // attempt of its own.
  private readonly audioResumeListeners = new Set<() => void>();

  /**
   * AudioContext time of the previous hover. Hovers arrive one per seat the
   * cursor crosses, so how recently the last one sounded is what separates a
   * deliberate hover from a sweep across the grid.
   */
  private lastHoverAt = Number.NEGATIVE_INFINITY;

  constructor() {
    // Initialize Web Audio API (with legacy Safari prefix fallback)
    const AudioCtx =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) {
      throw new Error('Web Audio API is not supported in this browser');
    }
    this.audioContext = new AudioCtx();

    this.masterCompressor = this.setupMasterCompressor();
    this.musicBus = this.audioContext.createGain();
    this.musicBus.connect(this.masterCompressor);
    this.sfxBus = this.audioContext.createGain();
    this.sfxBus.connect(this.masterCompressor);

    this.loadSettings();
    this.applyMusicBusGain();
    this.applySfxBusGain();
  }

  /**
   * The master limiter. Set as a safety net against a pathological pile-up of
   * voices, not as a mix tool: both buses pass through it, so any level it acts
   * on ducks the film score along with the effect that triggered it.
   */
  private setupMasterCompressor(): DynamicsCompressorNode {
    const compressor = this.audioContext.createDynamicsCompressor();
    const now = this.audioContext.currentTime;

    compressor.threshold.setValueAtTime(MASTER_LIMITER.THRESHOLD_DB, now);
    compressor.knee.setValueAtTime(MASTER_LIMITER.KNEE_DB, now);
    compressor.ratio.setValueAtTime(MASTER_LIMITER.RATIO, now);
    compressor.attack.setValueAtTime(MASTER_LIMITER.ATTACK_SECONDS, now);
    compressor.release.setValueAtTime(MASTER_LIMITER.RELEASE_SECONDS, now);

    compressor.connect(this.audioContext.destination);

    return compressor;
  }

  /**
   * Keep the music bus in sync with mute/volume settings. Ramped with
   * setTargetAtTime (not setValueAtTime) so a mute toggle or slider drag
   * mid-score never produces an audible click.
   */
  private applyMusicBusGain(): void {
    if (this.audioContext.state === 'closed') return;
    const target = this.isMuted ? 0 : this.musicVolume * this.masterVolume;
    this.musicBus.gain.setTargetAtTime(target, this.audioContext.currentTime, SOUND_DEFAULTS.BUS_RAMP_SECONDS);
  }

  /** The same treatment for the effects bus, so a volume change never clicks either. */
  private applySfxBusGain(): void {
    if (this.audioContext.state === 'closed') return;
    const target = this.isMuted ? 0 : this.sfxVolume * this.masterVolume;
    this.sfxBus.gain.setTargetAtTime(target, this.audioContext.currentTime, SOUND_DEFAULTS.BUS_RAMP_SECONDS);
  }

  /**
   * Resume AudioContext if suspended (required after user gesture)
   */
  private async ensureAudioContextResumed(): Promise<void> {
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
        this.audioResumeListeners.forEach((listener) => listener());
      } catch {
        // Silently fail if resume fails (e.g., no user gesture yet)
      }
    }
  }

  // ============================================
  // The mallet voice
  // ============================================

  /**
   * Strike one note. Every sound in the theater is made of these.
   *
   * The envelope has an attack and then nothing but decay, which is what a
   * struck object does and what a held tone does not. Its floor is a fraction
   * of the voice's own peak rather than an absolute level, so a quiet voice
   * fades exactly like a loud one instead of ramping up into a floor above it,
   * and the last ramp reaches true zero so an oscillator never stops on a live
   * sample.
   *
   * Partial gains are normalised by their own sum, so peak level is whatever
   * the caller asked for no matter how many partials stack. That is what lets
   * a sound grow richer without growing louder: the oscillators all start at
   * phase 0 and sum coherently, so an un-normalised stack would be a level
   * increase as much as a timbre change.
   */
  private strike(frequency: number, spec: StrikeSpec): void {
    if (this.isMuted || spec.gain <= 0) return;

    // Ensure AudioContext is resumed (may be suspended until user gesture)
    void this.ensureAudioContextResumed();
    if (this.audioContext.state === 'closed') return;

    const {
      gain,
      seconds,
      attack,
      partialCount = MALLET_VOICE.PARTIALS.length,
      subGain = 0,
      decayFactor = UNCHANGED_DECAY,
      pan = 0,
      delaySeconds = 0,
      glideToFrequency,
    } = spec;

    const partials: StrikePartial[] = MALLET_VOICE.PARTIALS.slice(0, partialCount);
    if (subGain > 0) {
      partials.push({
        ratio: MALLET_VOICE.SUB_RATIO,
        gain: subGain,
        decayScale: MALLET_VOICE.SUB_DECAY_SCALE,
        waveType: 'sine',
      });
    }

    const partialGainSum = partials.reduce((sum, partial) => sum + partial.gain, 0);
    if (partialGainSum <= 0) return;

    const t0 = this.audioContext.currentTime + delaySeconds;

    // One panner for the whole strike. Every partial routes through it, so no
    // part of a voice can end up centred while the rest of it is placed.
    let destination: AudioNode = this.sfxBus;
    let panner: StereoPannerNode | null = null;
    if (pan !== 0) {
      panner = this.audioContext.createStereoPanner();
      panner.pan.setValueAtTime(pan, t0);
      panner.connect(this.sfxBus);
      destination = panner;
    }

    // The panner outlives its partials, so it is released by the last of them
    // to finish rather than by any one in particular.
    let sounding = partials.length;
    const releasePanner = (): void => {
      sounding -= 1;
      if (sounding === 0 && panner) {
        panner.disconnect();
      }
    };

    for (const partial of partials) {
      const oscillator = this.audioContext.createOscillator();
      oscillator.type = partial.waveType;
      oscillator.frequency.setValueAtTime(frequency * partial.ratio, t0);
      if (glideToFrequency !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(glideToFrequency * partial.ratio, t0 + seconds);
      }

      const voiceGain = this.audioContext.createGain();
      const peak = (gain * partial.gain) / partialGainSum;
      // A partial has to outlast its own attack, or its decay would be
      // scheduled to end before the attack that precedes it on the same param.
      const ringSeconds = Math.max(
        seconds * partial.decayScale * decayFactor,
        attack + MALLET_VOICE.ENVELOPE_ZERO_SECONDS
      );
      const silentAt = t0 + ringSeconds + MALLET_VOICE.ENVELOPE_ZERO_SECONDS;

      voiceGain.gain.setValueAtTime(0, t0);
      voiceGain.gain.linearRampToValueAtTime(peak, t0 + attack);
      voiceGain.gain.exponentialRampToValueAtTime(peak * MALLET_VOICE.ENVELOPE_FLOOR, t0 + ringSeconds);
      voiceGain.gain.linearRampToValueAtTime(0, silentAt);

      oscillator.connect(voiceGain);
      voiceGain.connect(destination);

      // Web Audio keeps a stopped node attached until it is disconnected, and
      // this context is suspended rather than closed on route-leave, so a voice
      // that is not released here stays on the bus for the life of the tab.
      oscillator.onended = (): void => {
        oscillator.disconnect();
        voiceGain.disconnect();
        releasePanner();
      };

      oscillator.start(t0);
      oscillator.stop(silentAt);
    }
  }

  /** Strike a figure one note at a time, spaced on the AudioContext's timeline. */
  private playFigure(rootFrequency: number, figure: FigureSpec, pan = 0, baseDelaySeconds = 0): void {
    const lastIndex = figure.semitones.length - 1;

    figure.semitones.forEach((semitone, index) => {
      this.strike(rootFrequency * Math.pow(2, semitone / SEMITONES_PER_OCTAVE), {
        gain: figure.gain,
        seconds: index === lastIndex ? figure.finalSeconds : figure.seconds,
        attack: figure.attack,
        partialCount: figure.partialCount,
        subGain: figure.subGain,
        pan,
        delaySeconds: baseDelaySeconds + index * figure.gapSeconds,
      });
    });
  }

  /**
   * Play one of the fixed cues, rooted on the octave it declares.
   * `delaySeconds` pushes the whole figure's onset later on the AudioContext's
   * own timeline (never a JS timer) — used to stagger a cue against one that
   * just played, e.g. the new-high-score sting against GAME_OVER.
   */
  private playCue(cue: CueSpec, delaySeconds = 0): void {
    this.playFigure(noteFrequency(cue.rootOctave, 0), cue, 0, delaySeconds);
  }

  /**
   * The jackpot layer, on a fixed root rather than the streak's. Root, fifth
   * and octave are consonant with every rung of the combo ladder, so the two
   * sounds land as one chord without either knowing what the other played.
   */
  private playReward(): void {
    this.playFigure(noteFrequency(REWARD_SOUND.ROOT_OCTAVE, 0), {
      semitones: REWARD_SOUND.ARPEGGIO_SEMITONES,
      gain: REWARD_SOUND.GAIN,
      seconds: REWARD_SOUND.SECONDS,
      finalSeconds: REWARD_SOUND.FINAL_SECONDS,
      gapSeconds: REWARD_SOUND.ARPEGGIO_GAP_SECONDS,
      attack: REWARD_SOUND.ATTACK_SECONDS,
      partialCount: MALLET_VOICE.PARTIALS.length,
    });
  }

  // ============================================
  // The seat grid
  // ============================================

  /**
   * Get musical properties for a seat
   * Each seat has a unique musical note based on position
   */
  getSeatMusicalProperties(seat: Seat | SeatPosition, totalRows: number, _seatsPerRow: number): MusicalNote {
    // Map row to octave (spread across MIN_OCTAVE-MAX_OCTAVE)
    const octave =
      SEAT_SOUND.MIN_OCTAVE +
      Math.floor(((seat.rowIndex - 1) / Math.max(totalRows - 1, 1)) * (SEAT_SOUND.MAX_OCTAVE - SEAT_SOUND.MIN_OCTAVE));

    // Map seat position to scale degree (seatIndex - 1 so seat 1 hits the root)
    const scaleDegree = (seat.seatIndex - 1) % SEAT_SOUND.SCALE_SEMITONES.length;
    const semitone = SEAT_SOUND.SCALE_SEMITONES[scaleDegree];

    return {
      name: NOTE_NAMES[semitone % SEMITONES_PER_OCTAVE],
      frequency: noteFrequency(octave, semitone),
      octave,
    };
  }

  /**
   * Play seat-specific sound with musical properties
   * @param isActive - Whether this is the currently active/selected seat (for volume control)
   */
  playSeatSound(
    seat: Seat | SeatPosition,
    intensity: SeatSoundIntensity = SEAT_SOUND_INTENSITY.HOVER,
    totalRows: number = 10,
    seatsPerRow: number = 12,
    isActive: boolean = false
  ): void {
    if (this.isMuted) return;

    const note = this.getSeatMusicalProperties(seat, totalRows, seatsPerRow);
    const pan = seat.side === 'left' ? -SEAT_SOUND.STEREO_SPREAD : SEAT_SOUND.STEREO_SPREAD;

    switch (intensity) {
      case SEAT_SOUND_INTENSITY.HOVER:
        this.playHover(note.frequency, seat, isActive, pan);
        return;
      case SEAT_SOUND_INTENSITY.SELECT:
        // A press is felt low: the reward it earns lands within a frame of it,
        // and register is what keeps the two apart when timing cannot.
        this.strike(note.frequency * Math.pow(2, SEAT_SOUND.SELECT_OCTAVE_OFFSET), {
          gain: SEAT_SOUND.SELECT_GAIN,
          seconds: SEAT_SOUND.SELECT_SECONDS,
          attack: SEAT_SOUND.SELECT_ATTACK_SECONDS,
          partialCount: SEAT_SOUND.SELECT_PARTIAL_COUNT,
          pan,
        });
        return;
      case SEAT_SOUND_INTENSITY.SUCCESS:
        this.playFigure(
          note.frequency,
          {
            semitones: SEAT_SOUND.SUCCESS_SEMITONES,
            gain: SEAT_SOUND.SUCCESS_GAIN,
            seconds: SEAT_SOUND.SUCCESS_SECONDS,
            finalSeconds: SEAT_SOUND.SUCCESS_FINAL_SECONDS,
            gapSeconds: SEAT_SOUND.SUCCESS_GAP_SECONDS,
            attack: SEAT_SOUND.SUCCESS_ATTACK_SECONDS,
            partialCount: SEAT_SOUND.SUCCESS_PARTIAL_COUNT,
          },
          pan
        );
        return;
    }
  }

  /**
   * The most repeated sound in the game. A treat on the seat rings a little
   * longer instead of sounding louder or gaining a partial, so every seat in
   * the grid stays at one level.
   */
  private playHover(frequency: number, seat: Seat | SeatPosition, isActive: boolean, pan: number): void {
    const hasTreat =
      ('showPopcorn' in seat && seat.showPopcorn === true) || ('showSoda' in seat && seat.showSoda === true);
    const seatGain = isActive
      ? SEAT_SOUND.HOVER_GAIN_ACTIVE
      : SEAT_SOUND.HOVER_GAIN_ACTIVE * SEAT_SOUND.HOVER_GAIN_INACTIVE_FACTOR;

    this.strike(frequency, {
      gain: seatGain * this.hoverCrowdFactor(),
      seconds: SEAT_SOUND.HOVER_SECONDS,
      attack: SEAT_SOUND.HOVER_ATTACK_SECONDS,
      partialCount: SEAT_SOUND.HOVER_PARTIAL_COUNT,
      decayFactor: hasTreat ? SEAT_SOUND.TREAT_DECAY_FACTOR : UNCHANGED_DECAY,
      pan,
    });
  }

  /**
   * How much of its gain this hover has earned, from how long it has been since
   * the last one. A sweep across the grid becomes a shimmer, a deliberate hover
   * stays full, and jitter on a seat boundary stops re-striking one pitch at
   * full level.
   */
  private hoverCrowdFactor(): number {
    const now = this.audioContext.currentTime;
    const sinceLastHover = now - this.lastHoverAt;
    this.lastHoverAt = now;

    return Math.min(1, Math.max(SEAT_SOUND.HOVER_CROWD_FLOOR, sinceLastHover / SEAT_SOUND.HOVER_CROWD_SECONDS));
  }

  // ============================================
  // Game sounds
  // ============================================

  /**
   * The streak sound, climbing a pentatonic ladder. A longer streak is paid in
   * pitch, ring time and body, never in level: a sound that gets louder the
   * better you play is the one that ends a session early.
   */
  playComboSound(comboCount: number, _multiplier: number): void {
    if (this.isMuted) return;

    // The ladder runs on comboCount alone. The multiplier is one of the things
    // that streak already earned, so escalating on it too would pay the same
    // streak twice.
    const step = Math.max(0, Math.min(comboCount - 1, COMBO_SOUND.LADDER_MAX_STEP));
    const climb = step / COMBO_SOUND.LADDER_MAX_STEP;
    const rungs = COMBO_SOUND.LADDER_SEMITONES.length;

    this.strike(
      noteFrequency(
        COMBO_SOUND.LADDER_ROOT_OCTAVE + Math.floor(step / rungs),
        COMBO_SOUND.LADDER_SEMITONES[step % rungs]
      ),
      {
        gain: COMBO_SOUND.GAIN,
        seconds: COMBO_SOUND.SECONDS_MIN + climb * COMBO_SOUND.SECONDS_SPAN,
        attack: COMBO_SOUND.ATTACK_SECONDS,
        subGain: climb * COMBO_SOUND.SUB_GAIN_MAX,
      }
    );
  }

  /**
   * A press that caught nothing. One falling voice with weight under it, kept
   * free of upper partials so a miss reads as a shrug rather than a buzzer.
   */
  playWrongClick(): void {
    this.strike(WRONG_CLICK_SOUND.START_HZ, {
      gain: WRONG_CLICK_SOUND.GAIN,
      seconds: WRONG_CLICK_SOUND.SECONDS,
      attack: WRONG_CLICK_SOUND.ATTACK_SECONDS,
      partialCount: WRONG_CLICK_SOUND.PARTIAL_COUNT,
      subGain: WRONG_CLICK_SOUND.SUB_GAIN,
      glideToFrequency: WRONG_CLICK_SOUND.END_HZ,
    });
  }

  /** Play a named one-shot cue. */
  playPreset(presetName: SoundPresetName): void {
    switch (presetName) {
      case 'pickupCoin':
        this.playReward();
        return;
      case 'blipSelect':
        this.playCue(CUE_SOUND.BLIP);
        return;
      case 'powerUp':
        this.playCue(CUE_SOUND.POWER_UP);
        return;
    }
  }

  /** `delaySeconds` schedules the cue later on the AudioContext's own timeline
   *  (never a JS timer) — see playCue(). Defaults to an immediate onset. */
  play(soundType: SoundType, delaySeconds = 0): void {
    switch (soundType) {
      case SoundType.Click:
        this.playCue(CUE_SOUND.CLICK, delaySeconds);
        return;
      case SoundType.Success:
        this.playCue(CUE_SOUND.SUCCESS, delaySeconds);
        return;
      case SoundType.GameOver:
        this.playCue(CUE_SOUND.GAME_OVER, delaySeconds);
        return;
      case SoundType.LevelUp:
        this.playCue(CUE_SOUND.LEVEL_UP, delaySeconds);
        return;
      case SoundType.PowerUp:
        this.playCue(CUE_SOUND.POWER_UP, delaySeconds);
        return;
    }
  }

  // ============================================
  // Settings
  // ============================================

  toggleMute(): void {
    this.isMuted = !this.isMuted;
    this.applyMusicBusGain();
    this.applySfxBusGain();
    this.saveSettings();
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.applyMusicBusGain();
    this.applySfxBusGain();
    this.saveSettings();
  }

  setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    this.applySfxBusGain();
    this.saveSettings();
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.applyMusicBusGain();
    this.saveSettings();
  }

  private loadSettings(): void {
    const settings = window.localStorage.getItem(STORAGE_KEYS.SOUND_SETTINGS);
    if (settings) {
      const parsed = JSON.parse(settings) as {
        isMuted?: boolean;
        masterVolume?: number;
        sfxVolume?: number;
        musicVolume?: number;
      };
      this.isMuted = parsed.isMuted ?? false;
      this.masterVolume = parsed.masterVolume ?? SOUND_DEFAULTS.MASTER_VOLUME;
      this.sfxVolume = parsed.sfxVolume ?? SOUND_DEFAULTS.SFX_VOLUME;
      this.musicVolume = parsed.musicVolume ?? SOUND_DEFAULTS.MUSIC_VOLUME;
    }
  }

  private saveSettings(): void {
    const settings = {
      isMuted: this.isMuted,
      masterVolume: this.masterVolume,
      sfxVolume: this.sfxVolume,
      musicVolume: this.musicVolume,
    };
    window.localStorage.setItem(STORAGE_KEYS.SOUND_SETTINGS, JSON.stringify(settings));
  }

  get isSoundMuted(): boolean {
    return this.isMuted;
  }

  /** The shared AudioContext, for FilmScoreService to build its own nodes on. */
  get scoreContext(): AudioContext {
    return this.audioContext;
  }

  /** Where FilmScoreService should connect its output — inherits mute/volume for free. */
  get scoreOutput(): GainNode {
    return this.musicBus;
  }

  /** Resume the shared AudioContext from a user gesture, for callers outside SoundService. */
  resumeAudio(): void {
    void this.ensureAudioContextResumed();
  }

  /**
   * Notify a caller once the shared AudioContext actually resumes, so a
   * consumer whose own resumeAudio() call landed with no gesture on the
   * stack (e.g. a setTimeout callback) can queue its start instead of
   * attempting a second, independent resume. Returns an unsubscribe closure.
   */
  onAudioResumed(listener: () => void): () => void {
    this.audioResumeListeners.add(listener);
    return () => this.audioResumeListeners.delete(listener);
  }

  /**
   * Cleanup method to prevent memory leaks.
   *
   * There are no JS timers to clear: every note, including the ones spaced out
   * across a figure, is scheduled on the AudioContext's own timeline, so a
   * teardown mid-figure has nothing left pointing at this service.
   */
  ngOnDestroy(): void {
    // Release OS audio resources. suspend() is used instead of close() because
    // SoundService is providedIn:'root' — it may be reused after the theater
    // route is re-entered. A suspended context is resumed automatically by
    // ensureAudioContextResumed() on the next user interaction.
    if (this.audioContext.state !== 'closed') {
      void this.audioContext.suspend();
    }
  }
}
