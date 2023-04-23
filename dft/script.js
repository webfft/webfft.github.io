import * as utils from '../utils.js';

const { PI, abs, min, max, sign, ceil, floor, log2, log10 } = Math;
const { $, clamp, dcheck } = utils;

let canvas_fft = $('#spectrogram');
let canvas_spectrum = $('#spectrum');
let canvas_timeline = $('#timeline');
let canvas_timespan = $('#timespan');
let canvas_volumes = $('#volumes');
let actions = [];
let timer = 0;
let config = {}, prev_config = {};
config.sampleRate = 48;
config.frameSize = 1024;
config.dbRange = 3; // log10(re^2+im^2)
config.timeMin = 0; // sec
config.timeMax = 0; // sec
let audio_file = null;
let audio_signal = null;
// let db_log = (s) => clamp(log10(s) / config.dbRange + 1); // 0.001..1 -> -3..0 -> 0..1
let db_log = (s) => s ** (1 / config.dbRange); // 0.001..1 -> 0.1..1
let rgb_fn = (s) => [s * 9.0, s * 3.0, s * 1.0];

window.onload = init;
window.onerror = (event, source, lineno, colno, error) => showStatus(error);
window.onunhandledrejection = (event) => showStatus(event.reason);

function init() {
  $('#open').onclick = () => schedule(openFile);
  $('#record').onclick = () => schedule(recordAudio);
  initMouseHandlers();
  initDatGUI();
}

function initDatGUI() {
  let gui = new dat.GUI({ name: 'Config' });
  gui.add(config, 'sampleRate', 4, 48, 2).name('kHz').onFinishChange(processUpdatedConfig);
  gui.add(config, 'frameSize', 256, 4096, 256).name('N').onFinishChange(processUpdatedConfig);
  gui.add(config, 'dbRange', 1, 8, 0.5).name('dB').onFinishChange(processUpdatedConfig);
}

function initMouseHandlers() {
  let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
  canvas_fft.onmousewheel = (e) => {
    if (actions.length > 0) return;
    let zoom = 2 ** sign(e.deltaY);
    schedule(zoomTimeline, [zoom]);
  };
  canvas_fft.onmousedown = (e) => {
    x1 = e.offsetX;
    y1 = e.offsetY;
  };
  canvas_fft.onmouseout = (e) => {
    x1 = y1 = 0;
  };
  canvas_fft.onmouseup = (e) => {
    if (actions.length > 0) return;
    x2 = e.offsetX;
    y2 = e.offsetY;
    if (!x1 && !y1)
      return;
    let dx = x2 - x1;
    let dy = y2 - y1;
    let cw = canvas_fft.clientWidth;
    let ch = canvas_fft.clientHeight;
    if (!dx && !dy)
      schedule(drawPointTag, [x1 / cw, y1 / ch]);
    else if (dy / dx < 0.05)
      schedule(moveTimeline, [-dx / cw]);
    else
      schedule(selectArea, [x1 / cw, y1 / ch, dx / cw, dy / ch]);
    x1 = y1 = 0;
  };
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
  if (dt > 0.1) console.warn(callback.name, 'time:', dt.toFixed(1), 'sec');
  timer = setTimeout(perform, 0);
}

function showStatus(...args) {
  let text = args.join(' ');
  text && console.info(text);
  $('#status').style.display = text ? '' : 'none';
  $('#status').innerText = text;
  return utils.sleep(0);
}

function processUpdatedConfig() {
  config.frameSize = 2 ** (log2(config.frameSize) | 0);
  // gui.setValue('frameSize', config.frameSize);

  if (config.sampleRate != prev_config.sampleRate)
    schedule(decodeAudioFile);
  else if (config.frameSize != prev_config.frameSize)
    schedule(renderSpectrogram);
  else if (config.dbRange != prev_config.dbRange)
    schedule(renderSpectrogram);
  else
    console.debug('config hasnt changed');

  prev_config = JSON.parse(JSON.stringify(config));
}

async function openFile() {
  let file = await utils.selectAudioFile();
  if (!file) return;
  $('#buttons').style.display = 'none';
  audio_file = file;
  config.timeMin = 0;
  config.timeMax = 0;
  await decodeAudioFile();
}

async function decodeAudioFile() {
  let sr = config.sampleRate * 1000;
  let size_kb = (audio_file.size / 1024).toFixed(0);
  await showStatus('Decoding audio:', size_kb, 'KB @', sr, 'Hz');
  audio_signal = await utils.decodeAudioFile(audio_file, sr);
  if (!config.timeMin && !config.timeMax)
    config.timeMax = audio_signal.length / sr;
  await renderSpectrogram();
}

async function recordAudio() {
  $('#buttons').style.display = 'none';
  throw new Error('Recording audio not implemented');
}

function getAudioWindow() {
  if (!audio_signal)
    return null;
  let sr = config.sampleRate * 1000;
  let i = config.timeMin * sr | 0;
  let j = config.timeMax * sr | 0;
  let n = audio_signal.length;
  if (i >= 0 && j <= n)
    return audio_signal.subarray(i, j);
  dcheck(j - i < 10e6);
  let res = new Float32Array(j - i);
  let src = audio_signal.subarray(max(0, i), min(n, j));
  res.set(src, max(0, -i));
  console.info('copied audio signal:', i, '..', j);
  return res;
}

async function moveTimeline(step = 0.0) {
  if (step == 0.0) return;
  let a = config.timeMin;
  let b = config.timeMax;
  let a2 = a + (b - a) * step;
  let b2 = b + (b - a) * step;
  config.timeMin = a2;
  config.timeMax = b2;
  await renderSpectrogram();
}

async function zoomTimeline(zoom = 1.0) {
  if (zoom == 1.0) return;
  let a = config.timeMin;
  let b = config.timeMax;
  let a2 = (a + b) / 2 - (b - a) / 2 * zoom;
  let b2 = (a + b) / 2 + (b - a) / 2 * zoom;
  config.timeMin = a2;
  config.timeMax = b2;
  await renderSpectrogram();
}

async function renderSpectrogram() {
  let num_frames = canvas_fft.width;
  let frame_size = config.frameSize;
  let time_min = config.timeMin.toFixed(2);
  let time_max = config.timeMax.toFixed(2);
  let time_span = time_min + '..' + time_max;
  await showStatus('Computing DFT:', time_span, 'sec @', num_frames, 'x', frame_size);
  let audio_window = getAudioWindow();
  let spectrogram = utils.computePaddedSpectrogram(audio_window, num_frames, frame_size);
  utils.drawSpectrogram(canvas_fft, spectrogram, { db_log, rgb_fn });

  await showStatus('Computing stats');
  let avg_spectrum = utils.getAvgSpectrum(spectrogram);
  let vol_timeline = utils.getVolumeTimeline(spectrogram);
  let vol_density = utils.getVolDistribution(spectrogram, canvas_volumes.height, db_log);
  // (s) => clamp(log10(s) / 6 + 1));

  drawTimespanView(canvas_timespan);
  drawAverageSpectrum(canvas_spectrum, avg_spectrum);
  drawVolumeTimeline(canvas_timeline, vol_timeline);
  drawVolumeDistribution(canvas_volumes, vol_density);

  await showStatus('');
}

function drawTimespanView(canvas) {
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');

  let sr = config.sampleRate * 1000;
  let t1 = config.timeMin * sr / audio_signal.length;
  let t2 = config.timeMax * sr / audio_signal.length;
  let rx = t1 * cw | 0;
  let rw = (t2 - t1) * cw | 0;
  let rh = ch / 4 | 0;
  let ry = ch * 0.5 - rh * 0.5 | 0;

  ctx.clearRect(0, 0, cw, ch);

  ctx.strokeStyle = '#842';
  ctx.moveTo(0, ch / 2);
  ctx.lineTo(cw, ch / 2);
  ctx.stroke();

  ctx.fillStyle = '#f84';
  ctx.fillRect(rx, ry, rw, rh);
}

function drawVolumeDistribution(canvas, vol_density) {
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, cw, ch);
  img.data.fill(0);

  let vol_max = vol_density.reduce((s, x) => max(s, x), 0);

  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      let s = (ch - 1 - y) / ch;
      let f = s * vol_density.length | 0;
      let a = Math.abs((x + 0.5) / cw * 2 - 1);
      let a_max = db_log(vol_density[f] / vol_max);
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

function drawAverageSpectrum(canvas, avg_spectrum) {
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, cw, ch);
  img.data.fill(0);

  let abs_max = avg_spectrum.reduce((s, x) => max(s, x), 0);

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

  let cw = canvas_fft.width;
  let ch = canvas_fft.height;
  let ctx = canvas_fft.getContext('2d');

  let sr = config.sampleRate;
  let x = x0 * canvas_fft.width | 0;
  let y = y0 * canvas_fft.height | 0;
  let t = (x - 0) / cw * audio_window.length / sr / 1000;
  let f = (ch - 1 - (y - 0)) / ch * sr / 2 * 1000;

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

async function selectArea(dx, dy, dw, dh) {
  let canvas = canvas_fft;
  let cw = canvas.width;
  let ch = canvas.height;
  let ctx = canvas.getContext('2d');

  ctx.strokeStyle = '#0f0';
  ctx.strokeRect(dx * cw, dy * ch, dw * cw, dh * ch);
  ctx.stroke();

  let sr = config.sampleRate * 1000;
  let aw = getAudioWindow();
  let t1 = dx * aw.length | 0;
  let t2 = (dx + dw) * aw.length | 0;
  let f2 = (1 - dy) * sr / 2 | 0;
  let f1 = (1 - dy - dh) * sr / 2 | 0;

  let t_span = (t1 / sr).toFixed(2) + '..' + (t2 / sr).toFixed(2) + ' s';
  let f_span = f1 + '..' + f2 + ' Hz';
  await showStatus('Applying bandpass filter:', t_span, f_span);

  let len = 2 ** ceil(log2(t2 - t1));
  let aw2 = new Float32Array(len);
  aw2.set(aw.subarray(t1, t2), 0);
  let aw3 = utils.applyBandpassFilter(aw2,
    f1 / sr * 2 * len / 2 | 0,
    f2 / sr * 2 * len / 2 | 0);

  let aw3max = aw3.reduce((s, x) => max(s, abs(x)), 0);
  for (let i = 0; i < len; i++) 
    aw3[i] /= max(1e-6, aw3max);

  // audio_signal = aw3.slice(0, t2 - t1);
  // config.timeMin = 0;
  // config.timeMax = audio_signal.length / sr;
  // await renderSpectrogram();

  schedule(playSound, [aw3]);
}

async function playSound(signal) {
  let sr = config.sampleRate * 1000;
  let duration = signal.length / sr;
  await showStatus('Playing sound:', duration.toFixed(2), 'sec');
  let ctx = new AudioContext({ sampleRate: sr });

  try {
    let buffer = ctx.createBuffer(1, signal.length, sr);
    buffer.getChannelData(0).set(signal, 0);
    let source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
    await new Promise((resolve) => source.onended = resolve);
    await showStatus('');
  } finally {
    ctx.close();
  }
}
