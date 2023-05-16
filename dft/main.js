import * as utils from '../utils.js';

const { PI, abs, min, max, sign, ceil, floor, log2, log10 } = Math;
const { $, mix, clamp, dcheck } = utils;

let gui = new dat.GUI({ name: 'Config' });
let canvas_fft = $('#spectrogram');
let div_mover = $('#mover');
let div_sarea = $('#sarea');
let div_sarea_buttons = $('#sarea_buttons');
let div_vline = $('#vline');
let div_hztag = $('#hztag');
let div_point = $('#point');
let div_overlay = $('#overlay');
let canvas_spectrum = $('#spectrum');
let canvas_timeline = $('#timeline');
let actions = [];
let timer = 0;
let config = {}, prev_config = {};
let defaultSampleRate = 48000;
config.mimeType = 'audio/webm;codecs=opus';
config.sampleRate = defaultSampleRate;
config.frameSize = 1024;
config.numFrames = 1024;
config.dbRange = 1.5; // log10(re^2+im^2)
config.audioKbps = 128;
config.timeMin = 0; // sec
config.timeMax = 0; // sec
let minSampleRate = 3000;
let maxSampleRate = 384000;
let audio_file = null;
let audio_signal = null;
let spectrogram = null;
let sub_spectrogram = null;
let selected_area = null;
let playing_sound = null;
let mic_stream = null;
let prev_audio_window = null;
// let db_log = (s) => clamp(log10(s) / config.dbRange + 1); // 0.001..1 -> -3..0 -> 0..1
let db_log = (a2) => a2 ** (0.5 / config.dbRange); // 0.001..1 -> 0.1..1
let rgb_fn = (db) => [db * 9.0, db * 3.0, db * 1.0];
let pct100 = (x) => (x * 100).toFixed(2) + '%';

window.onload = init;
window.onerror = (event, source, lineno, colno, error) => showStatus(error);
window.onunhandledrejection = (event) => showStatus(event.reason);

function init() {
  $('#play').onclick = () => schedule(playSelectedArea);
  $('#save').onclick = () => schedule(saveSelectedArea);
  $('#erase').onclick = () => schedule(eraseSelectedArea);
  $('#grid').onclick = () => schedule(toggleGridMode);
  $('#cross').onclick = () => schedule(toggleGridMode);
  $('#zoom').onclick = () => schedule(zoomIntoSelectedArea);
  $('#reset').onclick = () => stopCurrentAction();
  toggleGridMode();
  initMouseHandlers();
  initDatGUI();
  showStatus('', { 'Sample': openSample, 'Record': recordAudio2, 'Open': openFile });
}

function initDatGUI() {
  gui.close();
  gui.add(config, 'sampleRate', 4000, maxSampleRate, 1000).name('Hz').onFinishChange(processUpdatedConfig);
  gui.add(config, 'frameSize', 256, 4096, 256).name('N').onFinishChange(processUpdatedConfig);
  gui.add(config, 'numFrames', 256, 4096, 256).name('T').onFinishChange(processUpdatedConfig);
  gui.add(config, 'dbRange', 0.25, 5, 0.25).name('sens').onFinishChange(processUpdatedConfig);
  gui.add(config, 'audioKbps', 6, 128, 1).name('kbps');
  gui.add(config, 'mimeType').name('mimetype');
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

function showStatus(text, buttons) {
  let str = Array.isArray(text) ? text.join(' ') : text + '';
  str && console.info(str);
  $('#status').style.display = str || buttons ? '' : 'none';
  $('#status').innerText = str;
  if (buttons) {
    for (let name in buttons) {
      let handler = buttons[name];
      let a = document.createElement('a');
      a.innerText = name;
      a.onclick = () => { a.onclick = null; handler(); };
      $('#status').append(a);
    }
  }
  return utils.sleep(15);
}

function processUpdatedConfig() {
  config.frameSize = 2 ** (log2(config.frameSize) | 0);
  config.sampleRate = clamp((config.sampleRate / 1000 | 0) * 1000, minSampleRate, maxSampleRate);
  config.timeMin = (config.timeMin * 100 | 0) / 100;
  config.timeMax = (config.timeMax * 100 | 0) / 100;

  if (config.sampleRate != prev_config.sampleRate)
    schedule(decodeAudioFile);
  else if (config.frameSize != prev_config.frameSize || config.numFrames != prev_config.numFrames)
    schedule(computeSpectrogram);
  else if (config.timeMin != prev_config.timeMin || config.timeMax != prev_config.timeMax)
    schedule(computeSpectrogram);
  else if (config.dbRange != prev_config.dbRange)
    schedule(drawSpectrogram);
  else
    console.debug('config hasnt changed');

  prev_config = JSON.parse(JSON.stringify(config));
  gui.updateDisplay();
}

async function resetView() {
  config.sampleRate = defaultSampleRate;
  config.timeMin = 0;
  config.timeMax = 0;
  await decodeAudioFile();
  processUpdatedConfig();
}

async function openFile() {
  let file = await utils.selectAudioFile();
  if (!file) return;
  document.title = file.name;
  audio_file = file;
  config.timeMin = 0;
  config.timeMax = 0;
  await decodeAudioFile();
}

async function openSample() {
  await showStatus('Loading sample audio');
  let res = await fetch('lapwing.mp3');
  let file = await res.blob();
  audio_file = file;
  config.timeMin = 0;
  config.timeMax = 0;
  await decodeAudioFile();
}

async function decodeAudioFile() {
  if (!audio_file) return;
  initMinMaxSampleRate();
  let sr = config.sampleRate;
  let size_kb = (audio_file.size / 1024).toFixed(0);
  await showStatus(['Decoding audio:', size_kb, 'KB @', sr, 'Hz']);
  audio_signal = await utils.decodeAudioFile(audio_file, sr);
  if (!config.timeMin && !config.timeMax)
    config.timeMax = audio_signal.length / sr;
  await computeSpectrogram();
  $('#buttons').style.display = '';
}

async function recordAudio2() {
  await showStatus('Requesting mic access');
  mic_stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleSize: 16,
      sampleRate: config.sampleRate,
      echoCancellation: false,
      noiseSuppression: false,
      // autoGainControl: false,
      // latency: 0,
    }
  });
  try {
    let ctx = await utils.recordAudioWithWorklet(mic_stream, config.sampleRate);
    ctx.onaudiodata = (blob) => {
      audio_file = blob;
      decodeAudioFile();
    };
    await showStatus('Recording...', { 'Stop': stopRecording });
  } catch (err) {
    await stopRecording();
  }
}

async function recordAudio() {
  await showStatus('Requesting mic access');
  mic_stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  await showStatus('Initializing MediaRecorder');
  let recorder = new MediaRecorder(mic_stream, {
    mimeType: config.mimeType,
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

  await showStatus('Recording...', { 'Stop': stopRecording });
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
  let paw = prev_audio_window;
  if (paw && paw.src == audio_signal) {
    if (paw.min == i && paw.max == j)
      return paw.res;
  }
  let res = new Float32Array(j - i);
  let src = audio_signal.subarray(max(0, i), min(n, j));
  res.set(src, max(0, -i));
  console.debug('Copied audio signal:', i, '..', j);
  prev_audio_window = { src: audio_signal, res, min: i, max: j };
  return res;
}

function moveFreqsRange(step = 0, is_temp = false) {
  dcheck(abs(step) <= 1);
  let sr1 = config.sampleRate;
  let sr2 = min(maxSampleRate, sr1 * (1 + step)) | 0;

  if (is_temp) {
    let ty = ((sr2 - sr1) / sr1 * 100).toFixed(2);
    canvas_fft.style.transform = `translateY(${ty}%)`;
  } else {
    console.info('New sample rate:', sr2, 'Hz');
    config.sampleRate = sr2;
    processUpdatedConfig();
  }
}

function moveTimeline(step = 0.0, is_temp = false) {
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
    schedule(computeSpectrogram);
  }
}

function zoomIntoSelectedArea() {
  if (!selected_area) return;

  console.info('Zooming into the selected area');
  let { dx, dy, dw, dh } = selected_area;
  let t1 = mix(config.timeMin, config.timeMax, dx);
  let t2 = mix(config.timeMin, config.timeMax, dx + dw);
  let sr = config.sampleRate * (1 - dy);

  config.timeMin = t1;
  config.timeMax = t2;
  config.sampleRate = sr;

  processUpdatedConfig();
}

function resetCanvasTransform() {
  canvas_fft.style.transform = '';
}

function zoomTimeline(zoom = 1.0) {
  if (zoom == 1.0) return;
  let a = config.timeMin;
  let b = config.timeMax;
  let a2 = (a + b) / 2 - (b - a) / 2 * zoom;
  let b2 = (a + b) / 2 + (b - a) / 2 * zoom;
  config.timeMin = a2;
  config.timeMax = b2;
  schedule(computeSpectrogram);
}

async function computeSpectrogram() {
  let num_frames = config.numFrames;
  let frame_size = config.frameSize;
  let time_min = config.timeMin.toFixed(2);
  let time_max = config.timeMax.toFixed(2);
  let time_span = time_min + '..' + time_max;
  await showStatus(['Computing DFT:', time_span, 'sec @', num_frames, 'x', frame_size]);
  let audio_window = getAudioWindow();
  spectrogram = await utils.computePaddedSpectrogram(audio_window, { num_frames, frame_size });
  drawSpectrogram();
  await showStatus('');
  selected_area = null;
  drawSelectedArea();

  let _t = audio_window.length;
  let _w = num_frames;
  let _f = frame_size;
  let _fft = _w * _f * log2(_f);
  let _cwt = _f * _t * log2(_t);
  console.debug('CWT vs FFT runtime:', (_cwt / _fft).toFixed(2) + 'x');
}

function drawSpectrogram() {
  canvas_fft.width = config.numFrames;
  utils.drawSpectrogram(canvas_fft, spectrogram, { db_log, rgb_fn });
  resetCanvasTransform();
  selectArea(null);
  drawPointTag(0, 0);
}

function getSelectedSpectrogram() {
  if (!selected_area)
    return spectrogram;

  let aw = getAudioWindow();
  let sr = config.sampleRate;
  let t_len = aw.length;
  let f_len = sr / 2;
  let [num_frames, num_freqs] = spectrogram.dimensions;
  let { t1, t2, f1, f2 } = selected_area || { t1: 0, t2: t_len, f1: 0, f2: f_len };
  let frame1 = t1 / t_len * num_frames | 0;
  let frame2 = t2 / t_len * num_frames | 0;
  let freq1 = f1 / sr * num_freqs | 0;
  let freq2 = f2 / sr * num_freqs | 0;

  console.debug('Creating sub-spectrogram:',
    't=' + frame1 + '..' + frame2,
    'f=' + freq1 + '..' + freq2);

  return utils.getMaskedSpectrogram(spectrogram, (t, f) => {
    let f_abs = min(f, num_freqs - f);
    if (t < frame1 || t > frame2) return 0;
    if (f_abs < freq1 || f_abs > freq2) return 0;
    return 1;
  });
}

function drawAvgSpectrum() {
  if (!audio_signal) return;
  let canvas = canvas_spectrum;
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, cw, ch);
  let avg_spectrum = utils.getAvgSpectrum(sub_spectrogram || spectrogram);
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

function drawVolumeTimeline() {
  if (!audio_signal) return;
  let canvas = canvas_timeline;
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, cw, ch);
  let vol_timeline = utils.getVolumeTimeline(sub_spectrogram || spectrogram);
  let vol_max = vol_timeline.reduce((s, x) => max(s, x), 0);

  img.data.fill(0);

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
  if (!audio_signal) return;

  if (!x0 && !y0) {
    div_point.style.visibility = 'hidden';
    div_hztag.style.visibility = 'hidden';
    return;
  }

  let sr = config.sampleRate;
  let duration = config.timeMax - config.timeMin;
  let t = x0 * duration;
  let f = (1 - y0) * sr / 2;
  let sec = t.toFixed(2) + 's';
  let hz = f.toFixed(0) + ' Hz';
  let text = hz + ' ' + sec;

  div_point.style.visibility = 'visible';
  div_point.style.left = pct100(x0);
  div_point.style.top = pct100(y0);

  div_hztag.style.visibility = 'visible';
  div_hztag.style.right = pct100(1 - x0);
  div_hztag.style.bottom = pct100(1 - y0);
  div_hztag.innerText = text;
}

async function selectArea(area, is_final = !!area) {
  if (!audio_signal)
    return;

  if (!area) {
    selected_area = null;
  } else {
    let [dx, dy, dw, dh] = area;
    let sr = config.sampleRate;
    let len = sr * (config.timeMax - config.timeMin);
    let t1 = dx * len | 0;                // index
    let t2 = (dx + dw) * len | 0;         // index
    let f2 = (1 - dy) * sr / 2 | 0;       // Hz
    let f1 = (1 - dy - dh) * sr / 2 | 0;  // Hz

    selected_area = { t1, t2, f1, f2, dx, dy, dw, dh };

    if (is_final) {
      let t_span = (t1 / sr).toFixed(2) + '..' + (t2 / sr).toFixed(2) + ' s';
      let f_span = f1 + '..' + f2 + ' Hz';
      console.info('Selected sound:', t_span, 'x', f_span);
    }
  }

  drawSelectedArea();
  div_sarea_buttons.classList.toggle('final', is_final);

  if (is_final || !area) {
    sub_spectrogram = getSelectedSpectrogram();
    drawAvgSpectrum();
    drawVolumeTimeline();
  }
}

function drawSelectedArea(area = selected_area, vline_dx = 0) {
  let { dx, dy, dw, dh } = area || { dx: 0, dy: 0, dw: 1, dh: 1 };

  if (area) {
    div_sarea.style.left = pct100(dx);
    div_sarea.style.top = pct100(dy);
    div_sarea.style.width = pct100(dw);
    div_sarea.style.height = pct100(dh);
    div_sarea.style.visibility = 'visible';
    div_sarea_buttons.style.left = pct100(mix(0.05, 1.00, dx));
    div_sarea_buttons.style.top = pct100(mix(0.00, 0.95, dy));
    drawPointTag(dx + dw, dy + dh);
  } else {
    div_sarea.style.visibility = 'hidden';
  }

  if (vline_dx > 0) {
    div_vline.style.left = pct100(dx);
    div_vline.style.top = pct100(dy);
    div_vline.style.width = pct100(dw * vline_dx);
    div_vline.style.height = pct100(dh);
    div_vline.style.visibility = 'visible';
  } else {
    div_vline.style.visibility = 'hidden';
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

function filterSelectedSound(filter_fn) {
  if (!selected_area) return null;

  let sr = config.sampleRate;
  let aw = getAudioWindow();
  let { t1, t2, f1, f2 } = selected_area;

  let len = 2 ** ceil(log2(t2 - t1));
  let f_min = f1 / sr * 2 * len / 2 | 0;
  let f_max = f2 / sr * 2 * len / 2 | 0;

  let aw2 = new Float32Array(len);
  aw2.set(aw.subarray(t1, t2), 0);

  let aw3 = utils.applyBandpassFilter(aw2,
    (f) => filter_fn(f, f_min, f_max));

  return aw3.subarray(0, t2 - t1);
}

async function extractSelectedSound() {
  if (selected_area.wave) return;

  await showStatus('Applying bandpass filter');
  let wave = filterSelectedSound(
    (f, f_min, f_max) => f >= f_min && f <= f_max ? 1 : 0);

  let amp_max = wave.reduce((s, x) => max(s, abs(x)), 0);
  for (let i = 0; i < wave.length; i++)
    wave[i] /= max(1e-6, amp_max);

  selected_area.wave = wave;
}

async function eraseSelectedArea() {
  if (!selected_area) return;

  await showStatus('Applying bandpass filter');
  let wave = filterSelectedSound(
    (f, f_min, f_max) => f < f_min || f > f_max ? 1 : 0);

  let aw = getAudioWindow();
  let { t1, t2 } = selected_area;
  aw.subarray(t1, t2).set(wave); // overwrite

  await computeSpectrogram();
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

async function playSound(signal = getAudioWindow()) {
  let sr = config.sampleRate;
  let duration = signal.length / sr;
  await showStatus(['Playing sound:', duration.toFixed(2), 'sec'], { 'Stop': stopSound });
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
      drawSelectedArea(selected_area);
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

function toggle(div) {
  div.style.display = div.style.display ? '' : 'none';
}

function toggleGridMode() {
  toggle(div_overlay);
  toggle($('#grid'));
  toggle($('#cross'));

  if (div_overlay.style.display == 'none') {
    selected_area = null;
    sub_spectrogram = null;
    drawPointTag(0, 0);
    drawAvgSpectrum();
    drawVolumeTimeline();
    drawSelectedArea();
  }
}

function initMouseHandlers() {
  attachMouseHandlers(div_overlay, {
    point: (x, y) => { selectArea(null); drawPointTag(x, y); },
    select: (x, y, w, h) => selectArea([x, y, w, h], true),
    selecting: (x, y, w, h) => selectArea([x, y, w, h], false),
  });

  attachMouseHandlers(div_mover, {
    hmove: (dx) => moveTimeline(dx),
    vmove: (dy) => moveFreqsRange(dy),
    hmoving: (dx) => moveTimeline(dx, true),
    vmoving: (dy) => moveFreqsRange(dy, true),
    reset: () => resetCanvasTransform(),
    hzoom: (zoom) => zoomTimeline(zoom),
  });
}

function attachMouseHandlers(element, handlers) {
  let x1 = 0, y1 = 0, t1 = 0, x2 = 0, y2 = 0, t2 = 0;
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
    t1 = Date.now();
    let touches = e.changedTouches;
    if (touches.length == 1)
      [x1, y1] = touch_xy(touches[0]);
    else if (touches.length == 2)
      t2_start = touches.map(touch_copy);
  };
  element.ontouchcancel = (e) => {
    e.preventDefault();
    t1 = 0;
    t2_start = null;
    handlers.reset?.();
  };
  element.ontouchmove = (e) => {
    e.preventDefault();
    t2 = Date.now();
    let touches = e.changedTouches;
    if (touches.length == 1) {
      [x2, y2] = touch_xy(touches[0]);
      reportState(false);
    }
  };
  element.ontouchend = (e) => {
    e.preventDefault();
    t2 = Date.now();
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
    t1 = Date.now();
  };
  element.onmouseout = (e) => {
    e.preventDefault();
    if (!x1 && !y1) return;
    x2 = e.offsetX;
    y2 = e.offsetY;
    t2 = Date.now();
    reportState(true);
  };
  element.onmousemove = (e) => {
    e.preventDefault();
    x2 = e.offsetX;
    y2 = e.offsetY;
    t2 = Date.now();
    reportState(false);
  };
  element.onmouseup = (e) => {
    e.preventDefault();
    x2 = e.offsetX;
    y2 = e.offsetY;
    t2 = Date.now();
    reportState(true);
  };

  function reportState(is_final) {
    if (actions.length > 0)
      return;

    if (t2_start) {
      console.debug('2 touches:', JSON.stringify(t2_start), JSON.stringify(t2_end));
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

    if (!t1) return;

    let cw = element.clientWidth;
    let ch = element.clientHeight;
    x2 = clamp(x2, 0, cw);
    y2 = clamp(y2, 0, ch);
    let dx = x2 - x1;
    let dy = y2 - y1;
    let eps = 0.05;
    let long_press = 1000;
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
      handlers.point?.(x1 / cw, y1 / ch, t2 - t1 > long_press);
    } else {
      handlers.select?.(x0, y0, w0, h0);
      if (w0 > h0)
        handlers.hmove?.(dx / cw);
      else
        handlers.vmove?.(dy / ch);
    }

    if (is_final)
      t1 = 0;
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

function findMinMaxSampleRate() {
  let is_supported = (khz) => {
    try {
      console.debug('Testing sample rate:', khz, 'kHz');
      new AudioContext({ sampleRate: khz * 1000 }).close();
      return true;
    } catch (err) {
      return false;
    }
  };

  let find_boundary = (a, b) => {
    let sa = is_supported(a);
    let sb = is_supported(b);

    dcheck(sa != sb);

    while (a + 1 < b) {
      let c = (a + b) >> 1;
      let sc = is_supported(c);
      if (sa == sc)
        [a, sa] = [c, sc];
      else
        [b, sb] = [c, sc];
    }

    return [a, b];
  };

  let sr_max = find_boundary(32, 1024);
  let sr_min = find_boundary(1, 32);

  return [sr_min[1] * 1000, sr_max[0] * 1000];
}

function initMinMaxSampleRate() {
  if (maxSampleRate) return;
  [minSampleRate, maxSampleRate] = findMinMaxSampleRate();
  console.info('Supported sample rates:', minSampleRate + '..' + maxSampleRate, 'Hz');
}

