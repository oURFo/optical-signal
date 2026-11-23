import { encode } from './morse.mjs';

const letters = new Map(encode('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789').map(({ letter, code }) => [code, letter]));
letters.set('...---...', 'SOS');

export function createDecoder(unit, emit, showSymbols) {
  let previous;
  let edge;
  let level = false;
  let candidate;
  let symbols = '';
  let synchronized = false;
  let idle = 0;
  let wordPending = false;
  let initialDarkFrames = 0;
  let firstEdge = true;

  function reset() {
    previous = edge = candidate = undefined;
    level = synchronized = wordPending = false;
    firstEdge = false;
    symbols = '';
    idle = 0;
    showSymbols('');
  }

  function settleDark(time) {
    const units = (time - edge) / unit;
    if (idle < 1 && units >= 2.2 && symbols) {
      emit(letters.get(symbols) ?? '?');
      symbols = '';
      idle = 1;
    }
    if (idle < 2 && units >= 5.2) {
      wordPending = true;
      idle = 2;
    }
  }

  function sample(time, bright) {
    if (previous !== undefined && time - previous > unit * 0.7) {
      if (symbols || (level && synchronized)) emit('?');
      reset();
    }
    previous = time;
    if (bright === level) {
      candidate = undefined;
      if (!level) {
        edge ??= time;
        if (firstEdge) initialDarkFrames++;
        if (synchronized) settleDark(time);
      }
      return;
    }
    if (candidate === undefined) {
      candidate = time;
      return;
    }
    const transition = candidate;
    candidate = undefined;
    if (bright) {
      if (synchronized) settleDark(transition);
      else if (edge !== undefined && (transition - edge >= unit * 2.2
          || (firstEdge && initialDarkFrames >= 2))) synchronized = true;
      if (wordPending) emit(' ');
      wordPending = false;
      idle = 0;
    } else if (synchronized) {
      const units = (transition - edge) / unit;
      if (units >= 0.4) {
        const symbol = units <= 1.65 ? '.' : units >= 2.25 && units <= 4.6 ? '-' : '?';
        symbols = symbols.length < 9 ? symbols + symbol : '?';
        showSymbols(symbols);
      }
    }
    firstEdge = false;
    level = bright;
    edge = transition;
  }
  return { sample, reset };
}
