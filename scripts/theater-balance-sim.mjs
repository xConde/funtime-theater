/**
 * Theater economy simulator.
 *
 * Plays the game as a competent greedy player using the REAL constants
 * (transpiled from theater.constants.ts, so the sim cannot drift from the
 * build): each round it picks the best affordable mode, earns tickets from
 * the actual per-click formulas, levels up, then buys whatever upgrade has
 * the best marginal value per ticket. Prints the milestone timeline.
 *
 * Run from the repo root:
 *   node scripts/theater-balance-sim.mjs            # default 90 minutes
 *   node scripts/theater-balance-sim.mjs --minutes 180
 */
import { execFileSync } from 'child_process';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'balance-sim-'));
execFileSync('cp', [
  join(repoRoot, 'src/app/theater/theater.constants.ts'),
  work,
]);
execFileSync(
  join(repoRoot, 'node_modules/.bin/tsc'),
  ['--module', 'esnext', '--target', 'es2022', '--skipLibCheck', 'theater.constants.ts'],
  { cwd: work }
);
const C = await import(pathToFileURL(join(work, 'theater.constants.js')).href);

const minutes = (() => {
  const i = process.argv.indexOf('--minutes');
  return i >= 0 ? Number(process.argv[i + 1]) : 90;
})();

// ── Player model ────────────────────────────────────────────────────────────
const CLICKS_PER_SECOND = 0.45; // competent, not frame-perfect
const LOBBY_OVERHEAD_SECONDS = 8; // between rounds: shopping, breathing

const state = {
  coins: C.GAME_BALANCE.STARTING_COINS,
  totalXP: 0,
  level: 1,
  owned: Object.fromEntries(Object.keys(C.INITIAL_POWER_UP_COSTS).map((k) => [k, 0])),
  seconds: 0,
  rounds: 0,
  milestones: [],
};

function levelFromXP(xp) {
  let level = 1;
  while (Math.floor(100 * Math.pow(level, 1.5)) <= xp) level++;
  return level;
}

const maxLevels = C.MAX_POWER_UP_LEVELS ?? {};

function clickEV() {
  const o = state.owned;
  const base = 1.5 + (o.seatUpgrade ?? 0) * C.POWER_UP_FORMULAS.SEAT_UPGRADE_BONUS_PER_LEVEL;
  const popcorn = Math.pow(C.POWER_UP_FORMULAS.TICKET_MULTIPLIER_BASE, o.ticketMultiplier ?? 0);
  const luckyChance =
    Math.min(
      C.POWER_UP_FORMULAS.LUCKY_STREAK_BASE_CHANCE + (o.luckyStreak ?? 0) * C.POWER_UP_FORMULAS.LUCKY_STREAK_PER_LEVEL,
      C.POWER_UP_FORMULAS.LUCKY_STREAK_MAX_CHANCE
    ) / 100;
  const critChance =
    (o.criticalHit ?? 0) > 0
      ? Math.min(
          C.POWER_UP_FORMULAS.CRITICAL_HIT_BASE_CHANCE +
            (o.criticalHit ?? 0) * C.POWER_UP_FORMULAS.CRITICAL_HIT_PER_LEVEL,
          C.POWER_UP_FORMULAS.CRITICAL_HIT_MAX_CHANCE
        ) / 100
      : 0;
  // Lucky and critical are mutually exclusive; critical wins ties in spirit.
  const critMult = C.GAME_MECHANICS.CRITICAL_HIT_MULTIPLIER;
  const specialMult = critChance * critMult + (1 - critChance) * (luckyChance * 5 + (1 - luckyChance) * 1);
  const roundMultiplier = 1.4; // average cumulative multiplier across a round
  return base * popcorn * specialMult * roundMultiplier;
}

function roundFor(mode) {
  const fees = C.GAME_MODE_FEES;
  const reqs = C.GAME_MODE_LEVEL_REQUIREMENTS;
  const mults = C.GAME_MODE_MULTIPLIERS;
  if (state.level < reqs[mode] || state.coins < fees[mode]) return null;

  const baseDuration = { classic: 24, midnight: 60, carnival: 90, finale: 70 }[mode];
  const comboBonus = Math.min(
    state.owned.comboMaster ?? 0,
    C.POWER_UP_FORMULAS.COMBO_MASTER_MAX_BONUS_SECONDS ?? Infinity
  );
  // Each click extends the round; uncapped this diverges (the broken case).
  const clickGain = comboBonus * CLICKS_PER_SECOND;
  // With the in-game timer ceiling, sustain is bounded by player focus,
  // not math: model a miss ending the run within about two minutes.
  const duration = clickGain >= 1 ? 120 : Math.min(120, baseDuration / (1 - clickGain));

  const clicks = duration * CLICKS_PER_SECOND;
  const clickTickets = clicks * clickEV();
  const passive =
    duration * (state.owned.passiveIncome ?? 0) * C.POWER_UP_FORMULAS.PASSIVE_INCOME_PER_LEVEL +
    (duration / 15) * (state.owned.ticketStorm ?? 0) * C.POWER_UP_FORMULAS.TICKET_STORM_PER_LEVEL;
  const tickets = Math.floor((clickTickets + passive) * mults[mode]);
  const xpMult = { classic: 1.0, midnight: 1.3, carnival: 1.5, finale: 2.0 }[mode];
  return { mode, duration, tickets, fee: fees[mode], xpMult };
}

function bestRound() {
  const candidates = ['finale', 'carnival', 'midnight', 'classic'].map(roundFor).filter(Boolean);
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a.tickets - a.fee > b.tickets - b.fee ? a : b));
}

function xpForTickets(tickets, xpMult) {
  if (C.XP_FROM_TICKETS_SQRT_FACTOR !== undefined) {
    return Math.max(1, Math.floor(Math.sqrt(tickets) * C.XP_FROM_TICKETS_SQRT_FACTOR * xpMult));
  }
  return Math.floor(tickets * xpMult);
}

function shop() {
  // Buy any upgrade whose cost is < 35% of the bankroll, best value first.
  let bought = true;
  while (bought) {
    bought = false;
    const options = Object.keys(C.INITIAL_POWER_UP_COSTS)
      .filter((id) => maxLevels[id] === undefined || state.owned[id] < maxLevels[id])
      .map((id) => ({ id, cost: C.calculatePowerUpCost(id, state.owned[id]) }))
      .filter((o) => o.cost <= state.coins * 0.35)
      .sort((a, b) => a.cost - b.cost);
    if (options.length > 0) {
      state.coins -= options[0].cost;
      state.owned[options[0].id]++;
      bought = true;
    }
  }
}

function note(label) {
  state.milestones.push(
    `${String(Math.round(state.seconds / 60)).padStart(4)}min  ${label}  (coins ${Math.round(state.coins)}, lvl ${state.level})`
  );
}

const seen = new Set();
while (state.seconds < minutes * 60) {
  const round = bestRound();
  if (!round) break;
  state.coins -= round.fee;
  state.coins += round.tickets;
  state.totalXP += xpForTickets(round.tickets, round.xpMult);
  state.level = levelFromXP(state.totalXP);
  state.seconds += round.duration + LOBBY_OVERHEAD_SECONDS;
  state.rounds++;
  shop();

  for (const [mode, req] of Object.entries(C.GAME_MODE_LEVEL_REQUIREMENTS)) {
    const key = `unlock-${mode}`;
    if (!seen.has(key) && state.level >= req && state.coins >= C.GAME_MODE_FEES[mode]) {
      seen.add(key);
      if (mode !== 'classic') note(`${mode.toUpperCase()} playable`);
    }
  }
  if (!seen.has('r25') && state.rounds === 25) {
    seen.add('r25');
    note('25 rounds in');
  }
}

console.log(`── ${minutes} simulated minutes, ${state.rounds} rounds ──`);
state.milestones.forEach((m) => console.log(m));
console.log(
  `final: lvl ${state.level}, coins ${Math.round(state.coins)}, owned ${Object.entries(state.owned)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}:${n}`)
    .join(' ')}`
);
console.log(`per-click EV at end: ${clickEV().toFixed(1)} tickets`);
