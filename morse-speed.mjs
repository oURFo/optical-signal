import { createDecoder } from './decoder.mjs?v=6';

const minimumUnit = 100;
const maximumUnit = 2000;
const lightRatios = [1, 3];
const darkRatios = [1, 3, 7];

function estimate(runs, frameInterval) {
  if (runs.filter(run => run.bright).length < 2 || !runs.some(run => !run.bright)) return;
  const candidates = [];
  const fastest = Math.max(minimumUnit, frameInterval * 2.5);
  for (let unit = Math.ceil(fastest / 5) * 5; unit <= maximumUnit; unit += 5) {
    let error = 0;
    for (const { bright, duration } of runs) {
      // Extended darkness between transmissions carries no exact timing information.
      if (!bright && duration > unit * 7) continue;
      const ratios = bright ? lightRatios : darkRatios;
      const residual = Math.min(...ratios.map(ratio => Math.abs(duration - ratio * unit)));
      error += (residual / Math.max(frameInterval, unit * 0.2)) ** 2;
    }
    candidates.push({ unit, error: error / runs.length });
  }
  const best = candidates.reduce((winner, candidate) =>
    !winner || candidate.error < winner.error ? candidate : winner, undefined);
  if (!best || best.error > 1.7) return;
  const ambiguous = candidates.some(candidate =>
    Math.abs(candidate.unit - best.unit) > Math.max(best.unit * 0.3, frameInterval)
    && candidate.error - best.error < 0.9);
  return ambiguous ? undefined : best.unit;
}

export function createAutoDecoder(emit, showSymbols, onLock) {
  let history = [];
  let runs = [];
  let unstable = [];
  let previous, frameInterval, level, edge, pending, decoder;
  let invert = false;

  function sample(time, bright) {
    if (decoder) {
      decoder.sample(time, bright !== invert);
      return;
    }
    if (previous !== undefined) {
      const interval = time - previous;
      if (interval <= 0) return;
      if (interval > Math.max(250, (frameInterval ?? 33) * 4)) {
        runs = [];
        history = [];
        unstable = [];
        level = edge = pending = undefined;
        invert = false;
      } else {
        frameInterval = frameInterval === undefined ? interval : frameInterval * 0.9 + interval * 0.1;
      }
    }
    previous = time;
    bright = bright !== invert;
    history.push({ time, bright });
    while (history[0].time < time - 45000) history.shift();
    if (level === undefined) {
      level = bright;
      return;
    }
    if (bright === level) {
      if (pending !== undefined) {
        unstable = unstable.filter(at => at >= time - 5000);
        unstable.push(pending);
      }
      pending = undefined;
      return;
    }
    if (pending === undefined) {
      pending = time;
      return;
    }
    const transition = pending;
    pending = undefined;
    if (edge === undefined && level && transition - history[0].time >= 500) {
      // A steady bright screen before transmission can use dark flashes as its pulses.
      invert = !invert;
      level = !level;
      bright = !bright;
      for (const reading of history) reading.bright = !reading.bright;
    }
    if (edge !== undefined) runs.push({ bright: level, duration: transition - edge, time: transition });
    runs = runs.filter(run => run.time >= history[0].time).slice(-18);
    level = bright;
    edge = transition;
    unstable = unstable.filter(at => at >= time - 5000);
    // Frequent one-frame transitions suggest aliasing. The remaining longer pulses can fit a false speed.
    if (unstable.length >= 2) return;
    const unit = estimate(runs, frameInterval ?? 33);
    if (unit === undefined) return;
    decoder = createDecoder(unit, emit, showSymbols);
    onLock(unit, invert);
    for (const reading of history) decoder.sample(reading.time, reading.bright);
    history = [];
    runs = [];
  }

  return { sample, get unstable() { return unstable.length >= 2; } };
}
