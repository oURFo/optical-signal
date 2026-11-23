import { cleanMessage, encode, schedule } from './morse.mjs';
import { setupReceiver } from './receiver.mjs?v=3';

const $ = id => document.getElementById(id);
const panel = $('panel');
const stage = $('stage');
const status = $('status');
const wakeStatus = $('wake-status');
const message = $('message');
const preview = $('preview');
const mode = $('mode');
const palette = [['紅', '#ff0000'], ['藍', '#0066ff'], ['黃', '#ffd000'], ['白', '#ffffff'], ['黑／滅', '#000000']];
const colors = [palette[0][1], palette[2][1], palette[1][1]];
let active = null;

function stop(note = '已停止', restoreFocus = true) {
  const run = active;
  active = null;
  if (run) {
    run.controller.abort();
    run.stream?.getTracks().forEach(track => track.stop());
    void run.lock?.release().catch(() => {});
  }
  if (document.fullscreenElement === stage) void document.exitFullscreen().catch(() => {});
  stage.hidden = true;
  panel.hidden = false;
  message.readOnly = false;
  preview.querySelector('.active')?.classList.remove('active');
  status.textContent = note;
  wakeStatus.hidden = true;
  if (restoreFocus && run?.screen) run.trigger?.focus({ preventScroll: true });
}

function begin(note, screen = false) {
  stop(note, false);
  const run = { controller: new AbortController(), screen, trigger: document.activeElement };
  active = run;
  const showWakeUnavailable = () => {
    if (active !== run) return;
    wakeStatus.textContent = '防休眠未啟用，手機可能依系統設定鎖定。';
    wakeStatus.hidden = false;
  };
  if (!navigator.wakeLock) showWakeUnavailable();
  else void navigator.wakeLock.request('screen').then(lock => {
    if (active !== run) return lock.release();
    run.lock = lock;
    lock.addEventListener('release', showWakeUnavailable, { once: true });
    if (lock.released) showWakeUnavailable();
  }).catch(showWakeUnavailable);
  return run;
}

function delay(run, ms) {
  const { signal } = run.controller;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', cancel, { once: true });
  });
}

async function screenEffect(sequence, interval, split) {
  const run = begin('螢幕警示運作中', true);
  panel.hidden = true;
  stage.hidden = false;
  stage.classList.toggle('horizontal', split === 'horizontal');
  $('second').hidden = !split;
  stage.focus({ preventScroll: true });
  if (!document.fullscreenElement && stage.requestFullscreen) {
    void stage.requestFullscreen().then(() => {
      if (active !== run && !active?.screen && document.fullscreenElement === stage) {
        return document.exitFullscreen();
      }
    }).catch(() => {});
  }
  try {
    let index = 0;
    while (active === run) {
      $('first').style.backgroundColor = sequence[index];
      if (split) $('second').style.backgroundColor = sequence[1 - index];
      await delay(run, interval);
      index = (index + 1) % sequence.length;
    }
  } catch {
    if (active === run) stop('螢幕警示已停止');
  }
}

async function openTorch(run) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('相機功能無法使用。請在手機的 HTTPS 網頁中開啟。');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: { exact: 'environment' } }
  });
  if (active !== run) {
    stream.getTracks().forEach(track => track.stop());
    throw run.controller.signal.reason;
  }
  run.stream = stream;
  const [track] = stream.getVideoTracks();
  if (!track?.getCapabilities?.().torch) {
    throw new Error('這個後置鏡頭或瀏覽器不支援 LED 控制。你仍可使用螢幕警示。');
  }
  track.addEventListener('ended', () => {
    if (active === run) stop('相機連線已中斷');
  }, { once: true });
  return track;
}

async function torchEffect(steps, unit, repeat, label, highlight = false) {
  if (!steps.length) return;
  const run = begin('正在等待相機權限');
  message.readOnly = highlight;
  try {
    const track = await openTorch(run);
    if (active !== run) return;
    status.textContent = label;
    do {
      for (const step of steps) {
        if (active !== run) return;
        await track.applyConstraints({ advanced: [{ torch: step.on }] });
        if (active !== run) return;
        if (highlight) {
          preview.querySelector('.active')?.classList.remove('active');
          preview.children[step.index]?.classList.add('active');
        }
        await delay(run, step.units * unit);
      }
    } while (repeat && active === run);
    if (active === run) stop('摩斯碼發送完成');
  } catch (error) {
    if (active !== run) return;
    const messages = {
      NotAllowedError: '相機權限遭拒。可在瀏覽器設定允許相機後再試。',
      NotFoundError: '找不到可用的後置相機。',
      OverconstrainedError: '裝置無法使用指定的後置相機或 LED。',
      NotReadableError: '無法啟用相機。請關閉其他使用相機的應用程式後再試。'
    };
    stop(messages[error?.name] || (error?.name === 'Error' ? error.message : 'LED 控制失敗。你仍可使用螢幕警示。'));
  }
}

function renderColors() {
  const count = Number(mode.value) || 2;
  $('colors').replaceChildren(...colors.slice(0, count).map((color, index) => {
    const group = document.createElement('div');
    group.className = 'color-group';
    const label = document.createElement('label');
    label.textContent = `色彩 ${'ABC'[index]}`;
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = color;
    label.append(picker);
    const select = document.createElement('select');
    select.setAttribute('aria-label', `色彩 ${'ABC'[index]} 預設色票`);
    select.append(new Option('自訂色', ''), ...palette.map(([name, value]) => new Option(name, value)));
    const syncPreset = () => { select.value = palette.some(([, value]) => value === picker.value) ? picker.value : ''; };
    picker.oninput = () => { colors[index] = picker.value; syncPreset(); };
    select.onchange = () => {
      if (select.value) colors[index] = picker.value = select.value;
    };
    syncPreset();
    group.append(label, select);
    return group;
  }));
}

function renderMorse() {
  const cleaned = cleanMessage(message.value);
  if (message.value !== cleaned) {
    const position = cleanMessage(message.value.slice(0, message.selectionStart)).length;
    message.value = cleaned;
    message.setSelectionRange(position, position);
  }
  const tokens = encode(cleaned);
  preview.replaceChildren(...tokens.map(({ code }) => {
    const span = document.createElement('span');
    span.textContent = code || '/';
    return span;
  }));
  if (!tokens.length) preview.textContent = '輸入後顯示摩斯碼';
  $('send').disabled = !tokens.length;
}

for (const [id, suffix] of [['interval', 'ms'], ['period', '秒'], ['unit', 'ms']]) {
  const slider = $(id);
  const update = () => { $(`${id}-value`).value = `${slider.value} ${suffix}`; };
  slider.addEventListener('input', update);
  update();
}

mode.onchange = renderColors;
message.addEventListener('input', event => { if (!event.isComposing) renderMorse(); });
message.addEventListener('compositionend', renderMorse);
$('screen').onclick = () => {
  const count = Number(mode.value);
  const sequence = count === 1 ? [colors[0], '#000000'] : colors.slice(0, count || 2);
  void screenEffect(sequence, Number($('interval').value), count ? null : mode.value);
};
$('red').onclick = () => void screenEffect([palette[0][1], '#000000'], 200);
$('amber').onclick = () => void screenEffect([palette[0][1], palette[2][1]], 200);
$('torch').onclick = () => void torchEffect([
  { on: true, units: 300 }, { on: false, units: Number($('period').value) * 1000 - 300 }
], 1, true, 'LED 定時閃爍中');
$('send').onclick = () => {
  const repeat = $('loop').checked;
  void torchEffect(schedule(encode(message.value), repeat), Number($('unit').value), repeat, '摩斯碼發送中', true);
};
$('sos').onclick = () => void torchEffect(schedule([{ code: '...---...' }], true), 200, true, 'SOS 發送中');
$('stop').onclick = () => stop();
stage.onclick = () => stop();
document.addEventListener('visibilitychange', () => {
  if (document.hidden && active) stop('切到背景時已停止', false);
});
window.addEventListener('pagehide', () => { if (active) stop('已離開頁面', false); });
document.addEventListener('fullscreenchange', () => {
  if (active?.screen && document.fullscreenElement === stage) active.fullscreen = true;
  else if (active?.fullscreen) stop();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) stop(); });
renderColors();
renderMorse();
setupReceiver({ begin, stop, isActive: run => active === run });
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => {});
