import { effect, inject, Injectable, OnDestroy } from '@angular/core';
import { SoundService } from '../sound.service';
import { FILM_SCORE } from '../theater.constants';
import { FilmShowtimeService } from './film-showtime.service';
import type { BeatKind, FilmBeat, FilmGenre } from './film.model';
import { noteFrequency } from '../utils/equal-temperament';

/** Root pitch, octave, and characteristic color-tone interval per genre. */
interface GenreTonality {
  /** Semitone 0-11, 0 = C. */
  readonly root: number;
  readonly octave: number;
  /** Semitone offset of the genre's color tone (its "third"). */
  readonly third: number;
}

const GENRE_TONALITY: Record<FilmGenre, GenreTonality> = {
  horror: { root: 2, octave: 2, third: 3 }, // D minor
  kaiju: { root: 0, octave: 1, third: 3 }, // C minor, one octave lower — subterranean
  noir: { root: 9, octave: 2, third: 3 }, // A minor
  scifi: { root: 4, octave: 2, third: 5 }, // E suspended fourth
  western: { root: 7, octave: 2, third: 4 }, // G major
  romance: { root: 5, octave: 2, third: 4 }, // F major
};

/** Stinger kinds. The rest of BeatKind only ever glides the color voice. */
type StingerKind = Extract<BeatKind, 'spike' | 'twist' | 'climax'>;

/**
 * Procedural film score.
 *
 * This lives in film/ instead of inside SoundService on purpose. Scoring the
 * film means reading FilmShowtimeService's beat timeline, but
 * FilmShowtimeService already imports GameState from game.service (to know
 * when to run its clock), and game.service injects SoundService. If
 * SoundService also injected FilmShowtimeService, that would close the loop
 * into a module cycle: sound → film-showtime → game → sound. Routing the
 * score through its own service breaks the cycle — game.service depends on
 * FilmScoreService directly, and FilmScoreService reaches into SoundService
 * and FilmShowtimeService without either of them knowing it exists.
 *
 * Holds no JS timers by design. Every stinger is scheduled on the
 * AudioContext's own timeline (osc.start/stop at an explicit time), so there
 * is nothing here for ngOnDestroy or a route teardown to leak.
 *
 * start() is called from inside a setTimeout callback (GameService's
 * pre-show delay), so there is no user gesture on the call stack and Chrome
 * will leave the AudioContext suspended. This service does not open a second
 * AudioContext or attempt its own resume: it reuses SoundService's ONE
 * resume path (already triggered by every SFX hover/select) and queues the
 * actual graph build behind SoundService.onAudioResumed().
 */
@Injectable({
  providedIn: 'root',
})
export class FilmScoreService implements OnDestroy {
  private readonly sound = inject(SoundService);
  private readonly showtime = inject(FilmShowtimeService);

  private running = false;
  /** True when start() has been requested but is waiting on the AudioContext to resume. */
  private pendingStart = false;
  private readonly unsubscribeResume: () => void;

  // The bed's audio graph. Built lazily in start(), torn down in stop().
  private rootOsc: OscillatorNode | null = null;
  private fifthOsc: OscillatorNode | null = null;
  private colorOsc: OscillatorNode | null = null;
  private rootGain: GainNode | null = null;
  private fifthGain: GainNode | null = null;
  private colorGain: GainNode | null = null;
  private bedGain: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private lfoOsc: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;

  // Stingers in flight. Unlike the bed's fixed graph, the number of these is
  // unbounded (a stinger fires per spike/twist/climax beat), so stop() needs
  // a live registry rather than named fields — each entry self-removes via
  // onended once its own envelope finishes, so this never grows unbounded.
  private readonly activeStingers = new Set<{ osc: OscillatorNode; gain: GainNode }>();

  // Graphs that have been faded out but whose oscillators have not reached
  // their scheduled stop yet. They stay here so their nodes can be disconnected
  // once they fall silent, and so a start() arriving mid-fade can cut them
  // rather than sound on top of the incoming bed.
  private readonly retiringGraphs = new Set<{ oscillators: OscillatorNode[]; nodes: AudioNode[] }>();

  // What the last-applied beat/film looked like, so the effect only reacts
  // to genuine changes instead of re-ramping on every 250ms clock tick.
  private lastSeed: number | null = null;
  private lastBeatKind: BeatKind | null = null;
  private lastBeatStartsAt: number | null = null;

  private get context(): AudioContext {
    return this.sound.scoreContext;
  }

  constructor() {
    // The one and only resume trigger this service makes is inside start()
    // (via sound.resumeAudio()). If that resume can't complete synchronously
    // (no gesture on the stack), start() queues pendingStart and this fires
    // the deferred build once SoundService's existing resume path succeeds.
    this.unsubscribeResume = this.sound.onAudioResumed(() => {
      if (this.pendingStart) {
        this.pendingStart = false;
        this.beginScore();
      }
    });

    effect(() => {
      const film = this.showtime.currentFilm();
      const beat = this.showtime.currentBeat();
      if (!this.running || !film || !beat) return;
      if (this.context.state === 'closed') return;

      // A new seed means a new feature rolled in (double feature). Retune
      // before applying the beat below, so the arriving title-card beat
      // lands on the new film's key rather than the outgoing one's.
      if (film.seed !== this.lastSeed) {
        this.retuneToGenre(film.genre, beat.kind);
        this.lastSeed = film.seed;
      }

      if (beat.kind !== this.lastBeatKind || beat.startsAt !== this.lastBeatStartsAt) {
        this.applyBeat(film.genre, beat);
        this.lastBeatKind = beat.kind;
        this.lastBeatStartsAt = beat.startsAt;
      }
    });
  }

  /**
   * Request the score. If the shared AudioContext is already running, the
   * graph builds immediately. If it is suspended (the common case — this is
   * called with no user gesture on the stack), the request is queued and
   * fulfilled the moment SoundService's own resume path succeeds; no second
   * resume attempt is made here.
   */
  start(): void {
    if (this.running || this.pendingStart) return;

    this.sound.resumeAudio();
    if (this.context.state === 'closed') return;
    if (this.context.state === 'suspended') {
      this.pendingStart = true;
      return;
    }

    this.beginScore();
  }

  /**
   * Build the bed and start every oscillator, landing immediately on
   * whatever beat is playing right now. Resuming mid-spike must sound like
   * resuming mid-spike, not a restart that glides up from calm — buildGraph()
   * sets every voice's frequency/filter/LFO from the current beat with
   * setValueAtTime (instant); only bedGain fades in.
   *
   * No try/catch here on purpose. GameService.resumeFromSavedState() wraps its
   * whole resume sequence in a try/catch and treats a throwing audio start as a
   * reason to abandon the resume and keep the saved checkpoint. In practice
   * that path is close to unreachable, since start() returns early on a
   * suspended or closed context and graph construction on a healthy one does
   * not throw. Exceptions are still left to propagate so the checkpoint stays
   * protected if that ever stops being true.
   */
  private beginScore(): void {
    const film = this.showtime.currentFilm();
    const beat = this.showtime.currentBeat();
    if (!film || !beat) return;

    // A previous graph may still be riding its fade-out. Oscillator stop times
    // cannot be rescheduled earlier by cancelling, and the old bed cannot be
    // revived, so the only way to avoid two beds sounding at once is to cut the
    // outgoing one here. Two stacked beds are +6dB and plainly audible; a
    // visibilitychange hide/show cycle faster than the fade produces exactly
    // that, and each repeat adds another layer.
    this.discardRetiringGraphs();

    this.buildGraph(film.genre, beat);
    this.running = true;
    this.lastSeed = film.seed;
    this.lastBeatKind = beat.kind;
    this.lastBeatStartsAt = beat.startsAt;
  }

  /**
   * Fade the bed out and release every node. Also cancels a start() that was
   * queued behind AudioContext resume but never actually began, so pause /
   * route-leave / game-end can't be raced by a resume that lands afterward.
   * Safe to call any number of times.
   */
  stop(): void {
    this.pendingStart = false;
    if (!this.running) return;
    this.running = false;

    if (this.context.state !== 'closed') {
      const now = this.context.currentTime;
      const stopAt = now + FILM_SCORE.FADE_SECONDS;
      if (this.bedGain) {
        // Cancel first, then re-anchor at the value we are actually sitting on.
        // Without the cancel, a stop() landing mid-fade-in leaves buildGraph's
        // rise still scheduled: the bed climbs to full volume and only then
        // falls, so pausing just after a round starts swells instead of ducking
        // out. Ramping linearly to a true zero also avoids the exponential
        // ramp's undefined behaviour when it starts from a zero value, which is
        // exactly where the fade-in begins.
        this.bedGain.gain.cancelScheduledValues(now);
        this.bedGain.gain.setValueAtTime(this.bedGain.gain.value, now);
        this.bedGain.gain.linearRampToValueAtTime(0, stopAt);
      }
      [this.rootOsc, this.fifthOsc, this.colorOsc, this.lfoOsc].forEach((osc) => osc?.stop(stopAt));

      // A stinger fired just before the pause is still ringing on its own
      // envelope. Fold it into the SAME now/stopAt as the bed so the whole
      // score ducks out as one gesture, rather than the stinger either
      // outlasting the pause or being cut off out of step with the bed.
      // osc.stop() on a node that already has a stop time scheduled simply
      // reschedules it, so this is safe even if the stinger was due to end
      // sooner on its own.
      this.activeStingers.forEach(({ osc, gain }) => {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, stopAt);
        osc.stop(stopAt);
      });

      this.retireGraph(stopAt);
    }
    this.activeStingers.clear();

    this.rootOsc = null;
    this.fifthOsc = null;
    this.colorOsc = null;
    this.lfoOsc = null;
    this.rootGain = null;
    this.fifthGain = null;
    this.colorGain = null;
    this.bedGain = null;
    this.lowpass = null;
    this.lfoGain = null;

    this.lastSeed = null;
    this.lastBeatKind = null;
    this.lastBeatStartsAt = null;
  }

  ngOnDestroy(): void {
    this.stop();
    // stop() leaves the last graph fading. On teardown there is nobody left to
    // hear it out, so release it here rather than depend on an onended that a
    // suspended context may never deliver.
    this.discardRetiringGraphs();
    this.unsubscribeResume();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Hand the just-faded graph over to be disconnected once it falls silent.
   *
   * Web Audio does not release a node just because it has stopped: it stays
   * attached to the destination chain until it is disconnected or the context
   * is closed. SoundService suspends its context rather than closing it (it is
   * providedIn:'root' and outlives the route), so without this every visit to
   * the theater would leave another 11-node graph hanging off the music bus.
   */
  private retireGraph(stopAt: number): void {
    const oscillators = [this.rootOsc, this.fifthOsc, this.colorOsc, this.lfoOsc].filter(
      (osc): osc is OscillatorNode => osc !== null
    );
    const nodes: AudioNode[] = [
      ...oscillators,
      ...[this.rootGain, this.fifthGain, this.colorGain, this.bedGain, this.lowpass, this.lfoGain].filter(
        (node): node is GainNode | BiquadFilterNode => node !== null
      ),
      ...[...this.activeStingers].flatMap(({ osc, gain }) => [osc, gain]),
    ];
    if (nodes.length === 0) return;

    const graph = { oscillators, nodes };

    // A suspended context freezes currentTime, so a stop scheduled against it
    // may never arrive and onended may never fire. Nothing is audible there
    // either, so release straight away rather than wait for an event that is
    // not coming. This is the ordinary path on route-leave, because the
    // component's teardown suspends the context moments later.
    if (this.context.state !== 'running' || stopAt <= this.context.currentTime) {
      this.disconnectGraph(graph);
      return;
    }

    this.retiringGraphs.add(graph);
    oscillators.forEach((osc) => {
      osc.onended = () => {
        this.retiringGraphs.delete(graph);
        this.disconnectGraph(graph);
      };
    });
  }

  /**
   * Cut every still-fading graph immediately. Silencing the gain before the
   * stop keeps the cut from landing as a click, and the outgoing bed is already
   * partway through its fade, so what is truncated is quiet by definition.
   */
  private discardRetiringGraphs(): void {
    if (this.retiringGraphs.size === 0) return;
    const live = this.context.state !== 'closed';
    const now = live ? this.context.currentTime : 0;

    this.retiringGraphs.forEach((graph) => {
      graph.oscillators.forEach((osc) => {
        osc.onended = null;
      });
      if (live) {
        graph.nodes.forEach((node) => {
          if (node instanceof GainNode) {
            node.gain.cancelScheduledValues(now);
            node.gain.setValueAtTime(0, now);
          }
        });
        graph.oscillators.forEach((osc) => osc.stop(now));
      }
      this.disconnectGraph(graph);
    });
    this.retiringGraphs.clear();
  }

  private disconnectGraph(graph: { oscillators: OscillatorNode[]; nodes: AudioNode[] }): void {
    graph.nodes.forEach((node) => node.disconnect());
  }

  private buildGraph(genre: FilmGenre, beat: FilmBeat): void {
    const ctx = this.context;
    const tonality = GENRE_TONALITY[genre];
    const now = ctx.currentTime;

    this.rootGain = ctx.createGain();
    this.rootGain.gain.value = FILM_SCORE.VOICE_GAIN_ROOT;
    this.fifthGain = ctx.createGain();
    this.fifthGain.gain.value = FILM_SCORE.VOICE_GAIN_FIFTH;
    this.colorGain = ctx.createGain();
    this.colorGain.gain.value = FILM_SCORE.VOICE_GAIN_COLOR;

    this.bedGain = ctx.createGain();
    this.bedGain.gain.setValueAtTime(0, now);

    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.Q.value = FILM_SCORE.FILTER_Q;
    this.lowpass.frequency.setValueAtTime(this.filterHzFor(beat.intensity), now);

    this.rootOsc = ctx.createOscillator();
    this.rootOsc.type = 'sine';
    this.rootOsc.detune.setValueAtTime(-FILM_SCORE.DETUNE_CENTS, now);
    this.rootOsc.frequency.setValueAtTime(this.frequency(tonality.octave, tonality.root), now);

    this.fifthOsc = ctx.createOscillator();
    this.fifthOsc.type = 'sine';
    this.fifthOsc.detune.setValueAtTime(0, now);
    this.fifthOsc.frequency.setValueAtTime(this.frequency(tonality.octave + 1, tonality.root + 7), now);

    this.colorOsc = ctx.createOscillator();
    this.colorOsc.type = 'triangle';
    this.colorOsc.detune.setValueAtTime(FILM_SCORE.DETUNE_CENTS, now);
    this.colorOsc.frequency.setValueAtTime(
      this.frequency(tonality.octave + 1, tonality.root + this.colorInterval(beat.kind, tonality)),
      now
    );

    this.lfoOsc = ctx.createOscillator();
    this.lfoOsc.type = 'sine';
    this.lfoOsc.frequency.setValueAtTime(this.lfoHzFor(beat.intensity), now);

    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.setValueAtTime(0, now); // ramped to its real value below, once bedGain has a target

    this.rootOsc.connect(this.rootGain);
    this.fifthOsc.connect(this.fifthGain);
    this.colorOsc.connect(this.colorGain);
    this.rootGain.connect(this.bedGain);
    this.fifthGain.connect(this.bedGain);
    this.colorGain.connect(this.bedGain);
    this.bedGain.connect(this.lowpass);
    this.lowpass.connect(this.sound.scoreOutput);

    this.lfoOsc.connect(this.lfoGain);
    this.lfoGain.connect(this.bedGain.gain);

    this.rootOsc.start(now);
    this.fifthOsc.start(now);
    this.colorOsc.start(now);
    this.lfoOsc.start(now);

    const targetBed = this.bedGainFor(beat.intensity);
    this.bedGain.gain.linearRampToValueAtTime(targetBed, now + FILM_SCORE.FADE_SECONDS);
    this.lfoGain.gain.linearRampToValueAtTime(targetBed * FILM_SCORE.LFO_DEPTH, now + FILM_SCORE.FADE_SECONDS);
  }

  /**
   * A double feature rolled a new film in. Glide the bed's three voices to
   * the new genre's key and duck the bed briefly, so the change reads as a
   * reel change rather than a hard restart. The oscillators themselves are
   * never stopped or recreated for this.
   */
  private retuneToGenre(genre: FilmGenre, beatKind: BeatKind): void {
    if (!this.rootOsc || !this.fifthOsc || !this.colorOsc || !this.bedGain) return;

    const tonality = GENRE_TONALITY[genre];
    const now = this.context.currentTime;
    const glide = FILM_SCORE.FADE_SECONDS / 2;

    this.rootOsc.frequency.exponentialRampToValueAtTime(this.frequency(tonality.octave, tonality.root), now + glide);
    this.fifthOsc.frequency.exponentialRampToValueAtTime(
      this.frequency(tonality.octave + 1, tonality.root + 7),
      now + glide
    );
    this.colorOsc.frequency.exponentialRampToValueAtTime(
      this.frequency(tonality.octave + 1, tonality.root + this.colorInterval(beatKind, tonality)),
      now + glide
    );

    const currentBed = this.bedGain.gain.value;
    this.bedGain.gain.linearRampToValueAtTime(currentBed * FILM_SCORE.RETUNE_DUCK_FACTOR, now + glide / 2);
    this.bedGain.gain.linearRampToValueAtTime(currentBed, now + glide);

    // The tremolo depth has to ride the duck with it. lfoGain modulates
    // bedGain.gain by an absolute amount, so holding it steady while the bed
    // drops to a third of its level triples the depth relative to the bed, and
    // the reel change wobbles at the one moment it should read as smooth.
    if (this.lfoGain) {
      const currentDepth = this.lfoGain.gain.value;
      this.lfoGain.gain.linearRampToValueAtTime(currentDepth * FILM_SCORE.RETUNE_DUCK_FACTOR, now + glide / 2);
      this.lfoGain.gain.linearRampToValueAtTime(currentDepth, now + glide);
    }
  }

  /** Apply a beat change: bed dynamics, filter, tremolo, color voice, and stinger. */
  private applyBeat(genre: FilmGenre, beat: FilmBeat): void {
    if (!this.bedGain || !this.lowpass || !this.lfoOsc || !this.lfoGain || !this.colorOsc) return;

    const tonality = GENRE_TONALITY[genre];
    const now = this.context.currentTime;
    const glideEnd = now + FILM_SCORE.BEAT_GLIDE_SECONDS;
    const targetBed = this.bedGainFor(beat.intensity);

    this.bedGain.gain.linearRampToValueAtTime(targetBed, glideEnd);
    this.lowpass.frequency.linearRampToValueAtTime(this.filterHzFor(beat.intensity), glideEnd);
    this.lfoOsc.frequency.linearRampToValueAtTime(this.lfoHzFor(beat.intensity), glideEnd);
    this.lfoGain.gain.linearRampToValueAtTime(targetBed * FILM_SCORE.LFO_DEPTH, glideEnd);

    const colorFreq = this.frequency(tonality.octave + 1, tonality.root + this.colorInterval(beat.kind, tonality));
    this.colorOsc.frequency.exponentialRampToValueAtTime(colorFreq, now + FILM_SCORE.VOICE_GLIDE_SECONDS);

    if (this.isStingerKind(beat.kind)) {
      this.fireStinger(beat.kind, genre);
    }
  }

  private isStingerKind(kind: BeatKind): kind is StingerKind {
    return kind === 'spike' || kind === 'twist' || kind === 'climax';
  }

  /** Short accents layered over the bed, scheduled entirely on the AudioContext timeline. */
  private fireStinger(kind: StingerKind, genre: FilmGenre): void {
    const tonality = GENRE_TONALITY[genre];
    // Stingers sit an octave above the bed so they cut through it.
    const stingerOctave = tonality.octave + 1;

    if (kind === 'spike') {
      // A falling minor third reads as a jolt; the low thump gives it weight.
      const first = this.frequency(stingerOctave, tonality.root);
      const second = this.frequency(stingerOctave, tonality.root - 3);
      const thump = Math.max(FILM_SCORE.THUMP_MIN_HZ, this.frequency(tonality.octave - 1, tonality.root));
      this.scoreNote(first, { waveType: 'triangle', duration: FILM_SCORE.STINGER_SPIKE_SECONDS });
      this.scoreNote(second, {
        waveType: 'triangle',
        duration: FILM_SCORE.STINGER_SPIKE_SECONDS,
        offset: FILM_SCORE.STINGER_ARP_GAP,
      });
      this.scoreNote(thump, { waveType: 'sine', duration: FILM_SCORE.STINGER_THUMP_SECONDS });
    } else if (kind === 'twist') {
      // One note glides up a semitone and settles: unresolved brightness.
      const start = this.frequency(stingerOctave, tonality.root);
      const settled = this.frequency(stingerOctave, tonality.root + 1);
      this.scoreNote(start, {
        waveType: 'sine',
        duration: FILM_SCORE.STINGER_TWIST_SECONDS,
        glideToFrequency: settled,
        glideSeconds: FILM_SCORE.STINGER_TWIST_SECONDS,
      });
    } else {
      // climax: rising arpeggio, root → fifth → octave.
      const root = this.frequency(stingerOctave, tonality.root);
      const fifth = this.frequency(stingerOctave, tonality.root + 7);
      const octave = this.frequency(stingerOctave + 1, tonality.root);
      this.scoreNote(root, { waveType: 'triangle', duration: FILM_SCORE.STINGER_CLIMAX_SECONDS });
      this.scoreNote(fifth, {
        waveType: 'triangle',
        duration: FILM_SCORE.STINGER_CLIMAX_SECONDS,
        offset: FILM_SCORE.STINGER_ARP_GAP,
      });
      this.scoreNote(octave, {
        waveType: 'triangle',
        duration: FILM_SCORE.STINGER_CLIMAX_SECONDS,
        offset: FILM_SCORE.STINGER_ARP_GAP * 2,
      });
    }
  }

  /** Build one osc → gain → scoreOutput stinger voice with a soft, click-free ADSR. */
  private scoreNote(
    frequency: number,
    opts: {
      waveType: OscillatorType;
      duration: number;
      offset?: number;
      glideToFrequency?: number;
      glideSeconds?: number;
    }
  ): void {
    const { waveType, duration, offset = 0, glideToFrequency, glideSeconds } = opts;
    const startAt = this.context.currentTime + offset;
    // Never below STINGER_ATTACK_MIN: a faster attack on a stinger reads as a click.
    const attack = Math.max(FILM_SCORE.STINGER_ATTACK_MIN, duration * 0.1);

    const osc = this.context.createOscillator();
    osc.type = waveType;
    osc.frequency.setValueAtTime(frequency, startAt);
    if (glideToFrequency !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(glideToFrequency, startAt + (glideSeconds ?? duration));
    }

    const gainNode = this.context.createGain();
    gainNode.gain.setValueAtTime(0, startAt);
    gainNode.gain.linearRampToValueAtTime(FILM_SCORE.STINGER_GAIN, startAt + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    osc.connect(gainNode);
    gainNode.connect(this.sound.scoreOutput);

    // Tracked so stop() can duck an in-flight stinger onto the bed's own
    // fade-out instead of leaving it ringing (or, before this, doing nothing
    // to it at all). The entry self-removes on onended so the set never
    // grows unbounded regardless of how many stingers fire over a session.
    const entry = { osc, gain: gainNode };
    this.activeStingers.add(entry);
    osc.onended = () => this.activeStingers.delete(entry);

    osc.start(startAt);
    osc.stop(startAt + duration + 0.05);
  }

  /** The voicing that follows the story: which interval the color voice takes for a beat kind. */
  private colorInterval(kind: BeatKind, tonality: GenreTonality): number {
    switch (kind) {
      case 'title-card':
      case 'calm':
      case 'credits':
        return tonality.third; // states the key / at rest / resolves home
      case 'build':
        return 5; // suspended fourth, wants resolution
      case 'spike':
        return 6; // tritone, maximum unease
      case 'chase':
        return 10; // minor seventh, driving
      case 'twist':
        return 9; // major sixth, unsettled brightness
      case 'climax':
        return 12; // octave, full and resolved
    }
  }

  private bedGainFor(intensity: number): number {
    return FILM_SCORE.BED_GAIN_MIN + intensity * FILM_SCORE.BED_GAIN_SPAN;
  }

  private filterHzFor(intensity: number): number {
    return FILM_SCORE.FILTER_HZ_MIN + intensity * FILM_SCORE.FILTER_HZ_SPAN;
  }

  private lfoHzFor(intensity: number): number {
    return FILM_SCORE.LFO_HZ_MIN + intensity * FILM_SCORE.LFO_HZ_SPAN;
  }

  /** Equal-temperament frequency for a given octave and semitone (0 = C). */
  private frequency(octave: number, semitone: number): number {
    return noteFrequency(octave, semitone);
  }
}
