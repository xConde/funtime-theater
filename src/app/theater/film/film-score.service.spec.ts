import { TestBed } from '@angular/core/testing';
import { GameStateMachineService } from '../services/game-state-machine.service';
import { SoundService } from '../sound.service';
import { FILM_SCORE } from '../theater.constants';
import { noteFrequency } from '../utils/equal-temperament';
import { FilmScoreService } from './film-score.service';
import { FilmShowtimeService } from './film-showtime.service';
import type { Film, FilmBeat, FilmGenre } from './film.model';

function makeBeat(kind: FilmBeat['kind'], startsAt: number, duration: number, intensity: number): FilmBeat {
  return { kind, startsAt, duration, intensity, label: kind };
}

/** A hand-built Film so beat kinds are exact, instead of searching generated content for one. */
function makeFilm(seed: number, genre: FilmGenre, beats: FilmBeat[]): Film {
  return {
    seed,
    genre,
    title: 'Test Feature',
    tagline: 'A test tagline',
    starring: 'Test Star',
    directedBy: 'Test Director',
    year: 1962,
    runtimeSeconds: beats.reduce((sum, beat) => sum + beat.duration, 0),
    beats,
    poster: {
      palette: ['#000000', '#ffffff', '#ff0000'],
      motif: 'claw',
      layout: 'tall',
      grain: 0.4,
    },
  };
}

/**
 * A fresh AudioContext in this Karma/ChromeHeadless setup starts 'suspended'
 * (no user gesture on the stack). Tests that aren't about the autoplay queue
 * itself force 'running' so start() builds the graph synchronously.
 */
function forceContextRunning(ctx: AudioContext): void {
  Object.defineProperty(ctx, 'state', { get: () => 'running', configurable: true });
}

describe('FilmScoreService', () => {
  let service: FilmScoreService;
  let showtime: FilmShowtimeService;
  let sound: SoundService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [FilmScoreService, FilmShowtimeService, GameStateMachineService, SoundService],
    });
    service = TestBed.inject(FilmScoreService);
    showtime = TestBed.inject(FilmShowtimeService);
    sound = TestBed.inject(SoundService);
  });

  afterEach(() => {
    // Always tear down so oscillators from one spec never bleed into the next.
    service.ngOnDestroy();
    showtime.endShow();

    // Specs stub ctx.state as an OWN property to exercise the suspended and
    // closed paths. Drop the stub before teardown: SoundService guards its
    // suspend on `state !== 'closed'`, and a stub still claiming 'running'
    // makes it suspend a context that is really closed, which throws.
    const ctx = sound.scoreContext;
    Reflect.deleteProperty(ctx, 'state');

    // SoundService suspends rather than closes because in the app it is
    // providedIn:'root' and is reused when the theater route is re-entered.
    // That reasoning does not carry over here: every spec builds its own
    // service, so suspending would pile live contexts up in the single Karma
    // page for the whole run, and browsers cap how many one page may hold.
    // Closing first also leaves ngOnDestroy's guard reading a true 'closed'.
    if (ctx.state !== 'closed') {
      void ctx.close();
    }
    sound.ngOnDestroy();
  });

  it('is created without throwing', () => {
    expect(service).toBeTruthy();
  });

  describe('start/stop lifecycle', () => {
    it('start() then stop() does not throw', () => {
      showtime.startShow(60, 1);
      forceContextRunning(sound.scoreContext);
      expect(() => service.start()).not.toThrow();
      expect(() => service.stop()).not.toThrow();
    });

    it('stop() twice in a row does not throw', () => {
      showtime.startShow(60, 1);
      forceContextRunning(sound.scoreContext);
      service.start();
      expect(() => service.stop()).not.toThrow();
      expect(() => service.stop()).not.toThrow();
    });

    it('stop() before start() does not throw', () => {
      expect(() => service.stop()).not.toThrow();
    });

    it('is idempotent: a second start() call does not rebuild the graph', () => {
      showtime.startShow(60, 1);
      forceContextRunning(sound.scoreContext);
      service.start();
      const firstRootOsc = service['rootOsc'];
      expect(firstRootOsc).not.toBeNull();

      service.start();

      expect(service['rootOsc']).toBe(firstRootOsc);
    });
  });

  describe('audio graph', () => {
    it('builds oscillators that are all sine or triangle (regression guard: no harsh waveforms)', () => {
      showtime.startShow(60, 2);
      forceContextRunning(sound.scoreContext);
      service.start();

      const oscillators = [service['rootOsc'], service['fifthOsc'], service['colorOsc'], service['lfoOsc']];
      for (const osc of oscillators) {
        expect(osc).not.toBeNull();
        expect(['sine', 'triangle']).toContain(osc!.type);
      }
    });
  });

  describe('colorInterval voicing', () => {
    it('drives the color voice to a different interval on a spike beat than on a calm beat', () => {
      const calmBeat = makeBeat('calm', 0, 10, 0.2);
      const spikeBeat = makeBeat('spike', 10, 10, 0.9);
      const film = makeFilm(42, 'horror', [calmBeat, spikeBeat]);

      // Set the showtime signals directly: a hand-built film guarantees the
      // exact beat kinds under test, rather than searching generated content
      // for a seed that happens to produce both a calm and a spike beat.
      showtime['_currentFilm'].set(film);
      showtime['_filmSecond'].set(0);
      TestBed.tick();

      forceContextRunning(sound.scoreContext);
      // A (faked) 'running' context never actually renders audio in headless
      // Chrome, so AudioParam.value reads never reflect scheduled automation
      // — assert on what was scheduled instead, via a spy on the shared
      // AudioParam prototype method.
      const setValueSpy = spyOn(AudioParam.prototype, 'setValueAtTime').and.callThrough();
      service.start();
      const colorOsc = service['colorOsc'] as OscillatorNode;
      const initialCall = setValueSpy.calls.all().find((call) => call.object === colorOsc.frequency);
      const calmFrequency = initialCall?.args[0] as number;

      const rampSpy = spyOn(colorOsc.frequency, 'exponentialRampToValueAtTime').and.callThrough();
      showtime['_filmSecond'].set(10);
      TestBed.tick();

      expect(rampSpy).toHaveBeenCalled();
      const targetFrequency = rampSpy.calls.mostRecent().args[0];
      expect(targetFrequency).not.toBeCloseTo(calmFrequency, 5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Resuming must land on whatever beat is actually playing, not restart
  // from the calm/minimum state and glide up. buildGraph() sets every voice's
  // frequency/filter/LFO with setValueAtTime (instant) from the current beat;
  // only bedGain fades in. This is the owner-requested priority.
  // ─────────────────────────────────────────────────────────────────────────
  describe('resume lands on the correct beat', () => {
    it('a real pause/resume cycle (start, stop, start again) lands on the still-current climax beat, not calm', () => {
      const calmBeat = makeBeat('calm', 0, 10, 0.2);
      const climaxBeat = makeBeat('climax', 10, 10, 0.95);
      const film = makeFilm(7, 'scifi', [calmBeat, climaxBeat]);

      showtime['_currentFilm'].set(film);
      showtime['_filmSecond'].set(0);

      forceContextRunning(sound.scoreContext);
      service.start(); // starts on calm

      // The round advances into the climax beat while the score is running.
      showtime['_filmSecond'].set(10);
      TestBed.tick();

      service.stop(); // pause mid-climax

      const createOscSpy = spyOn(sound.scoreContext, 'createOscillator').and.callThrough();
      // A (faked) 'running' context never actually renders audio in headless
      // Chrome, so AudioParam.value reads never reflect scheduled automation
      // — assert on what was scheduled instead, via a spy on the shared
      // AudioParam prototype method.
      const setValueSpy = spyOn(AudioParam.prototype, 'setValueAtTime').and.callThrough();

      service.start(); // resume — the beat is still climax, unchanged since pause

      const colorOsc = service['colorOsc'] as OscillatorNode;
      const lowpass = service['lowpass'] as BiquadFilterNode;
      const bedGain = service['bedGain'] as GainNode;
      const colorFreqCall = setValueSpy.calls.all().find((call) => call.object === colorOsc.frequency);
      const filterCall = setValueSpy.calls.all().find((call) => call.object === lowpass.frequency);
      const bedGainCall = setValueSpy.calls.all().find((call) => call.object === bedGain.gain);

      // scifi: { root: 4, octave: 2, third: 5 }. climax's color interval is
      // the octave (12); calm/title-card/credits use the genre's third (5).
      const expectedClimaxColorFreq = noteFrequency(2 + 1, 4 + 12);
      const calmColorFreq = noteFrequency(2 + 1, 4 + 5);
      const expectedFilterHz = FILM_SCORE.FILTER_HZ_MIN + 0.95 * FILM_SCORE.FILTER_HZ_SPAN;

      expect(colorFreqCall?.args[0]).toBeCloseTo(expectedClimaxColorFreq, 5);
      expect(colorFreqCall?.args[0]).not.toBeCloseTo(calmColorFreq, 5);
      expect(filterCall?.args[0]).toBeCloseTo(expectedFilterHz, 5);

      // Only bedGain ramps in on entry — it must start at 0, not jump to the
      // beat's target and definitely not to BED_GAIN_MIN.
      expect(bedGainCall?.args[0]).toBe(0);

      // No entry stinger: buildGraph creates exactly 4 permanent oscillators
      // (root, fifth, color, lfo). A climax normally fires a 3-note stinger;
      // resuming mid-climax must not re-trigger it.
      expect(createOscSpy).toHaveBeenCalledTimes(4);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // start() is called from a setTimeout callback with no user gesture on the
  // stack. A fresh AudioContext here starts 'suspended', so start() must
  // queue behind SoundService's ONE resume path instead of building a silent
  // (or throwing) graph. Resume success is simulated by invoking the
  // registered listener directly — waiting on a real AudioContext.resume()
  // in headless Chrome is not deterministic enough for a unit test.
  // ─────────────────────────────────────────────────────────────────────────
  describe('autoplay queueing (no gesture on the stack)', () => {
    function fireResumeListeners(): void {
      sound['audioResumeListeners'].forEach((listener: () => void) => listener());
    }

    it('queues instead of building when the AudioContext is suspended', () => {
      showtime.startShow(60, 1);
      expect(sound.scoreContext.state).toBe('suspended');

      service.start();

      expect(service['pendingStart']).toBeTrue();
      expect(service['running']).toBeFalse();
      expect(service['rootOsc']).toBeNull();
    });

    it('builds the graph once the resume listener fires', () => {
      showtime.startShow(60, 1);
      service.start();
      expect(service['pendingStart']).toBeTrue();

      fireResumeListeners();

      expect(service['pendingStart']).toBeFalse();
      expect(service['running']).toBeTrue();
      expect(service['rootOsc']).not.toBeNull();
    });

    it('a second start() call while queued does not queue twice or throw', () => {
      showtime.startShow(60, 1);
      service.start();
      expect(() => service.start()).not.toThrow();
      expect(service['pendingStart']).toBeTrue();
      expect(service['running']).toBeFalse();
    });

    it('stop() cancels a queued start that never began', () => {
      showtime.startShow(60, 1);
      service.start();
      expect(service['pendingStart']).toBeTrue();

      service.stop();
      expect(service['pendingStart']).toBeFalse();

      // The resume can still land later (real browsers resolve resume()
      // asynchronously); it must not resurrect a cancelled start.
      fireResumeListeners();

      expect(service['running']).toBeFalse();
      expect(service['rootOsc']).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A stop() landing mid-fade-in must duck out. Without cancelling first, the
  // fade-in's own rise stays scheduled and the bed climbs to full volume
  // before it falls, so pausing right after a round starts swells audibly.
  // ─────────────────────────────────────────────────────────────────────────
  describe('stop() during the fade-in', () => {
    it('cancels the scheduled rise and ramps to a true zero', () => {
      showtime.startShow(60, 1);
      forceContextRunning(sound.scoreContext);
      service.start();

      const bedGain = service['bedGain'] as GainNode;
      const cancelSpy = spyOn(bedGain.gain, 'cancelScheduledValues').and.callThrough();
      const rampSpy = spyOn(bedGain.gain, 'linearRampToValueAtTime').and.callThrough();

      service.stop();

      expect(cancelSpy).toHaveBeenCalled();
      // A true zero, not the 0.0001 an exponential ramp would need: the
      // fade-in anchors the gain at exactly 0, and an exponential ramp
      // starting from zero is undefined and cuts instead of fading.
      expect(rampSpy.calls.mostRecent().args[0]).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // The spike stinger's thump is voiced an octave under the bed root. Kaiju
  // is the worst case (root octave 1), which unclamped lands near 16 Hz:
  // inaudible, but it still costs headroom through the master compressor.
  // ─────────────────────────────────────────────────────────────────────────
  describe('spike stinger thump floor', () => {
    it('never voices the kaiju thump below the audible floor', () => {
      const calmBeat = makeBeat('calm', 0, 10, 0.2);
      const spikeBeat = makeBeat('spike', 10, 10, 0.9);
      const film = makeFilm(11, 'kaiju', [calmBeat, spikeBeat]);

      showtime['_currentFilm'].set(film);
      showtime['_filmSecond'].set(0);
      TestBed.tick();

      forceContextRunning(sound.scoreContext);
      service.start();

      // Installed after start() so only the stinger's oscillators are captured,
      // never the bed's.
      const createOscSpy = spyOn(sound.scoreContext, 'createOscillator').and.callThrough();
      const setValueSpy = spyOn(AudioParam.prototype, 'setValueAtTime').and.callThrough();

      showtime['_filmSecond'].set(10); // cross into the spike beat, firing its stinger
      TestBed.tick();

      expect(createOscSpy).toHaveBeenCalled();
      const stingerFrequencies = createOscSpy.calls
        .all()
        .map((call) => call.returnValue)
        .flatMap((osc) =>
          setValueSpy.calls
            .all()
            .filter((call) => call.object === osc.frequency)
            .map((call) => call.args[0])
        );

      expect(stingerFrequencies.length).toBeGreaterThan(0);
      for (const frequency of stingerFrequencies) {
        expect(frequency).toBeGreaterThanOrEqual(FILM_SCORE.THUMP_MIN_HZ);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // stop() has to reach the stingers, not only the 4 permanent bed voices. A
  // stinger's osc/gain are created inside scoreNote(), so without the
  // activeStingers registry there is no instance-level reference for stop() to
  // fade, and one fired just before a pause rings on past it. The margin
  // hiding that is thin: the longest stinger tail is 0.65s against
  // FADE_SECONDS' 1.2s, so shortening the fade or lengthening a stinger makes
  // it audible.
  // ─────────────────────────────────────────────────────────────────────────
  // Web Audio keeps a stopped node attached until it is disconnected or the
  // context closes. SoundService only ever suspends its context, so a graph
  // left connected survives the route and the next visit stacks another on top.
  describe('node release', () => {
    it('disconnects the bed once the fade-out has been scheduled and run down', () => {
      showtime.startShow(60, 1);
      forceContextRunning(sound.scoreContext);
      service.start();

      const rootOsc = service['rootOsc'] as OscillatorNode;
      const bedGain = service['bedGain'] as GainNode;
      const disconnectSpy = spyOn(bedGain, 'disconnect').and.callThrough();

      service.stop();
      // onended is what releases the graph on a running context; fire it
      // directly, because a faked 'running' state never advances the real
      // audio clock in headless Chrome.
      rootOsc.onended?.(new Event('ended'));

      expect(disconnectSpy).toHaveBeenCalled();
      expect(service['retiringGraphs'].size).toBe(0);
    });

    it('releases immediately when the context is not running, where onended never arrives', () => {
      showtime.startShow(60, 1);
      forceContextRunning(sound.scoreContext);
      service.start();

      const bedGain = service['bedGain'] as GainNode;
      const disconnectSpy = spyOn(bedGain, 'disconnect').and.callThrough();

      // Route teardown suspends the context moments after stop().
      Object.defineProperty(sound.scoreContext, 'state', { get: () => 'suspended', configurable: true });
      service.stop();

      expect(disconnectSpy).toHaveBeenCalled();
      expect(service['retiringGraphs'].size).toBe(0);
    });
  });

  // stop() clears `running` at once while the bed keeps fading for
  // FADE_SECONDS. A hide/show cycle quicker than that would otherwise build a
  // second bed over the first, and every repeat adds another.
  describe('start() during a fade-out', () => {
    it('cuts the outgoing graph instead of sounding a second bed over it', () => {
      showtime.startShow(60, 1);
      forceContextRunning(sound.scoreContext);
      service.start();

      const firstRoot = service['rootOsc'] as OscillatorNode;
      const stopSpy = spyOn(firstRoot, 'stop').and.callThrough();
      const disconnectSpy = spyOn(firstRoot, 'disconnect').and.callThrough();

      service.stop();
      expect(service['retiringGraphs'].size).toBe(1);

      service.start();

      expect(service['retiringGraphs'].size).toBe(0);
      expect(disconnectSpy).toHaveBeenCalled();
      // Rescheduled to now rather than left on its fade-out deadline.
      expect(stopSpy).toHaveBeenCalledTimes(2);
      expect(service['rootOsc']).not.toBe(firstRoot);
    });
  });

  describe('stop() with an in-flight stinger', () => {
    it('folds a ringing stinger into the same fade-out gesture as the bed', () => {
      const calmBeat = makeBeat('calm', 0, 10, 0.2);
      const spikeBeat = makeBeat('spike', 10, 10, 0.9);
      const film = makeFilm(21, 'horror', [calmBeat, spikeBeat]);

      showtime['_currentFilm'].set(film);
      showtime['_filmSecond'].set(0);
      TestBed.tick();

      forceContextRunning(sound.scoreContext);
      service.start();

      showtime['_filmSecond'].set(10); // spike: fires a 3-note stinger
      TestBed.tick();

      // Read the tracked pairs directly — this is the actual contract stop()
      // must uphold (every in-flight stinger gets torn down), not a
      // side effect inferred from oscillator creation order.
      const activeStingers = service['activeStingers'] as Set<{ osc: OscillatorNode; gain: GainNode }>;
      expect(activeStingers.size).toBeGreaterThan(0);

      const spies = Array.from(activeStingers).map(({ osc, gain }) => ({
        stopSpy: spyOn(osc, 'stop').and.callThrough(),
        cancelSpy: spyOn(gain.gain, 'cancelScheduledValues').and.callThrough(),
        rampSpy: spyOn(gain.gain, 'linearRampToValueAtTime').and.callThrough(),
      }));

      service.stop();

      for (const { stopSpy, cancelSpy, rampSpy } of spies) {
        expect(cancelSpy).toHaveBeenCalled();
        expect(rampSpy).toHaveBeenCalled();
        expect(rampSpy.calls.mostRecent().args[0]).toBe(0);
        expect(stopSpy).toHaveBeenCalled();
      }

      // The registry drains so a later start()/stop() cycle never touches a
      // stinger from a previous round.
      expect(activeStingers.size).toBe(0);
    });
  });

  describe('closed AudioContext', () => {
    it('start() bails without throwing when the AudioContext is closed', () => {
      showtime.startShow(60, 3);
      const ctx = sound.scoreContext;
      Object.defineProperty(ctx, 'state', { get: () => 'closed', configurable: true });

      expect(() => service.start()).not.toThrow();
      expect(service['running']).toBeFalse();
      expect(service['pendingStart']).toBeFalse();
      expect(service['rootOsc']).toBeNull();
    });
  });
});
