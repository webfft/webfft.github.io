import { FFT } from 'https://soundshader.github.io/webfft.js';
import * as utils from '../utils.js';

let gui = new dat.GUI({ name: 'Settings' });
let conf = {};
window.conf = conf;

conf.colorize = false;
conf.color = [9, 3, 1];
conf.use_winf = true;
conf.sphere = false;
conf.num_reps = 2;
conf.downsample = 4;
conf.phaseid = 0;
conf.s2_sens = 0.005;
conf.rot_phi = 0.0;
conf.brightness = 5.0;
conf.max_duration = 1.5;
conf.frame_size = 2048;
conf.sample_rate = 48000;
conf.num_frames_xs = 128;
conf.num_frames_xl = 512;

let sound_files = [];
let waveform = null;

// These are files in the vowels/*.ogg list.
let sample_files = [
  'cbr', 'cbu', 'ccr', 'ccu', 'cfr', 'cfu', 'cmbr', 'cmbu',
  'cmcr', 'cmcu', 'cmfr', 'cmfu', 'mcv', 'ncnbr', 'ncnfr',
  'ncnfu', 'nocu', 'nofu', 'obu', 'ocu', 'ofr', 'omcr',
  'omcu', 'omfr', 'omfu', 'probr', 'profu', 'prombr', 'prombu'];

let hann = (x, a = 0, b = 1) => utils.hann((x - a) / (b - a));
let sleep = utils.sleep;

async function main() {
  initDebugUI();
  await loadWaveform();

  if (waveform) {
    let canvas = createCanvas();
    await renderWaveform(canvas, waveform, conf.num_frames_xs);
  }
}

function playCurrentSound() {
  if (waveform)
    utils.playSound(waveform, conf.sample_rate);
}

async function loadSounds() {
  $('#sounds').innerHTML = '';
  sound_files = await utils.selectAudioFile({ multiple: true });
  log('Selected files:', sound_files.length);
  await renderSoundFilesAsGrid();
  if (sound_files.length == 1)
    await saveWaveform();
}

async function showVowels() {
  $('#sounds').innerHTML = '';
  sound_files = [];
  await downloadSamples();
  await renderSoundFilesAsGrid();
}

async function recordMic() {
  log('Recording audio');
  let blob = await utils.recordAudio({
    sample_rate: conf.sample_rate,
    max_duration: conf.max_duration,
  });
  blob.name = 'mic' + conf.sample_rate + 'hz';
  log('Recorder audio:', blob);
  sound_files.push(blob);
  await renderSoundFilesAsGrid();
}

function initDebugUI() {
  // gui.close();
  gui.add(conf, 'num_frames_xl', 512, 2048, 512);
  gui.add(conf, 'frame_size', 1024, 16384, 1024);
  gui.add(conf, 'sample_rate', 4000, 48000, 4000);
  gui.add(conf, 'downsample', 1, 32, 1);
  // gui.add(conf, 'phaseid', 0, 31, 1);
  gui.add(conf, 'num_reps', 0, 12, 1);
  gui.add(conf, 'brightness', 0.1, 15.0, 0.1);
  gui.add(conf, 'colorize');

  let button = (name, callback) => {
    conf[name] = callback;
    gui.add(conf, name);
  };

  button('load_audio', loadSounds);
  button('show_vowels', showVowels);
  button('play_sound', playCurrentSound);
  button('record_mic', recordMic);
}

function getFreqColor(i, fs) {
  dcheck(i >= 0 && i < fs);

  if (!conf.colorize)
    return [1, 1, 1, 1];

  let sr = conf.sample_rate;
  let k = Math.min(i, fs - i) / fs; // 0..0.5
  let h = k * 2 * sr / conf.downsample;
  let [r, g, b] = utils.hsl2rgb(clamp(h / 1500), 1.0, 0.5);
  let s = r + g + b;
  if (s > 0) r /= s, g /= s, b /= s;
  return [r, g, b, 1];
}

async function downloadSamples(min = 10, max = 38) {
  log('Downloading sample files');
  for (let f of sample_files) {
    let name = 'vowels/' + f + '.ogg';
    let resp = await fetch(name);
    let blob = await resp.blob();
    blob.name = f;
    sound_files.push(blob);
  }
}

function createCanvas(id = 0, nf = conf.num_frames_xs) {
  dcheck(nf > 0);
  let canvas = document.createElement('canvas');
  canvas.onclick = () => renderFullScreen(id);

  if (conf.num_reps) {
    canvas.width = nf * 2;
    canvas.height = nf * 2;
  } else {
    canvas.height = nf;
    canvas.width = conf.frame_size / 2;
  }

  $('#sounds').append(canvas);
  return canvas;
}

async function renderFullScreen(id) {
  dcheck(!$('canvas.top'));
  let canvas = createCanvas(0, conf.num_frames_xl);
  canvas.className = 'top';
  canvas.onclick = () => canvas.remove();
  await renderSoundFile(id, canvas, conf.num_frames_xl);
  await saveWaveform();
}

async function renderSoundFilesAsGrid() {
  let num = sound_files.length;
  log('Rendering sounds:', num);

  for (let id = 0; id < num; id++) {
    if (sound_files[id].canvas)
      continue; // already rendered
    let canvas = createCanvas(id + 1, conf.num_frames_xs);
    await renderSoundFile(id + 1, canvas, conf.num_frames_xs);
    await sleep(0);
  }

  log('Rendered all sounds');
}

async function renderSoundFile(id, canvas, num_frames) {
  let file = id > 0 && sound_files[id - 1];

  if (id > 0) {
    try {
      waveform = await utils.decodeAudioFile(file, conf.sample_rate);
      let duration = waveform.length / conf.sample_rate;
      log('Decoded sound:', duration.toFixed(1), 'sec', '#' + id, '(' + file.name + ')');
    } catch (err) {
      log(err.message);
      waveform = new Float32Array(0);
    }
  }

  if (waveform) {
    await renderWaveform(canvas, waveform, num_frames);
  }

  if (file) {
    renderSoundTag(canvas, file.name.replace(/\.\w+$/, ''));
    file.canvas = canvas;
    file.waveform = waveform;
  }
}

function renderSoundTag(canvas, text) {
  let h = canvas.height;
  let fs = h / 24 | 0;
  let ctx = canvas.getContext('2d');
  ctx.font = fs + 'px monospace';
  ctx.fillStyle = '#888';
  ctx.fillText(text, fs / 2, h - fs / 2);
}

async function renderWaveform(canvas, waveform, num_frames) {
  let ts = Date.now();
  let trimmed = trimSilence(waveform);
  await drawACF(canvas, trimmed, num_frames);
  log('acf image completed in', Date.now() - ts, 'ms');
}

function trimSilence(waveform) {
  let n = waveform.length, fs = conf.frame_size;

  let s2_find = (t_min, t_max, fn_test) => {
    dcheck(t_min >= 0 && t_min < n);
    dcheck(t_max >= 0 && t_max < n);
    let dir = Math.sign(t_max - t_min);
    let len = Math.abs(t_max - t_min);
    dcheck(dir != 0 && len > 0);
    let sum = 0;

    for (let i = t_min; Math.abs(i - t_min) <= len; i += dir) {
      let x = waveform[i];
      let j = i - dir * fs;
      let y = dir * (j - t_min) < 0 ? 0 : waveform[j];
      sum += x * x - y * y;
      if (fn_test(sum / fs))
        return i;
    }

    return n;
  };

  let s2_max = 0;
  s2_find(0, n - 1, sum => void (s2_max = Math.max(s2_max, sum)));

  let t_min = s2_find(0, n - 1, sum => sum / s2_max > conf.s2_sens);
  let t_max2 = Math.min(n - 1, Math.floor(t_min + conf.max_duration * conf.sample_rate));
  let t_max = s2_find(t_max2, t_min, sum => sum / s2_max > conf.s2_sens);

  log('s2_max:', s2_max.toFixed(2), 't:', t_min + '..' + t_max,
    ((t_max - t_min) / conf.sample_rate).toFixed(2), 'sec');

  // trim zeros at both ends
  waveform = waveform.subarray(t_min, t_max + 1);
  // need some padding on both ends for smooth edges
  let pad = fs * conf.downsample | 0;
  let tmp = new Float32Array(waveform.length + pad);
  tmp.set(waveform, pad);
  return tmp;
}

async function loadWaveform() {
  let ts = Date.now();
  waveform = await utils.DB.get('acf_data/samples/saved.pcm');
  if (waveform) log('Loaded audio from local DB:', waveform.length, 'in', Date.now() - ts, 'ms');
}

async function saveWaveform() {
  try {
    let ts = Date.now();
    await utils.DB.set('acf_data/samples/saved.pcm', waveform);
    log('Saved audio to local DB:', waveform.length, 'in', Date.now() - ts, 'ms');
  } catch (err) {
    console.error('Failed to save audio:', err);
  }
}

async function drawACF(canvas, signal, num_frames) {
  let width = canvas.width;
  let height = canvas.height;
  let frame_size = conf.frame_size;
  let img1 = await getImgDataFromSignal(signal,
    { num_frames, frame_size: frame_size * 1, width, height });

  drawCanvasImageData(canvas, img1, { color: conf.color });

  if (num_frames > conf.num_frames_xs)
    drawSpectrumColors(canvas);
}

function drawSpectrumColors(canvas) {
  utils.drawSpectrumColors(canvas, {
    label_fn: (f) => {
      let str = (f * conf.sample_rate / 2 / 1000).toFixed(1);
      str = str.indexOf('.') < 0 ? str.slice(0, 2) : str.slice(0, 3);
      str = str.replace(/\.0*$/, '');
      return str + ' kHz';
    },
    color_fn: (f, temp) => {
      temp *= conf.brightness;
      let i = Math.round(f * conf.frame_size / 2);
      let [r, g, b] = getFreqColor(i, conf.frame_size);
      if (!conf.colorize)
        [r, g, b] = conf.color;
      return [r * temp, g * temp, b * temp];
    }
  });
}

function subsample(signal, ds = conf.downsample, shift = conf.phaseid) {
  let signal_ds = new Float32Array(signal.length / ds | 0);
  for (let i = 0; i < signal_ds.length; i++)
    signal_ds[i] = signal[Math.min(i * ds + shift, signal.length - 1)];
  return signal_ds;
}

function compACF(signal, num_frames, frame_size) {
  let fs = frame_size;
  let num_cc_planes = conf.colorize ? 4 : 1;
  let dft = new utils.Float32Tensor([num_frames, fs]);
  let acf = new utils.Float32Tensor([4, num_frames, fs]);
  let res = new utils.Float32Tensor([4, num_frames, fs]);
  let signal_ds = subsample(signal);

  for (let t = 0; t < num_frames; t++) {
    let frame = new Float32Array(fs);
    utils.readAudioFrame(signal_ds, frame, { num_frames, frame_id: t, use_winf: conf.use_winf });
    computeFFT(frame, frame);
    dft.data.subarray(t * fs, (t + 1) * fs).set(frame);
  }

  dcheck_array(dft.data);
  acf.subtensor(0).data.set(dft.data);

  for (let t = 0; t < num_frames; t++) {
    let fft_frame = dft.data.subarray(t * fs, (t + 1) * fs);
    for (let f = 0; f < fs; f++) {
      let rgba = getFreqColor(f, fs);
      for (let i = 0; i < num_cc_planes; i++) {
        let r = fft_frame[f] * rgba[i];
        acf.data[(i + 1) * num_frames * fs + t * fs + f] = r;
      }
    }
  }

  dcheck_array(acf.data);

  for (let cc = 0; cc < num_cc_planes; cc++) {
    let res_plane = res.subtensor(cc);
    let acf_plane = acf.subtensor(cc);
    for (let t = 0; t < num_frames; t++) {
      let res_vec = res_plane.subtensor(t).data;
      let fft_vec = acf_plane.subtensor(t).data;
      inverseFFT(fft_vec, res_vec);
    }
  }

  for (let cc = num_cc_planes; cc < 4; cc++)
    res.subtensor(cc).data.set(res.subtensor(0).data);

  dcheck_array(res.data);
  return res;
}

async function getImgDataFromSignal(signal, { num_frames, frame_size, width, height }) {
  let rgba_data = compACF(signal, num_frames, frame_size);
  return getImgRGBA(rgba_data, { width, height });
}

async function getImgRGBA(rgba_data, { width, height }) {
  let w = width;
  let h = height;
  let img_rgba = new utils.Float32Tensor([4, h, w]);
  let abs_max = array_max(rgba_data.data, x => Math.abs(x));

  for (let i = 0; i < rgba_data.length; i++)
    rgba_data[i] = Math.abs(rgba_data[i]) / abs_max;

  for (let i = conf.colorize ? 0 : 3; i < 4; i++) {
    let src = rgba_data.subtensor((i + 1) % 4);
    let res = img_rgba.subtensor(i);
    if (!conf.num_reps)
      await utils.resampleRect(src, res);
    else if (conf.sphere)
      await utils.resampleSphere(src, res, { num_reps: conf.num_reps });
    else
      await utils.resampleDisk(src, res, { num_reps: conf.num_reps });
  }

  return img_rgba;
}

function drawCanvasImageData(canvas, img_rgba, { color }) {
  let w = canvas.width;
  let h = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = Math.abs(img_rgba.at(0, y, x));
      let g = Math.abs(img_rgba.at(1, y, x));
      let b = Math.abs(img_rgba.at(2, y, x));
      let a = Math.abs(img_rgba.at(3, y, x));
      let s = Math.max(r, g, b);
      if (!s) s = 1e-6;
      if (!conf.colorize)
        [r, g, b, s] = [...color, 3];
      let i = (x + y * w) * 4;
      img.data[i + 0] += 255 * conf.brightness * Math.abs(a * r / s);
      img.data[i + 1] += 255 * conf.brightness * Math.abs(a * g / s);
      img.data[i + 2] += 255 * conf.brightness * Math.abs(a * b / s);
      img.data[i + 3] += 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

// output[i] = abs(FFT[i])^2
function computeFFT(input, output) {
  dcheck(input.length == output.length);
  let temp2 = utils.forwardFFT(input).data;
  FFT.sqr_abs(temp2, output);
  // dcheck(is_even(output));
}

// Same as computeXCF(input, input, output).
// fft_data = output of computeFFT()
function inverseFFT(fft_data, output) {
  dcheck(fft_data.length == output.length);
  let fft = FFT.inverse(FFT.expand(fft_data))
  FFT.abs(fft, output);
}

function dcheck(x) {
  if (x) return;
  debugger;
  throw new Error('dcheck failed');
}

function log(...args) {
  console.log(args.join(' '));
}

function clamp(x, min = 0, max = 1) {
  return Math.max(Math.min(x, max), min);
}

function dcheck_array(a) {
  for (let i = 0; i < a.length; i++)
    dcheck(Number.isFinite(a[i]));
}

function array_max(a, map_fn = (x) => x) {
  let x = a[0], n = a.length;
  for (let i = 1; i < n; i++)
    x = Math.max(x, map_fn(a[i]));
  return x;
}

function xy2ra(x, y) {
  let r = Math.sqrt(x * x + y * y);
  let a = Math.atan2(y, x); // -PI..PI
  return [r, a]
}

function $(s) {
  return document.querySelector(s);
}

window.onload = () => main();
