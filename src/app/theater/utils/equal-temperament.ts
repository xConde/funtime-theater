/**
 * Equal-temperament (12-tone) pitch math.
 *
 * C0 = 16.35 Hz is the reference: every other pitch is that many octaves and
 * semitones above it. This is the single source for BOTH the SFX synth
 * (SoundService) and the procedural film score (FilmScoreService), and for
 * the score's own test expectations — there must be exactly one copy of this
 * formula, or a drift between production and test copies would make the
 * suite blind to a real regression.
 */
export function noteFrequency(octave: number, semitone: number): number {
  const C0 = 16.35;
  const totalSemitones = octave * 12 + semitone;
  return C0 * Math.pow(2, totalSemitones / 12);
}
