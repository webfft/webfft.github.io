import * as utils from '../utils.js';

const { PI, abs, min, max, sign, ceil, floor, log2, log10 } = Math;
const { $, clamp, dcheck } = utils;

let gui = new dat.GUI({ name: 'Config' });
let canvas_fft = $('#spectrogram');
let div_mover = $('#mover');
let canvas_overlay = $('#overlay');
let canvas_spectrum = $('#spectrum');
let canvas_timeline = $('#timeline');
let canvas_timespan = $('#timespan');
let canvas_volumes = $('#volumes');
let actions = [];
let timer = 0;
let config = {}, prev_config = {};
config.sampleRate = 48000;
config.frameSize = 1024;
config.dbRange = 1.5; // log10(re^2+im^2)
config.audioKbps = 128;
config.timeMin = 0; // sec
config.timeMax = 0; // sec
let audio_file = null;
let audio_signal = null;
let spectrogram = null;
let selected_area = null;
let playing_sound = null;
let mic_stream = null;
// let db_log = (s) => clamp(log10(s) / config.dbRange + 1); // 0.001..1 -> -3..0 -> 0..1
let db_log = (a2) => a2 ** (0.5 / config.dbRange); // 0.001..1 -> 0.1..1
let rgb_fn = (db) => [db * 9.0, db * 3.0, db * 1.0];

window.onload = init;
window.onerror = (event, source, lineno, colno, error) => showStatus(error);
window.onunhandledrejection = (event) => showStatus(event.reason);

function init() {
  $('#open').onclick = () => schedule(openFile);
  $('#record').onclick = () => schedule(recordAudio);
  $('#play').onclick = () => schedule(playSelectedArea);
  $('#save').onclick = () => schedule(saveSelectedArea);
  $('#grid').onclick = () => schedule(toggleGridMode);
  $('#reset').onclick = () => stopCurrentAction();
  toggleGridMode();
  initMouseHandlers();
  initDatGUI();
}

function initDatGUI() {
  gui.add(config, 'sampleRate', 4000, 48000, 1000).name('Hz').onFinishChange(processUpdatedConfig);
  gui.add(config, 'frameSize', 256, 4096, 256).name('N').onFinishChange(processUpdatedConfig);
  gui.add(config, 'dbRange', 0.25, 5, 0.25).name('dB').onFinishChange(processUpdatedConfig);
  gui.add(config, 'audioKbps', 6, 128, 1).name('kbps');
}

function schedule(callback, args = []) {
  actions.push([callback, args]);
  console.debug('scheduled:', callback.name);
  if (!timer) timer = setTimeout(perform, 0);
}

async function perform() {
  timer = 0;
  let [action] = actions.splice(0, 1);
  if (!action) return;
  let [callback, args] = action;
  console.debug('running:', callback.name);
  let ts = Date.now();
  await callback(...args);
  let dt = (Date.now() - ts) / 1000;
  if (dt > 0.1) console.debug(callback.name, 'time:', dt.toFixed(1), 'sec');
  timer = setTimeout(perform, 0);
}

function showStatus(...args) {
  let text = args.join(' ');
  text && console.info(text);
  $('#status').style.display = text ? '' : 'none';
  $('#status').innerText = text;
  return utils.sleep(10);
}

function processUpdatedConfig() {
  config.frameSize = 2 ** (log2(config.frameSize) | 0);
  config.sampleRate = (config.sampleRate / 1000 | 0) * 1000;

  if (config.sampleRate != prev_config.sampleRate)
    schedule(decodeAudioFile);
  else if (config.frameSize != prev_config.frameSize)
    schedule(computeSpectrogram);
  else if (config.dbRange != prev_config.dbRange)
    schedule(drawSpectrogram);
  else
    console.debug('config hasnt changed');

  prev_config = JSON.parse(JSON.stringify(config));
  gui.updateDisplay();
}

async function resetView() {
  config.sampleRate = 48000;
  config.timeMin = 0;
  config.timeMax = 0;
  await decodeAudioFile();
  processUpdatedConfig();
}

async function openFile() {
  let file = await utils.selectAudioFile();
  if (!file) return;
  audio_file = file;
  config.timeMin = 0;
  config.timeMax = 0;
  await decodeAudioFile();
}

async function decodeAudioFile() {
  let sr = config.sampleRate;
  let size_kb = (audio_file.size / 1024).toFixed(0);
  await showStatus('Decoding audio:', size_kb, 'KB @', sr, 'Hz');
  audio_signal = await utils.decodeAudioFile(audio_file, sr);
  if (!config.timeMin && !config.timeMax)
    config.timeMax = audio_signal.length / sr;
  await computeSpectrogram();
}

async function recordAudio() {
  await showStatus('Requesting mic access');
  mic_stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  await showStatus('Initializing MediaRecorder');
  let recorder = new MediaRecorder(mic_stream, {
    mimeType: 'audio/webm;codecs=opus',
    audioBitsPerSecond: config.audioKbps * 1000 | 0,
  });

  let chunks = [];
  recorder.ondataavailable = async (e) => {
    chunks.push(e.data);
    audio_file = new Blob(chunks, { type: recorder.mimeType });
    config.timeMin = 0;
    config.timeMax = 0;
    await decodeAudioFile();
  };

  await showStatus('Recording...');
  recorder.start();
}

function stopRecording() {
  console.info('Releasing mic'); // this will stop the recorder
  mic_stream.getTracks().map((t) => t.stop());
  mic_stream = null;
}

function getAudioWindow() {
  if (!audio_signal)
    return null;
  let sr = config.sampleRate;
  let i = config.timeMin * sr | 0;
  let j = config.timeMax * sr | 0;
  let n = audio_signal.length;
  if (i >= 0 && j <= n)
    return audio_signal.subarray(i, j);
  dcheck(j - i < 50e6);
  let res = new Float32Array(j - i);
  let src = audio_signal.subarray(max(0, i), min(n, j));
  res.set(src, max(0, -i));
  console.debug('Copied audio signal:', i, '..', j);
  return res;
}

function moveFreqsRange(step = 0, is_temp = false) {
  dcheck(abs(step) <= 1);
  let sr1 = config.sampleRate;
  let sr2 = min(48000, sr1 * (1 + step)) | 0;

  if (is_temp) {
    let ty = ((sr2 - sr1) / sr1 * 100).toFixed(2);
    canvas_fft.style.transform = `translateY(${ty}%)`;
  } else {
    console.info('New sample rate:', sr2, 'Hz');
    config.sampleRate = sr2;
    processUpdatedConfig();
    resetCanvasTransform();
  }
}

async function moveTimeline(step = 0.0, is_temp = false) {
  if (step == 0.0) return;
  let a = config.timeMin;
  let b = config.timeMax;
  let a2 = a + (b - a) * -step;
  let b2 = b + (b - a) * -step;

  if (is_temp) {
    let tx = (step * 100).toFixed(2);
    canvas_fft.style.transform = `translateX(${tx}%)`;
  } else {
    config.timeMin = a2;
    config.timeMax = b2;
    await computeSpectrogram();
    resetCanvasTransform();
  }
}

function resetCanvasTransform() {
  canvas_fft.style.transform = '';
}

async function zoomTimeline(zoom = 1.0) {
  if (zoom == 1.0) return;
  let a = config.timeMin;
  let b = config.timeMax;
  let a2 = (a + b) / 2 - (b - a) / 2 * zoom;
  let b2 = (a + b) / 2 + (b - a) / 2 * zoom;
  config.timeMin = a2;
  config.timeMax = b2;
  await computeSpectrogram();
}

async function computeSpectrogram() {
  let num_frames = canvas_fft.width;
  let frame_size = config.frameSize;
  let time_min = config.timeMin.toFixed(2);
  let time_max = config.timeMax.toFixed(2);
  let time_span = time_min + '..' + time_max;
  await showStatus('Computing DFT:', time_span, 'sec @', num_frames, 'x', frame_size);
  let audio_window = getAudioWindow();
  spectrogram = utils.computePaddedSpectrogram(audio_window, num_frames, frame_size);
  drawSpectrogram();
  await showStatus('');

  let _t = audio_window.length;
  let _w = num_frames;
  let _f = frame_size;
  let _fft = _w * _f * log2(_f);
  let _cwt = _f * _t * log2(_t);
  console.debug('CWT vs FFT runtime:', (_cwt / _fft).toFixed(2) + 'x');
}

function drawSpectrogram() {
  utils.drawSpectrogram(canvas_fft, spectrogram, { db_log, rgb_fn });

  let vol_timeline = utils.getVolumeTimeline(spectrogram);

  drawTimespanView(canvas_timespan);
  drawAvgSpectrum();
  drawVolumeTimeline(canvas_timeline, vol_timeline);
  drawAmpDensity();
}

function drawTimespanView(canvas) {
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');

  let sr = config.sampleRate;
  let t1 = config.timeMin * sr / audio_signal.length;
  let t2 = config.timeMax * sr / audio_signal.length;
  let rx = t1 * cw | 0;
  let rw = (t2 - t1) * cw | 0;
  let rh = ch / 8 | 0;
  let ry = ch * 0.5 - rh * 0.5 | 0;

  ctx.clearRect(0, 0, cw, ch);
  ctx.strokeStyle = '#fc2';
  ctx.fillStyle = '#f82';

  ctx.moveTo(0, ch / 2);
  ctx.lineTo(cw, ch / 2);
  ctx.stroke();
  ctx.fillRect(rx, ry, rw, rh);
}

function drawAmpDensity(canvas = canvas_volumes) {
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, cw, ch);
  let amp_density = utils.getAmpDensity(spectrogram, ch);
  let amp_max = amp_density.reduce((s, x) => max(s, x), 0);

  img.data.fill(0);

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let s = (ch - 1 - y) / ch;
      let f = s * amp_density.length | 0;
      let a = Math.abs((x + 0.5) / cw * 2 - 1);
      let a_max = (amp_density[f] / amp_max) ** 0.25;
      if (a > a_max) continue;
      let [r, g, b] = rgb_fn(s);
      let i = (y * cw + x) * 4;
      img.data[i + 0] = 255 * r;
      img.data[i + 1] = 255 * g;
      img.data[i + 2] = 255 * b;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

function drawAvgSpectrum(canvas = canvas_spectrum) {
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, cw, ch);
  let avg_spectrum = utils.getAvgSpectrum(spectrogram);
  let abs_max = avg_spectrum.reduce((s, x) => max(s, x), 0);

  img.data.fill(0);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let f = (ch - 1 - y) / ch * avg_spectrum.length / 2 | 0;
      let a = Math.abs((x + 0.5) / cw * 2 - 1);
      let a_max = db_log(avg_spectrum[f] / abs_max);
      if (a > a_max) continue;
      let [r, g, b] = rgb_fn(a_max);
      let i = (y * cw + x) * 4;
      img.data[i + 0] = 255 * r;
      img.data[i + 1] = 255 * g;
      img.data[i + 2] = 255 * b;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

function drawVolumeTimeline(canvas, vol_timeline) {
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, cw, ch);
  img.data.fill(0);

  let vol_max = vol_timeline.reduce((s, x) => max(s, x), 0);

  for (let x = 0; x < cw; x++) {
    for (let y = 0; y < ch; y++) {
      let t = x / cw * vol_timeline.length | 0;
      let a = Math.abs((y + 0.5) / ch * 2 - 1);
      let a_max = vol_timeline[t] / vol_max;
      if (a > a_max) continue;
      let [r, g, b] = rgb_fn(a_max);
      let i = (y * cw + x) * 4;
      img.data[i + 0] = 255 * r;
      img.data[i + 1] = 255 * g;
      img.data[i + 2] = 255 * b;
      img.data[i + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

function drawPointTag(x0, y0) {
  let audio_window = getAudioWindow();
  if (!audio_window) return;

  let canvas = canvas_overlay;
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');

  let sr = config.sampleRate;
  let x = x0 * canvas.width | 0;
  let y = y0 * canvas.height | 0;
  let t = (x - 0) / cw * audio_window.length / sr;
  let f = (ch - 1 - (y - 0)) / ch * sr / 2;

  let sec = t.toFixed(2) + 's';
  let hz = f.toFixed(0) + ' Hz';
  let text = hz + ' ' + sec;
  let radius = 5;

  ctx.fillStyle = '#0f0';
  ctx.font = '18px monospace';
  ctx.fillText(text, x + 1.5 * radius, y - 1.5 * radius);

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * PI, false);
  ctx.fill();
}

async function selectArea(is_final, dx, dy, dw, dh) {
  let sr = config.sampleRate;
  let aw = sr * (config.timeMax - config.timeMin);
  let t1 = dx * aw | 0;
  let t2 = (dx + dw) * aw | 0;
  let f2 = (1 - dy) * sr / 2 | 0;
  let f1 = (1 - dy - dh) * sr / 2 | 0;

  selected_area = { t1, t2, f1, f2, dx, dy, dw, dh };
  drawSelectedArea();
  if (!is_final) return;

  let t_span = (t1 / sr).toFixed(2) + '..' + (t2 / sr).toFixed(2) + ' s';
  let f_span = f1 + '..' + f2 + ' Hz';
  console.info('Selected sound:', t_span, 'x', f_span);
}

function drawSelectedArea(area = selected_area, vline_dx = 0) {
  let canvas = canvas_overlay;
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, cw, ch);
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = 2;

  let { dx, dy, dw, dh } = area || { dx: 0, dy: 0, dw: 1, dh: 1 };

  if (area)
    ctx.strokeRect(dx * cw, dy * ch, dw * cw, dh * ch);

  if (vline_dx > 0) {
    let x0 = dx + dw * vline_dx;
    ctx.beginPath();
    ctx.moveTo(cw * x0, ch * dy);
    ctx.lineTo(cw * x0, ch * (dy + dh));
    ctx.stroke();
  }
}

async function playSelectedArea() {
  if (playing_sound) {
    stopSound();
    return;
  }

  if (!selected_area) {
    await playSound();
    return;
  }

  await extractSelectedSound();
  await playSound(selected_area.wave);
}

async function extractSelectedSound() {
  if (selected_area.wave)
    return;

  let sr = config.sampleRate;
  let aw = getAudioWindow();
  let { t1, t2, f1, f2 } = selected_area;

  await showStatus('Applying bandpass filter');
  let len = 2 ** ceil(log2(t2 - t1));
  let aw2 = new Float32Array(len);
  aw2.set(aw.subarray(t1, t2), 0);
  let aw3 = utils.applyBandpassFilter(aw2,
    f1 / sr * 2 * len / 2 | 0,
    f2 / sr * 2 * len / 2 | 0);

  let aw4 = aw3.subarray(0, t2 - t1);
  let amp_max = aw4.reduce((s, x) => max(s, abs(x)), 0);
  for (let i = 0; i < len; i++)
    aw4[i] /= max(1e-6, amp_max);

  selected_area.wave = aw4;
}

async function saveSelectedArea() {
  let wave = audio_signal;
  if (selected_area) {
    await extractSelectedSound();
    wave = selected_area.wave;
  }

  await showStatus('Generating a .wav file');
  let data = utils.generateWavFile(wave, config.sampleRate);
  let blob = new Blob([data], { type: 'audio/wav' });
  let a = document.createElement('a');
  a.download = blob.size + '.wav';
  a.href = URL.createObjectURL(blob);
  a.click();
  await showStatus('');
}

async function playSound(signal = audio_signal) {
  let sr = config.sampleRate;
  let duration = signal.length / sr;
  await showStatus('Playing sound:', duration.toFixed(2), 'sec');
  let ctx = new AudioContext({ sampleRate: sr });

  try {
    let buffer = ctx.createBuffer(1, signal.length, sr);
    buffer.getChannelData(0).set(signal, 0);
    let src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    playing_sound = { ctx, src };
    drawPlaybackProgress();
    src.start();
    await new Promise((resolve) => src.onended = resolve);
    console.debug('Sound playback ended');
    await showStatus('');
  } finally {
    ctx.close();
    playing_sound = null;
    showStatus('');
  }
}

function drawPlaybackProgress() {
  if (!playing_sound)
    return;

  let ctx = playing_sound.ctx;
  let src = playing_sound.src;
  let time0 = ctx.currentTime;
  let duration = src.buffer.duration;

  let timer = setInterval(() => {
    if (!playing_sound) {
      clearInterval(timer);
      console.debug('Stopped playback timer');
      return;
    }
    let dt = ctx.currentTime - time0;
    drawSelectedArea(selected_area, dt / duration);
  }, 15);
}

async function stopSound() {
  await showStatus('Stopping playback');
  playing_sound?.src.stop();
}

function toggleGridMode() {
  $('#grid').classList.toggle('disabled');
  let css = canvas_overlay.style;
  css.display = css.display == 'none' ? '' : 'none';
  if (css.display == 'none') {
    selected_area = null;
    drawSelectedArea();
  }
}

function initMouseHandlers() {
  attachMouseHandlers(canvas_overlay, {
    point: (x, y) => schedule(drawPointTag, [x, y]),
    select: (x, y, w, h) => selectArea(true, x, y, w, h),
    selecting: (x, y, w, h) => selectArea(false, x, y, w, h),
  });

  attachMouseHandlers(div_mover, {
    hmove: (dx) => schedule(moveTimeline, [dx]),
    vmove: (dy) => schedule(moveFreqsRange, [dy]),
    hmoving: (dx) => schedule(moveTimeline, [dx, true]),
    vmoving: (dy) => schedule(moveFreqsRange, [dy, true]),
    reset: () => resetCanvasTransform(),
    hzoom: (zoom) => schedule(zoomTimeline, [zoom]),
  });
}

function attachMouseHandlers(element, handlers) {
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  let t2_start, t2_end; // 2-touch zoom on phones

  let touch_xy = (t) => [
    t.clientX - t.target.offsetLeft,
    t.clientY - t.target.offsetTop];
  let touch_copy = (t) => {
    let [x, y] = touch_xy(t);
    let id = t.identifier;
    return { id, x, y };
  };

  // TouchEvent handlers
  element.ontouchstart = (e) => {
    e.preventDefault();
    let touches = e.changedTouches;
    if (touches.length == 1)
      [x1, y1] = touch_xy(touches[0]);
    else if (touches.length == 2)
      t2_start = touches.map(touch_copy);
  };
  element.ontouchcancel = (e) => {
    e.preventDefault();
    x1 = y1 = 0;
    t2_start = null;
    handlers.reset?.();
  };
  element.ontouchmove = (e) => {
    e.preventDefault();
    let touches = e.changedTouches;
    if (touches.length == 1) {
      [x2, y2] = touch_xy(touches[0]);
      reportState(false);
    }
  };
  element.ontouchend = (e) => {
    e.preventDefault();
    let touches = e.changedTouches;
    if (touches.length == 1) {
      [x2, y2] = touch_xy(touches[0]);
      reportState(true);
    } else if (touches.length == 2) {
      t2_end = touches.map(touch_copy);
      if (t2_end[0].id != t2_start[0].id)
        t2_end = t2_end.reverse();
      reportState(true);
    }
  };

  // MouseEvent handlers
  element.onmousewheel = (e) => {
    e.preventDefault();
    if (actions.length > 0) return;
    let zoom = 2 ** sign(e.deltaY);
    handlers.hzoom?.(zoom);
  };
  element.onmousedown = (e) => {
    e.preventDefault();
    x1 = e.offsetX;
    y1 = e.offsetY;
  };
  element.onmouseout = (e) => {
    e.preventDefault();
    x1 = y1 = 0;
    handlers.reset?.();
  };
  element.onmousemove = (e) => {
    e.preventDefault();
    x2 = e.offsetX;
    y2 = e.offsetY;
    reportState(false);
  };
  element.onmouseup = (e) => {
    e.preventDefault();
    x2 = e.offsetX;
    y2 = e.offsetY;
    reportState(true);
  };

  function reportState(is_final) {
    if (actions.length > 0)
      return;

    if (t2_start) {
      dcheck(t2_start[0].id == t2_end[0].id);
      dcheck(t2_start[1].id == t2_end[1].id);
      let a1 = touch_xy(t2_start[0]);
      let a2 = touch_xy(t2_start[1]);
      let b1 = touch_xy(t2_end[0]);
      let b2 = touch_xy(t2_end[1]);
      let w1 = abs(a1[0] - a2[0]);
      let w2 = abs(b1[0] - b2[0]);
      let zoom = w2 / w1;
      handlers.hzoom?.(zoom);
      return;
    }

    if (!x1 && !y1)
      return;

    let cw = element.clientWidth;
    let ch = element.clientHeight;
    x2 = clamp(x2, 0, cw);
    y2 = clamp(y2, 0, ch);
    let dx = x2 - x1;
    let dy = y2 - y1;
    let eps = 0.05;
    let h_move = abs(dx) / cw > eps;
    let v_move = abs(dy) / ch > eps;
    let x0 = min(x1, x2) / cw;
    let y0 = min(y1, y2) / ch;
    let w0 = abs(dx) / cw;
    let h0 = abs(dy) / ch;

    if (!is_final) {
      handlers.selecting?.(x0, y0, w0, h0);
      if (w0 > h0)
        handlers.hmoving?.(dx / cw);
      else
        handlers.vmoving?.(dy / ch);
    } else if (!h_move && !v_move) {
      handlers.point?.(x1 / cw, y1 / ch);
    } else {
      handlers.select?.(x0, y0, w0, h0);
      if (w0 > h0)
        handlers.hmove?.(dx / cw);
      else
        handlers.vmove?.(dy / ch);
    }

    if (is_final)
      x1 = y1 = 0;
  }
}

function stopCurrentAction() {
  if (playing_sound)
    stopSound();
  else if (mic_stream)
    stopRecording();
  else if (audio_signal)
    resetView();
}
