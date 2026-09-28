import { TestBed } from '@angular/core/testing';
import { SoundService, SoundType } from './sound.service';
import { COMBO_SOUND, MALLET_VOICE, SEAT_SOUND, SOUND_DEFAULTS } from './theater.constants';
import { noteFrequency } from './utils/equal-temperament';
import type { Seat } from './theater.service';

/**
 * SoundService tests.
 *
 * Everything here asserts on what was SCHEDULED, never on a live
 * AudioParam.value: headless Chrome does not render audio for these contexts,
 * so .value reads return Web Audio defaults no matter what automation is on the
 * param. Spying the shared AudioParam prototype methods and reading back the
 * arguments is deterministic, and it is also closer to the contract that
 * matters, since an envelope is the sequence of events it schedules.
 */

const SEMITONES_PER_OCTAVE = 12;
const WARM_WAVEFORMS: OscillatorType[] = ['sine', 'triangle'];

function makeSeat(overrides: Partial<Seat> = {}): Seat {
  return { side: 'left', rowIndex: 4, seatIndex: 3, showSoda: false, showPopcorn: false, ...overrides };
}

/** Records every node and every gain event produced from the moment it is installed. */
interface AudioCapture {
  readonly gains: GainNode[];
  readonly oscillators: OscillatorNode[];
  readonly setValue: jasmine.Spy;
  readonly linear: jasmine.Spy;
  readonly expo: jasmine.Spy;
}

function captureAudio(context: AudioContext): AudioCapture {
  const createGain = spyOn(context, 'createGain').and.callThrough();
  const createOscillator = spyOn(context, 'createOscillator').and.callThrough();

  return {
    get gains(): GainNode[] {
      return createGain.calls.all().map((call) => call.returnValue);
    },
    get oscillators(): OscillatorNode[] {
      return createOscillator.calls.all().map((call) => call.returnValue);
    },
    setValue: spyOn(AudioParam.prototype, 'setValueAtTime').and.callThrough(),
    linear: spyOn(AudioParam.prototype, 'linearRampToValueAtTime').and.callThrough(),
    expo: spyOn(AudioParam.prototype, 'exponentialRampToValueAtTime').and.callThrough(),
  };
}

interface Envelope {
  /** Level the attack ramps up to. */
  peak: number;
  /** Level the decay ends on, before the ramp to silence. */
  floor: number;
  /** Level of the last event scheduled on this voice. */
  finalValue: number;
}

function envelopeOf(capture: AudioCapture, gain: GainNode): Envelope {
  const linears = capture.linear.calls.all().filter((call) => call.object === gain.gain);
  const decays = capture.expo.calls.all().filter((call) => call.object === gain.gain);

  return {
    peak: linears[0].args[0],
    floor: decays[0].args[0],
    finalValue: linears[linears.length - 1].args[0],
  };
}

/** The frequency a voice was struck at, read off its fundamental oscillator. */
function struckFrequency(capture: AudioCapture, oscillator: OscillatorNode): number {
  const call = capture.setValue.calls.all().find((entry) => entry.object === oscillator.frequency);
  return call?.args[0] as number;
}

/** Which scale degree a frequency lands on, ignoring which octave it sits in. */
function scaleDegreeOf(frequency: number): number {
  const semitonesAboveC0 = Math.round(SEMITONES_PER_OCTAVE * Math.log2(frequency / noteFrequency(0, 0)));
  return semitonesAboveC0 % SEMITONES_PER_OCTAVE;
}

/**
 * A never-resumed AudioContext freezes currentTime, so anything that reacts to
 * elapsed time needs the clock driven by hand.
 */
function stubClock(context: AudioContext, read: () => number): void {
  Object.defineProperty(context, 'currentTime', { get: read, configurable: true });
}

describe('SoundService', () => {
  let service: SoundService;
  let context: AudioContext;

  beforeEach(() => {
    window.localStorage.clear();

    TestBed.configureTestingModule({
      providers: [SoundService],
    });

    service = TestBed.inject(SoundService);
    context = service['audioContext'];
  });

  afterEach(() => {
    // Specs stub state and currentTime as OWN properties. Drop them before
    // teardown: ngOnDestroy guards its suspend on `state !== 'closed'`, and a
    // stub still claiming otherwise makes it suspend a context that is really
    // closed, which throws.
    Reflect.deleteProperty(context, 'state');
    Reflect.deleteProperty(context, 'currentTime');

    // The service suspends rather than closes because in the app it is
    // providedIn:'root' and is reused when the theater route is re-entered.
    // That reasoning does not carry over here: every spec builds its own
    // service, so suspending would pile live contexts up in the single Karma
    // page for the whole run, and browsers cap how many one page may hold.
    if (context.state !== 'closed') {
      void context.close();
    }
    service.ngOnDestroy();
    window.localStorage.clear();
  });

  describe('Initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should initialize as not muted by default', () => {
      expect(service.isSoundMuted).toBe(false);
    });
  });

  describe('Mute Functionality', () => {
    it('should toggle mute state', () => {
      expect(service.isSoundMuted).toBe(false);

      service.toggleMute();
      expect(service.isSoundMuted).toBe(true);

      service.toggleMute();
      expect(service.isSoundMuted).toBe(false);
    });

    it('should persist mute state to localStorage', () => {
      service.toggleMute();

      const settingsStr = window.localStorage.getItem('theaterSoundSettings');
      expect(settingsStr).toBeTruthy();

      if (settingsStr) {
        const settings = JSON.parse(settingsStr);
        expect(settings.isMuted).toBe(true);
      }
    });

    it('should load mute state from localStorage on creation', () => {
      // Set up localStorage with muted state
      const settings = { isMuted: true, masterVolume: 0.5, sfxVolume: 0.5, musicVolume: 0.5 };
      window.localStorage.setItem('theaterSoundSettings', JSON.stringify(settings));

      // Create new service instance
      const newService = new SoundService();
      expect(newService.isSoundMuted).toBe(true);
      void newService['audioContext'].close();
    });

    it('schedules no voice at all while muted', () => {
      service.toggleMute();
      const capture = captureAudio(context);

      service.playSeatSound(makeSeat(), 'hover', 8, 12, true);
      service.playComboSound(4, 2);
      service.playWrongClick();
      service.play(SoundType.LevelUp);

      expect(capture.oscillators.length).toBe(0);
    });
  });

  describe('Sound Playback', () => {
    it('should not throw when playing sounds', () => {
      // Just verify the methods don't throw - actual audio is environment-dependent
      expect(() => service.play(SoundType.Click)).not.toThrow();
      expect(() => service.play(SoundType.Success)).not.toThrow();
      expect(() => service.play(SoundType.GameOver)).not.toThrow();
    });

    it('should handle getSeatMusicalProperties without throwing', () => {
      const seat = { side: 'left' as const, rowIndex: 1, seatIndex: 1 };
      expect(() => service.getSeatMusicalProperties(seat, 8, 12)).not.toThrow();

      const result = service.getSeatMusicalProperties(seat, 8, 12);
      expect(result.frequency).toBeGreaterThan(0);
      expect(result.name).toBeTruthy();
    });

    it('gives both sides of the aisle the same scale, so a sweep along a row is never sour', () => {
      for (let seatIndex = 1; seatIndex <= SEAT_SOUND.SCALE_SEMITONES.length * 2; seatIndex++) {
        const left = service.getSeatMusicalProperties({ side: 'left', rowIndex: 4, seatIndex }, 8, 12);
        const right = service.getSeatMusicalProperties({ side: 'right', rowIndex: 4, seatIndex }, 8, 12);

        expect(right.frequency).toBeCloseTo(left.frequency, 9);
        expect(SEAT_SOUND.SCALE_SEMITONES.map((semitone) => semitone % SEMITONES_PER_OCTAVE)).toContain(
          scaleDegreeOf(left.frequency)
        );
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // WS2c fix 2: GameOver, the new-high-score sting, and an achievement sting
  // can all fire in the same endGame() call (every new player's first scoring
  // round). play()'s delaySeconds pushes a cue's onset later on the
  // AudioContext's own timeline so callers can stagger them instead of piling
  // up. Assertions read the SCHEDULED time argument, per this file's header.
  // ─────────────────────────────────────────────────────────────────────────
  describe('play() delaySeconds (sting stagger)', () => {
    it('offsets the cue onset by delaySeconds on the AudioContext timeline', () => {
      stubClock(context, () => 0);
      const capture = captureAudio(context);

      service.play(SoundType.LevelUp, 1.03);

      const firstOscillator = capture.oscillators[0];
      const freqCall = capture.setValue.calls.all().find((entry) => entry.object === firstOscillator.frequency);
      expect(freqCall?.args[1]).toBeCloseTo(1.03, 5);
    });

    it('defaults to an immediate onset when no delay is given', () => {
      stubClock(context, () => 0);
      const capture = captureAudio(context);

      service.play(SoundType.GameOver);

      const firstOscillator = capture.oscillators[0];
      const freqCall = capture.setValue.calls.all().find((entry) => entry.object === firstOscillator.frequency);
      expect(freqCall?.args[1]).toBeCloseTo(0, 5);
    });

    it('adds the delay on top of the AudioContext clock, not in place of it', () => {
      stubClock(context, () => 5);
      const capture = captureAudio(context);

      service.play(SoundType.LevelUp, 1.03);

      const firstOscillator = capture.oscillators[0];
      const freqCall = capture.setValue.calls.all().find((entry) => entry.object === firstOscillator.frequency);
      expect(freqCall?.args[1]).toBeCloseTo(6.03, 5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // The envelope is the whole rework. A decay that ends on an ABSOLUTE level
  // is above a quiet voice's peak, so the quiet voice ramps UP into it and
  // ends louder than it started, and it does so more the lower the user's
  // volume is set. A relative floor cannot invert, at any volume.
  // ─────────────────────────────────────────────────────────────────────────
  describe('strike envelope', () => {
    it('decays to a floor relative to the voice own peak and ends on a true zero', () => {
      const capture = captureAudio(context);

      // The quietest voice in the game: an inactive hover.
      service.playSeatSound(makeSeat(), 'hover', 8, 12, false);

      expect(capture.gains.length).toBe(SEAT_SOUND.HOVER_PARTIAL_COUNT);
      const envelope = envelopeOf(capture, capture.gains[0]);

      expect(envelope.peak).toBeGreaterThan(0);
      expect(envelope.floor).toBeCloseTo(envelope.peak * MALLET_VOICE.ENVELOPE_FLOOR, 12);
      expect(envelope.floor).toBeLessThan(envelope.peak);
      expect(envelope.finalValue).toBe(0);
    });

    it('ends every voice of a stacked strike on a true zero, never on a live sample', () => {
      const capture = captureAudio(context);

      service.playComboSound(COMBO_SOUND.LADDER_MAX_STEP + 1, 4);

      expect(capture.gains.length).toBeGreaterThan(1);
      for (const gain of capture.gains) {
        const envelope = envelopeOf(capture, gain);
        expect(envelope.finalValue).toBe(0);
        expect(envelope.floor).toBeLessThan(envelope.peak);
      }
    });

    it('schedules an identical envelope at any master volume, because level lives on the bus', () => {
      const capture = captureAudio(context);

      service.playComboSound(5, 2);
      const atFullVolume = capture.gains.map((gain) => envelopeOf(capture, gain).peak);

      const before = capture.gains.length;
      service.setMasterVolume(0.1);
      service.playComboSound(5, 2);
      const atLowVolume = capture.gains.slice(before).map((gain) => envelopeOf(capture, gain).peak);

      expect(atLowVolume).toEqual(atFullVolume);
    });

    it('routes user volume through the SFX bus rather than each voice', () => {
      const busGain = service['sfxBus'].gain;
      const setTargetSpy = spyOn(busGain, 'setTargetAtTime').and.callThrough();

      service.setSfxVolume(0.5);

      expect(setTargetSpy).toHaveBeenCalled();
      expect(setTargetSpy.calls.mostRecent().args[0]).toBe(0.5 * SOUND_DEFAULTS.MASTER_VOLUME);

      service.toggleMute();
      expect(setTargetSpy.calls.mostRecent().args[0]).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sawtooth and square are what the rework set out to remove. Exercising
  // every entry point and reading back each oscillator's type catches a harsh
  // waveform reaching the speakers by any route, including one added later.
  // ─────────────────────────────────────────────────────────────────────────
  describe('waveforms', () => {
    it('declares only warm partials', () => {
      for (const partial of MALLET_VOICE.PARTIALS) {
        expect(WARM_WAVEFORMS).toContain(partial.waveType);
      }
    });

    it('strikes every sound in the game on sine or triangle only', () => {
      const capture = captureAudio(context);
      const seat = makeSeat({ showPopcorn: true });

      service.playSeatSound(seat, 'hover', 8, 12, true);
      service.playSeatSound(seat, 'select', 8, 12, true);
      service.playSeatSound(seat, 'success', 8, 12, true);
      for (let comboCount = 1; comboCount <= COMBO_SOUND.LADDER_MAX_STEP + 5; comboCount++) {
        service.playComboSound(comboCount, comboCount);
      }
      service.playWrongClick();
      service.playPreset('pickupCoin');
      service.playPreset('blipSelect');
      service.playPreset('powerUp');
      for (const soundType of Object.values(SoundType)) {
        service.play(soundType);
      }

      expect(capture.oscillators.length).toBeGreaterThan(0);
      for (const oscillator of capture.oscillators) {
        expect(WARM_WAVEFORMS).toContain(oscillator.type);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // The combo sound is heard more than any other during good play. A streak is
  // paid in pitch, ring time and body; paying it in level as well is what makes
  // a long streak tiring, so the ladder's flatness is the contract under test.
  // ─────────────────────────────────────────────────────────────────────────
  describe('combo ladder', () => {
    it('holds one level across the whole ladder and lands every rung on a pentatonic degree', () => {
      const capture = captureAudio(context);
      const rungs: { peak: number; frequency: number }[] = [];
      let gainCursor = 0;
      let oscillatorCursor = 0;

      for (let comboCount = 1; comboCount <= COMBO_SOUND.LADDER_MAX_STEP + 5; comboCount++) {
        service.playComboSound(comboCount, comboCount);

        const gains = capture.gains.slice(gainCursor);
        const oscillators = capture.oscillators.slice(oscillatorCursor);
        gainCursor += gains.length;
        oscillatorCursor += oscillators.length;

        rungs.push({
          // Partials are normalised by their own gain sum, so what the voice
          // peaks at is what the caller asked for, however many stack.
          peak: gains.reduce((total, gain) => total + envelopeOf(capture, gain).peak, 0),
          frequency: struckFrequency(capture, oscillators[0]),
        });
      }

      for (const rung of rungs) {
        expect(rung.peak).toBeCloseTo(COMBO_SOUND.GAIN, 10);
        expect(COMBO_SOUND.LADDER_SEMITONES.map((semitone) => semitone % SEMITONES_PER_OCTAVE)).toContain(
          scaleDegreeOf(rung.frequency)
        );
      }
    });

    it('climbs in pitch to the top rung and then holds it', () => {
      const capture = captureAudio(context);
      const pitches: number[] = [];
      let oscillatorCursor = 0;

      for (let comboCount = 1; comboCount <= COMBO_SOUND.LADDER_MAX_STEP + 5; comboCount++) {
        service.playComboSound(comboCount, 1);
        const oscillators = capture.oscillators.slice(oscillatorCursor);
        oscillatorCursor += oscillators.length;
        pitches.push(struckFrequency(capture, oscillators[0]));
      }

      const topRung = pitches[COMBO_SOUND.LADDER_MAX_STEP];
      for (let step = 1; step <= COMBO_SOUND.LADDER_MAX_STEP; step++) {
        expect(pitches[step]).toBeGreaterThan(pitches[step - 1]);
      }
      for (let step = COMBO_SOUND.LADDER_MAX_STEP; step < pitches.length; step++) {
        expect(pitches[step]).toBeCloseTo(topRung, 9);
      }
      // The ceiling is C6: higher and the octave partial climbs into the ear's
      // most sensitive band.
      expect(topRung).toBeCloseTo(noteFrequency(6, 0), 9);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Hovers arrive one per seat the cursor crosses, so a sweep fires a dozen
  // inside a few hundred milliseconds. Ducking the ones that crowd each other
  // is what turns that burst into a shimmer instead of a machine gun.
  // ─────────────────────────────────────────────────────────────────────────
  describe('hover crowding', () => {
    it('ducks hovers that land inside the crowd window and recovers after it', () => {
      let clock = 10;
      stubClock(context, () => clock);
      const capture = captureAudio(context);
      const seat = makeSeat();

      service.playSeatSound(seat, 'hover', 8, 12, true);
      clock += SEAT_SOUND.HOVER_CROWD_SECONDS / 10;
      service.playSeatSound(seat, 'hover', 8, 12, true);
      clock += SEAT_SOUND.HOVER_CROWD_SECONDS * 2;
      service.playSeatSound(seat, 'hover', 8, 12, true);

      const [idle, crowded, recovered] = capture.gains.map((gain) => envelopeOf(capture, gain).peak);

      expect(idle).toBeCloseTo(SEAT_SOUND.HOVER_GAIN_ACTIVE, 12);
      expect(crowded).toBeLessThan(idle);
      // Ducking bottoms out at the floor rather than fading to nothing, so a
      // sweep still reads as movement across the grid.
      expect(crowded).toBeCloseTo(idle * SEAT_SOUND.HOVER_CROWD_FLOOR, 12);
      expect(recovered).toBeCloseTo(idle, 12);
    });

    it('keeps an inactive seat quieter than the active one at the same spacing', () => {
      let clock = 10;
      stubClock(context, () => clock);
      const capture = captureAudio(context);

      service.playSeatSound(makeSeat(), 'hover', 8, 12, true);
      clock += SEAT_SOUND.HOVER_CROWD_SECONDS * 2;
      service.playSeatSound(makeSeat(), 'hover', 8, 12, false);

      const [active, inactive] = capture.gains.map((gain) => envelopeOf(capture, gain).peak);

      expect(inactive).toBeCloseTo(active * SEAT_SOUND.HOVER_GAIN_INACTIVE_FACTOR, 12);
    });

    it('gives a seat holding a treat ring time rather than level', () => {
      let clock = 10;
      stubClock(context, () => clock);
      const capture = captureAudio(context);

      service.playSeatSound(makeSeat(), 'hover', 8, 12, true);
      clock += SEAT_SOUND.HOVER_CROWD_SECONDS * 2;
      service.playSeatSound(makeSeat({ showPopcorn: true }), 'hover', 8, 12, true);

      const [plainGain, treatGain] = capture.gains;
      expect(envelopeOf(capture, treatGain).peak).toBeCloseTo(envelopeOf(capture, plainGain).peak, 12);

      // Same level, longer ring, each measured from its own onset.
      const ringOf = (gain: GainNode): number => {
        const onset = capture.setValue.calls.all().find((call) => call.object === gain.gain)?.args[1] as number;
        const decayEnd = capture.expo.calls.all().find((call) => call.object === gain.gain)?.args[1] as number;
        return decayEnd - onset;
      };

      expect(ringOf(treatGain)).toBeCloseTo(ringOf(plainGain) * SEAT_SOUND.TREAT_DECAY_FACTOR, 9);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // FIX 2 (T3): AudioContext must be suspended on ngOnDestroy to release OS
  // audio resources. close() is intentionally NOT used because SoundService
  // is providedIn:'root' and can be reused after re-entering the theater
  // route — a suspended context is resumed by ensureAudioContextResumed().
  // ─────────────────────────────────────────────────────────────────────────
  describe('AudioContext cleanup (FIX 2 — resource leak)', () => {
    it('should suspend the AudioContext on ngOnDestroy when it is not already closed', () => {
      const suspendSpy = spyOn(context, 'suspend').and.returnValue(Promise.resolve());

      service.ngOnDestroy();

      expect(suspendSpy).toHaveBeenCalledTimes(1);
    });

    it('should NOT call suspend if the AudioContext is already closed', () => {
      // Simulate a closed context by overriding the state getter.
      Object.defineProperty(context, 'state', { get: () => 'closed', configurable: true });
      const suspendSpy = spyOn(context, 'suspend').and.returnValue(Promise.resolve());

      service.ngOnDestroy();

      expect(suspendSpy).not.toHaveBeenCalled();
    });

    it('builds no nodes on a closed context', () => {
      Object.defineProperty(context, 'state', { get: () => 'closed', configurable: true });
      const capture = captureAudio(context);

      service.playSeatSound(makeSeat(), 'select', 8, 12, true);
      service.playComboSound(3, 1);

      expect(capture.oscillators.length).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Music bus: FilmScoreService connects to scoreOutput and relies on it to
  // track mute/volume automatically. setTargetAtTime ramps asymptotically, so
  // reading .gain.value synchronously never reaches the target — assert on
  // the scheduled target argument instead, which is deterministic.
  // ─────────────────────────────────────────────────────────────────────────
  describe('Music bus (scoreOutput)', () => {
    it('ramps scoreOutput.gain toward 0 on mute', () => {
      const gainParam = service.scoreOutput.gain;
      const setTargetSpy = spyOn(gainParam, 'setTargetAtTime').and.callThrough();

      service.toggleMute();

      expect(setTargetSpy).toHaveBeenCalled();
      expect(setTargetSpy.calls.mostRecent().args[0]).toBe(0);
    });

    it('restores scoreOutput.gain toward the music volume on unmute', () => {
      service.toggleMute(); // mute first
      const gainParam = service.scoreOutput.gain;
      const setTargetSpy = spyOn(gainParam, 'setTargetAtTime').and.callThrough();

      service.toggleMute(); // unmute

      expect(setTargetSpy).toHaveBeenCalled();
      expect(setTargetSpy.calls.mostRecent().args[0]).toBeGreaterThan(0);
    });

    it('re-applies scoreOutput.gain when master or music volume changes', () => {
      const gainParam = service.scoreOutput.gain;
      const setTargetSpy = spyOn(gainParam, 'setTargetAtTime').and.callThrough();

      service.setMasterVolume(0.8);
      expect(setTargetSpy).toHaveBeenCalled();

      service.setMusicVolume(0.6);
      expect(setTargetSpy.calls.count()).toBe(2);
    });
  });
});
