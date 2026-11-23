const letters = '.- -... -.-. -.. . ..-. --. .... .. .--- -.- .-.. -- -. --- .--. --.- .-. ... - ..- ...- .-- -..- -.-- --..'.split(' ');
const digits = '----- .---- ..--- ...-- ....- ..... -.... --... ---.. ----.'.split(' ');
const codes = Object.fromEntries(Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', (letter, index) => [
  letter, [...letters, ...digits][index]
]));

export function cleanMessage(text) {
  return text.replace(/[^a-z0-9\s]/gi, '').toUpperCase().replace(/\s+/g, ' ');
}

export function encode(text) {
  return Array.from(cleanMessage(text).trim(), letter => ({
    letter, code: codes[letter] || ''
  }));
}

export function schedule(tokens, repeat) {
  const steps = [];
  tokens.forEach(({ code }, index) => {
    if (!code) return;
    Array.from(code).forEach((symbol, position) => {
      if (position) steps.push({ on: false, units: 1, index });
      steps.push({ on: true, units: symbol === '.' ? 1 : 3, index });
    });
    const next = tokens[index + 1];
    if (next || repeat) steps.push({ on: false, units: next?.code ? 3 : 7, index: -1 });
  });
  return steps;
}
