const minimumContrast = 7;

export function createLightDetector(unit, onSample) {
  let buffer = [];
  let dark, light;
  let bright = false;
  let stableFrames = 0;

  function classify(time, value) {
    const contrast = light - dark;
    const wasBright = bright;
    bright = value >= dark + contrast * (bright ? 0.38 : 0.62);
    stableFrames = bright === wasBright ? stableFrames + 1 : 1;
    if (stableFrames >= 3) {
      // Follow slow exposure drift while keeping transitional frames out of the baseline.
      if (bright && Math.abs(value - light) <= contrast * 0.3) light += (value - light) * 0.08;
      if (!bright && Math.abs(value - dark) <= contrast * 0.3) dark += (value - dark) * 0.08;
    }
    onSample(time, bright);
  }

  function sample(time, value) {
    if (dark !== undefined) {
      classify(time, value);
      return;
    }
    const previous = buffer.at(-1);
    buffer.push({ time, value });
    const oldest = time - Math.max(1600, unit * 5);
    while (buffer[0].time < oldest) buffer.shift();
    // Acquire on a sustained change. Ignore one-frame spikes and keep the first pulse for replay.
    if (!previous || buffer.length < 4) return;
    const current = (previous.value + value) / 2;
    let reference;
    let bestContrast = minimumContrast;
    for (let i = 1; i < buffer.length - 2; i++) {
      const first = buffer[i - 1].value;
      const second = buffer[i].value;
      const baseline = (first + second) / 2;
      const contrast = Math.abs(baseline - current);
      const tolerance = Math.max(3, contrast * 0.25);
      if (contrast >= bestContrast && Math.abs(first - second) <= tolerance
          && Math.abs(previous.value - value) <= tolerance) {
        reference = baseline;
        bestContrast = contrast;
      }
    }
    if (reference === undefined) return;
    dark = Math.min(reference, current);
    light = Math.max(reference, current);
    for (const reading of buffer) classify(reading.time, reading.value);
    buffer = [];
  }

  return {
    sample,
    get contrast() { return dark === undefined ? undefined : light - dark; },
    get bright() { return bright; }
  };
}
