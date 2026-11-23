import { createDecoder } from './decoder.mjs';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function setupReceiver({ begin, stop, isActive }) {
  const $ = id => document.getElementById(id);
  const open = $('receive-open');
  const panel = $('receive-controls');
  const status = $('receive-status');
  const video = $('camera-preview');
  const view = $('camera-view');
  const frame = $('camera-roi');
  const size = $('roi-size');
  const lock = $('roi-lock');
  const flashButton = $('flash-calibrate');
  const darkButton = $('dark-calibrate');
  const lightButton = $('light-calibrate');
  const start = $('receive-run');
  const speed = $('receive-unit');
  const signal = $('receive-signal');
  const symbols = $('receive-symbols');
  const result = $('receive-text');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let roi = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
  let drag, session, sampleId, decoder, calibration;
  let locked = false;
  let bright = false;
  let dark, light;
  let lastFrame, frameInterval, lastReport, lastVideoTime;
  const nativeFrames = typeof video.requestVideoFrameCallback === 'function';

  function drawBox() {
    for (const [property, value] of Object.entries({ left: roi.x, top: roi.y, width: roi.w, height: roi.h })) {
      frame.style[property] = `${value * 100}%`;
    }
  }

  function update() {
    frame.classList.toggle('locked', locked);
    size.disabled = locked;
    lock.textContent = locked ? '解除鎖定' : '鎖定範圍';
    darkButton.disabled = !locked || !!decoder || !!calibration;
    flashButton.disabled = darkButton.disabled;
    lightButton.disabled = darkButton.disabled || dark === undefined;
    start.disabled = !locked || !!calibration || !(light - dark >= 8);
    start.textContent = decoder ? '暫停解析' : '開始解析';
    speed.disabled = !!decoder;
  }

  function clearDecoder() {
    decoder?.reset();
    decoder = undefined;
    bright = false;
    symbols.textContent = '';
  }

  function unlock() {
    locked = false;
    dark = light = calibration = undefined;
    clearDecoder();
    update();
  }

  const point = event => {
    const bounds = view.getBoundingClientRect();
    return {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    };
  };
  view.addEventListener('pointerdown', event => {
    if (locked || drag || event.button !== 0) return;
    const origin = point(event);
    const move = origin.x >= roi.x && origin.x <= roi.x + roi.w && origin.y >= roi.y && origin.y <= roi.y + roi.h;
    drag = { id: event.pointerId, origin, box: { ...roi }, move };
    view.setPointerCapture(event.pointerId);
  });
  view.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId || locked) return;
    const to = point(event);
    const { origin, box, move } = drag;
    if (move) {
      roi.x = clamp(box.x + to.x - origin.x, 0, 1 - roi.w);
      roi.y = clamp(box.y + to.y - origin.y, 0, 1 - roi.h);
    } else {
      const w = clamp(Math.abs(to.x - origin.x), 0.04, 1);
      const h = clamp(Math.abs(to.y - origin.y), 0.04, 1);
      roi = { x: clamp(Math.min(to.x, origin.x), 0, 1 - w), y: clamp(Math.min(to.y, origin.y), 0, 1 - h), w, h };
    }
    drawBox();
    size.value = Math.round(clamp(Math.max(roi.w, roi.h) * 100, 4, 70));
  });
  for (const event of ['lostpointercapture', 'pointercancel', 'pointerup']) {
    view.addEventListener(event, ({ pointerId }) => { if (drag?.id === pointerId) drag = undefined; });
  }
  size.oninput = () => {
    const side = Number(size.value) / 100;
    roi = {
      x: clamp(roi.x + (roi.w - side) / 2, 0, 1 - side),
      y: clamp(roi.y + (roi.h - side) / 2, 0, 1 - side), w: side, h: side
    };
    drawBox();
  };

  lock.onclick = () => {
    if (locked) {
      unlock();
      status.textContent = '移動或縮放選取框，再鎖定範圍。';
    } else {
      locked = true;
      drag = undefined;
      update();
      status.textContent = '範圍已鎖定。請選擇閃爍取樣或分別校準亮滅。';
    }
  };

  function calibrate(target) {
    calibration = { target, readings: [] };
    if (target !== 'light') dark = light = undefined;
    else light = undefined;
    status.textContent = {
      flash: '量測中，請讓光源持續閃爍並維持對準。',
      dark: '量測中，請保持熄燈。',
      light: '量測中，請保持亮燈。'
    }[target];
    update();
  }
  darkButton.onclick = () => calibrate('dark');
  lightButton.onclick = () => calibrate('light');
  flashButton.onclick = () => calibrate('flash');

  function readBrightness() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    context.drawImage(video, roi.x * width, roi.y * height, roi.w * width, roi.h * height, 0, 0, 24, 24);
    const { data } = context.getImageData(0, 0, 24, 24);
    const luminance = [];
    for (let i = 0; i < data.length; i += 4) {
      luminance.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
    luminance.sort((a, b) => a - b);
    const upper = luminance.slice(-29, -1);
    return upper.reduce((sum, value) => sum + value, 0) / upper.length;
  }

  function finishCalibration(value, time) {
    calibration.since ??= time;
    calibration.readings.push(value);
    const duration = calibration.target === 'flash' ? Math.max(4000, (Number(speed.value) || 200) * 10) : 400;
    if (time - calibration.since < duration || calibration.readings.length < 5) return;
    const { target, readings } = calibration;
    calibration = undefined;
    readings.sort((a, b) => a - b);
    const median = readings[Math.floor(readings.length / 2)];
    if (target === 'dark') {
      dark = median;
      status.textContent = '熄燈校準完成。請讓光源持續亮起後校準亮燈。';
    } else {
      if (target === 'flash') {
        dark = readings[Math.floor((readings.length - 1) * 0.15)];
        light = readings[Math.ceil((readings.length - 1) * 0.85)];
      } else light = median;
      status.textContent = light - dark >= 8
        ? '校準完成。開始解析後會從下一段完整訊號讀取。'
        : '亮暗差不足。請縮小範圍、重新對準或重新校準。';
    }
    update();
  }

  start.onclick = () => {
    if (decoder) {
      clearDecoder();
      status.textContent = '已暫停解析。';
    } else {
      const unit = Number(speed.value);
      if (!speed.value || unit < 150 || unit > 2000) {
        status.textContent = '請輸入 150～2000 ms 的時間單位。';
        return;
      }
      decoder = createDecoder(unit, text => {
        if (text !== ' ' || (result.value && !result.value.endsWith(' '))) result.value += text;
        result.scrollTop = result.scrollHeight;
      }, code => { symbols.textContent = code ? `點劃 ${code}` : ''; });
      status.textContent = '解析中，請保持光源在選取框內。';
    }
    update();
  };
  $('receive-clear').onclick = () => {
    result.value = '';
    decoder?.reset();
    bright = false;
  };

  function inspectFrame(time) {
    if (lastFrame !== undefined) {
      const elapsed = time - lastFrame;
      frameInterval = frameInterval ? frameInterval * 0.85 + elapsed * 0.15 : elapsed;
    }
    lastFrame = time;
    if (!locked) return;
    const value = readBrightness();
    if (calibration) finishCalibration(value, time);
    if (decoder) {
      const contrast = light - dark;
      bright = value >= dark + contrast * (bright ? 0.35 : 0.65);
      decoder.sample(time, bright);
    }
    if (lastReport === undefined || time - lastReport >= 200) {
      const fps = frameInterval ? Math.round(1000 / frameInterval) : 0;
      const contrast = light === undefined ? '' : ` · 校準亮暗差 ${Math.round(light - dark)}`;
      const slow = frameInterval * 4 > Number(speed.value) ? ' · 取樣偏慢，請增加收發兩端的時間單位' : '';
      signal.textContent = `框內亮度 ${Math.round(value)}／255 · ${fps} fps${contrast}${slow}`;
      lastReport = time;
    }
  }

  function nextFrame(run) {
    const callback = (now, metadata) => {
      if (!isActive(run)) return;
      const mediaTime = metadata?.mediaTime ?? video.currentTime;
      if (video.readyState >= 2 && video.videoWidth && mediaTime !== lastVideoTime) {
        lastVideoTime = mediaTime;
        try {
          inspectFrame(mediaTime * 1000);
        } catch {
          stop('相機影格無法讀取，請重新開啟鏡頭。');
          status.textContent = '相機影格無法讀取，請重新開啟鏡頭。';
          return;
        }
      }
      nextFrame(run);
    };
    sampleId = nativeFrames ? video.requestVideoFrameCallback(callback) : requestAnimationFrame(callback);
  }

  open.onclick = async () => {
    if (session) { stop('接收鏡頭已關閉'); return; }
    const run = begin('正在等待相機權限');
    session = run;
    open.textContent = '關閉接收鏡頭';
    status.textContent = '正在等待相機權限…';
    run.controller.signal.addEventListener('abort', () => {
      if (sampleId !== undefined) {
        if (nativeFrames) video.cancelVideoFrameCallback(sampleId);
        else cancelAnimationFrame(sampleId);
      }
      sampleId = session = drag = lastFrame = frameInterval = lastReport = lastVideoTime = undefined;
      video.srcObject = null;
      panel.hidden = true;
      open.textContent = '開啟接收鏡頭';
      status.textContent = '鏡頭未開啟';
      signal.textContent = '';
      unlock();
    }, { once: true });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('請使用手機瀏覽器開啟 HTTPS 網址。');
      if (!context) throw new Error('瀏覽器無法讀取相機畫面。');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { exact: 'environment' }, frameRate: { ideal: 30 } }
      });
      if (!isActive(run)) { stream.getTracks().forEach(track => track.stop()); return; }
      run.stream = stream;
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (isActive(run)) stop('接收鏡頭已中斷');
      }, { once: true });
      video.srcObject = stream;
      panel.hidden = false;
      await video.play();
      if (!isActive(run)) return;
      $('status').textContent = '接收鏡頭運作中';
      status.textContent = '將選取框對準光源，再鎖定。';
      drawBox();
      nextFrame(run);
    } catch (error) {
      if (!isActive(run)) return;
      const note = error.name === 'NotAllowedError' ? '請允許相機權限後再試。'
        : error.name === 'Error' ? error.message : '無法開啟後置相機，請關閉其他相機應用程式後再試。';
      stop(note);
      status.textContent = note;
    }
  };
}
