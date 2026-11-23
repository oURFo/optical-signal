import { createAutoDecoder } from './morse-speed.mjs?v=6';
import { createLightDetector } from './light-detector.mjs';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export function setupReceiver({ begin, stop, isActive }) {
  const $ = id => document.getElementById(id);
  const open = $('receive-open');
  const panel = $('receive-controls');
  const status = $('receive-status');
  const video = $('camera-preview');
  const view = $('camera-view');
  const frame = $('camera-roi');
  const signal = $('receive-signal');
  const symbols = $('receive-symbols');
  const result = $('receive-text');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 24;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pointers = new Map();
  let roi, anchor, pinch, zooming, session, sampleId, detector, timing;
  let side = 0.2;
  let detectedUnit;
  let lastFrame, frameInterval, lastReport, lastVideoTime;
  const nativeFrames = typeof video.requestVideoFrameCallback === 'function';

  function drawBox() {
    for (const [property, value] of Object.entries({ left: roi.x, top: roi.y, width: roi.w, height: roi.h })) {
      frame.style[property] = `${value * 100}%`;
    }
    frame.hidden = false;
    const below = 1 - roi.y - roi.h;
    const above = roi.y >= below;
    result.style.top = above ? 'auto' : `calc(${(roi.y + roi.h) * 100}% + 4px)`;
    result.style.bottom = above ? `calc(${(1 - roi.y) * 100}% + 4px)` : 'auto';
    result.style.maxHeight = `calc(${(above ? roi.y : below) * 100}% - 8px)`;
    result.hidden = !result.textContent;
    result.scrollTop = result.scrollHeight;
  }

  function placeBox(point) {
    anchor = point;
    roi = {
      x: clamp(anchor.x - side / 2, 0, 1 - side),
      y: clamp(anchor.y - side / 2, 0, 1 - side),
      w: side, h: side
    };
    drawBox();
  }

  function clearDecoder() {
    detector = timing = undefined;
    detectedUnit = undefined;
    symbols.textContent = '';
  }

  function pin(event) {
    const bounds = view.getBoundingClientRect();
    placeBox({
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1)
    });
    startDecoding();
  }

  function distance() {
    const [a, b] = pointers.values();
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  view.addEventListener('pointerdown', event => {
    if (!video.videoWidth || event.button !== 0 || pointers.size >= 2) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, moved: false });
    view.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      zooming = true;
      if (roi) {
        pinch = { distance: Math.max(1, distance()), side };
        clearDecoder();
        status.textContent = '調整選取框，放開後會繼續解析。';
      }
    }
  });
  view.addEventListener('pointermove', event => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    if (pinch && pointers.size === 2) {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      side = clamp(pinch.side * distance() / pinch.distance, 0.04, 0.7);
      placeBox(anchor);
    } else if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 12) {
      pointer.moved = true;
    }
  });
  for (const event of ['lostpointercapture', 'pointercancel', 'pointerup']) {
    view.addEventListener(event, interaction => {
      const pointer = pointers.get(interaction.pointerId);
      if (!pointer) return;
      pointers.delete(interaction.pointerId);
      if (pointers.size) return;
      if (zooming) {
        if (pinch) startDecoding();
      } else if (event === 'pointerup' && !pointer.moved
          && Math.hypot(interaction.clientX - pointer.x, interaction.clientY - pointer.y) <= 12) {
        pin(interaction);
      }
      pinch = zooming = undefined;
    });
  }
  view.addEventListener('keydown', event => {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const move = moves[event.key];
    if (!video.videoWidth || pointers.size || (!move && event.key !== 'Enter')) return;
    event.preventDefault();
    const { x, y } = anchor ?? { x: 0.5, y: 0.5 };
    placeBox(move ? { x: clamp(x + move[0] * 0.04, 0, 1), y: clamp(y + move[1] * 0.04, 0, 1) } : { x, y });
    startDecoding();
  });

  function readBrightness() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    context.drawImage(video, roi.x * width, roi.y * height, roi.w * width, roi.h * height, 0, 0, 24, 24);
    const { data } = context.getImageData(0, 0, 24, 24);
    const luminance = [];
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      luminance.push(value);
      sum += value;
    }
    luminance.sort((a, b) => a - b);
    const upper = luminance.slice(-9, -1);
    return [sum / luminance.length, upper.reduce((sum, value) => sum + value, 0) / upper.length];
  }

  function startDecoding() {
    clearDecoder();
    signal.textContent = '';
    timing = createAutoDecoder(text => {
      if (text !== ' ' || (result.textContent && !result.textContent.endsWith(' '))) {
        result.append(document.createTextNode(text));
        result.hidden = false;
      }
      result.scrollTop = result.scrollHeight;
    }, code => { symbols.textContent = code ? `點劃 ${code}` : ''; }, (unit, inverted) => {
      detectedUnit = unit;
      status.textContent = `已辨識速度：約 ${unit} ms／單位${inverted ? '，暗色為訊號' : ''}，正在解析。`;
    });
    let selected;
    const channels = [0, 1].map(index => createLightDetector(2000, (time, bright) => {
      selected ??= index;
      if (selected === index) timing.sample(time, bright);
    }));
    detector = {
      sample(time, values) {
        if (selected === undefined) {
          channels[0].sample(time, values[0]);
          if (selected === undefined) channels[1].sample(time, values[1]);
        } else channels[selected].sample(time, values[selected]);
        return values[selected ?? 0];
      },
      get contrast() { return channels[selected]?.contrast; },
      get bright() { return channels[selected]?.bright; }
    };
    status.textContent = '正在自動偵測閃光。';
  }

  $('receive-clear').onclick = () => {
    result.textContent = '';
    result.hidden = true;
    if (detector) startDecoding();
  };

  function inspectFrame(time) {
    if (lastFrame !== undefined) {
      const elapsed = time - lastFrame;
      frameInterval = frameInterval ? frameInterval * 0.85 + elapsed * 0.15 : elapsed;
    }
    lastFrame = time;
    if (!detector) return;
    const acquired = detector.contrast !== undefined;
    const value = detector.sample(time, readBrightness());
    if (!acquired && detector.contrast !== undefined && detectedUnit === undefined) {
      status.textContent = '已偵測到閃光，正在判斷速度，請等待更多訊號。';
    }
    if (lastReport === undefined || time - lastReport >= 200) {
      const fps = frameInterval ? Math.round(1000 / frameInterval) : 0;
      const contrast = detector?.contrast === undefined ? '' : ` · ${detector.bright ? '亮' : '滅'} · 亮暗差 ${Math.round(detector.contrast)}`;
      const slow = detectedUnit && frameInterval * 4 > detectedUnit ? ' · 短閃光可能因影格率偏低而漏判'
        : timing.unstable ? ' · 偵測到短暫跳動，請降低播放速度或避開反光' : '';
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
      sampleId = session = roi = anchor = pinch = zooming = lastFrame = frameInterval = lastReport = lastVideoTime = undefined;
      pointers.clear();
      video.srcObject = null;
      panel.hidden = true;
      open.textContent = '開啟接收鏡頭';
      status.textContent = '鏡頭未開啟';
      signal.textContent = '';
      frame.hidden = result.hidden = true;
      clearDecoder();
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
      status.textContent = '點一下預覽中的光源即可開始解析。';
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
