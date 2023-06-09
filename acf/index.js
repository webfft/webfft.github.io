import { FFT } from 'https://soundshader.github.io/webfft.js';
import * as ut from '/utils.js';

let gui = new dat.GUI({ name: 'Settings' });
let conf = {};
conf.acf = true;
conf.disk = true;
conf.symm = 1;
conf.nrep = 6;
conf.tstep = 4;
conf.delay = 0.0;
conf.s2_sens = 0.005;
conf.rot_phi = 0.0;
conf.abs_max = 0.08;
conf.max_duration = 1.5;
conf.frame_size = 2048;
conf.sample_rate = 48000;
conf.num_frames_xs = 256;
conf.num_frames_xl = 1024;
let sound_files = [];
let waveform = null;
let freq_colors = null;

// These are files in the vowels/*.ogg list.
let sample_files = [
  'cbr', 'cbu', 'ccr', 'ccu', 'cfr', 'cfu', 'cmbr', 'cmbu',
  'cmcr', 'cmcu', 'cmfr', 'cmfu', 'mcv', 'ncnbr', 'ncnfr',
  'ncnfu', 'nocu', 'nofu', 'obu', 'ocu', 'ofr', 'omcr',
  'omcu', 'omfr', 'omfu', 'probr', 'profu', 'prombr', 'prombu'];

let hann = (x, a = 0, b = 1) => ut.hann((x - a) / (b - a));
let sleep = ut.sleep;

async function main() {
  initDebugUI();
  initFreqColors();
  loadWaveform();

  if (waveform) {
    let canvas = createCanvas();
    await renderWaveform(canvas, waveform, conf.num_frames_xs);
  }
}

function playCurrentSound() {
  if (waveform)
    ut.playSound(waveform, conf.sample_rate);
}

async function loadSounds() {
  $('#sounds').innerHTML = '';
  sound_files = await ut.selectAudioFile(true);
  log('Selected files:', sound_files.length);
  await renderSoundFilesAsGrid();
  if (sound_files.length == 1)
    saveWaveform();
}

async function showVowels() {
  $('#sounds').innerHTML = '';
  sound_files = [];
  await downloadSamples();
  await renderSoundFilesAsGrid();
}

async function recordMic() {
  log('Recording audio');
  let blob = await ut.recordAudio(conf.sample_rate, conf.max_duration);
  blob.name = 'mic' + conf.sample_rate + 'hz';
  log('Recorder audio:', blob);
  sound_files.push(blob);
  await renderSoundFilesAsGrid();
}

function initDebugUI() {
  // gui.close();
  gui.add(conf, 'num_frames_xl', 1024, 2048, 1024);
  gui.add(conf, 'frame_size', 1024, 8192, 1024);
  gui.add(conf, 'sample_rate', 4000, 48000, 4000);
  gui.add(conf, 'tstep', 1, 16, 1);
  gui.add(conf, 'nrep', 1, 12, 1);

  let button = (name, callback) => {
    conf[name] = callback;
    gui.add(conf, name);
  };

  button('load_audio', loadSounds);
  button('show_vowels', showVowels);
  button('play_sound', playCurrentSound);
  button('record_mic', recordMic);
}

function initFreqColors() {
  let fs = conf.frame_size, sr = conf.sample_rate;
  if (freq_colors && freq_colors.length == 4 * fs)
    return freq_colors;

  freq_colors = new Float32Array(4 * fs);

  for (let i = 0; i < fs; i++) {
    let k = Math.min(i, fs - i) / fs; // 0..0.5
    let f = ut.fract(k * sr / conf.tstep / 6000);
    let r = hann(f, 0.0, 0.05) + hann(f, 0.3, 0.4) / 2 - hann(f, 0.0, 0.4) / 3;
    let g = hann(f, 0.0, 0.25) + hann(f, 0.3, 0.6) / 2 - hann(f, 0.0, 0.6) / 3;
    let b = hann(f, 0.0, 0.75) + hann(f, 0.2, 1.0) / 2 - hann(f, 0.0, 1.0) / 3;
    let s = Math.abs(r + g + b) + 0.01;
    dcheck(s != 0 || f == 0 || f == 1);

    freq_colors[4 * i + 0] = r / s;
    freq_colors[4 * i + 1] = g / s;
    freq_colors[4 * i + 2] = b / s;
    freq_colors[4 * i + 3] = 1.0;
  }

  dcheck_array(freq_colors);
  return freq_colors;
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

  if (conf.disk) {
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
  saveWaveform();
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
      waveform = await ut.decodeAudioFile(file, conf.sample_rate);
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
  let pad = fs * conf.tstep | 0;
  let tmp = new Float32Array(waveform.length + 2 * pad);
  tmp.set(waveform, pad);
  return tmp;
}

function loadWaveform() {
  if (localStorage.audio) {
    waveform = new Float32Array(
      localStorage.audio.split(',')
        .map(s => parseInt(s))
        .map(i => i / 2 ** 15));
    log('Loaded audio from local storage:', waveform.length);
  }
}

function saveWaveform() {
  if (waveform.length < 1e5) {
    localStorage.audio = [...waveform]
      .map(f => f * 2 ** 15 | 0).join(',');
    log('Saved audio to local storage:', waveform.length);
  }
}

async function drawACF(canvas, signal, num_frames) {
  let fs = conf.frame_size;
  let nsymm = conf.symm;
  let sub_signal = new Float32Array(signal.length / conf.symm | 0);
  let res_image = new Float32Array(4 * num_frames * fs * nsymm);

  for (let ks = 0; ks < nsymm; ks++) {
    for (let i = 0; i < sub_signal.length; i++)
      sub_signal[i] = signal[Math.min(ks + i * nsymm, signal.length - 1)];

    let sub_image = await compACF(sub_signal, num_frames, fs);
    dcheck(sub_image.length == 4 * num_frames * fs);

    for (let t = 0; t < num_frames; t++) {
      for (let i = 0; i < 4; i++) {
        let src = readACF(sub_image, i, t, num_frames, fs);
        let res = readACF(res_image, i, t, num_frames, fs * nsymm);
        dcheck(src.length == fs);
        dcheck(res.length == fs * nsymm);
        // Need to swap left/right halves because
        // in ACF the 0-th element is the largest.
        res.set(src.subarray(fs / 2), fs * ks);
        res.set(src.subarray(0, fs / 2), fs * ks + fs / 2);
      }
    }
  }

  await drawFrames(canvas, res_image, num_frames, fs * nsymm,
    (data, c, t, f, fw) => getRgbaSmoothAvg(data, c, t, f, fw, num_frames, fs * nsymm));

  /* let rad_frames = num_frames * 2 * Math.PI | 0;
  let rad_fs = 32;
  let rad_image = await compACF(signal, rad_frames, rad_fs, false);
  let rad_rmin = 0.85;

  await drawFrames(canvas, rad_image, rad_frames, rad_fs, (data, c, t, f) => {
    // dcheck(f >= 0 && f <= rad_fs * conf.nrep + 1);
    dcheck(t >= 0 && t < rad_frames);
    let rad_t = (f / rad_fs / conf.nrep * rad_frames | 0) % rad_frames;
    let rad_f = (t / rad_frames - rad_rmin) / (1.00 - rad_rmin);
    let rad_frame = readACF(rad_image, c, rad_t, rad_frames, rad_fs);
    let i = clamp(rad_f * rad_frame.length | 0, 0, rad_fs - 1);
    let r = rad_frame[(i + rad_fs / 2) % rad_fs];
    return r;
  }, rad_rmin, 1.00, 1.00); */
}

async function compACF(signal, num_frames, frame_size, use_fc = true) {
  let fs = frame_size;
  let fft_data = new Float32Array(num_frames * fs);
  let acf_data = new Float32Array(4 * num_frames * fs);
  let res_data = new Float32Array(4 * num_frames * fs);
  let freq_colors = initFreqColors();

  for (let t = 0; t < num_frames; t++) {
    let frame = new Float32Array(fs);
    ut.readAudioFrame(signal, frame, num_frames, t, conf.tstep);
    computeFFT(frame, frame);
    fft_data.subarray(t * fs, (t + 1) * fs).set(frame);
  }

  dcheck_array(fft_data);

  for (let t = 0; t < num_frames; t++) {
    let fft_frame = fft_data.subarray(t * fs, (t + 1) * fs);

    for (let f = 0; f < fs; f++) {
      for (let i = 0; i < 3; i++) {
        let r = fft_frame[f] * (use_fc ? freq_colors[4 * f + i] : 1);
        acf_data[t * fs + i * num_frames * fs + f] = r;
        dcheck(Number.isFinite(r));
      }
    }
  }

  dcheck_array(acf_data);

  if (!conf.acf) {
    res_data.set(acf_data);
  } else {
    for (let t = 0; t < num_frames; t++) {
      for (let i = 0; i < 3; i++) {
        let t1 = t;
        let t2 = Math.round(t + (1 - conf.delay) * num_frames) % num_frames;
        let f1 = readACF(acf_data, i, t1, num_frames, fs);
        let f2 = readACF(acf_data, i, t2, num_frames, fs);
        let f3 = readACF(res_data, i, t1, num_frames, fs);
        if (conf.delay != 0)
          computeXCF(f1, f2, f3);
        else
          computeACF(f1, f3);
        dcheck(Number.isFinite(f3[0]));
      }
    }
  }

  return res_data;
}

function readACF(data, i_rgba, t, num_frames, frame_size) {
  let fs = frame_size;
  return data
    .subarray(i_rgba * num_frames * fs, (i_rgba + 1) * num_frames * fs)
    .subarray(t * fs, (t + 1) * fs);
}

async function drawFrames(canvas, rgba_data, num_frames, frame_size, fn_rgba, r_min = 0, r_max = 1, a_max = 0) {
  let w = canvas.width;
  let h = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, w, h);
  let fs = frame_size;
  let time = performance.now();
  let abs_max = (a_max || conf.abs_max) * array_max(rgba_data, x => Math.abs(x));

  // for (let i = 0; i < num_frames * fs; i++)
  //   abs_max = Math.max(abs_max, Math.abs(rgba_data[i * 4 + 3]));

  // ctx.clearRect(0, 0, w, h);

  let set_rgb = (x, y, r, g, b) => {
    let i = (x + y * w) * 4;
    img.data[i + 0] = 255 * Math.abs(r) / abs_max;
    img.data[i + 1] = 255 * Math.abs(g) / abs_max;
    img.data[i + 2] = 255 * Math.abs(b) / abs_max;
    img.data[i + 3] = 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t, f, r, a;

      if (!conf.disk) {
        r = Math.abs(y / h);
        if (r >= r_max || r <= r_min) continue;
        t = r * num_frames | 0;
        f = (x / w + 0.5) * fs;
        t = clamp(t, 0, num_frames - 1);
      } else {
        [r, a] = xy2ra(x / w * 2 - 1, y / h * 2 - 1);
        if (r >= r_max || r <= r_min) continue;
        t = Math.min(num_frames - 1, r * num_frames | 0);
        f = ((a / Math.PI + 1) / 2 + 0.75) * fs;
        f = f * conf.nrep; // vertical symmetry
      }

      let f_width = conf.disk ? num_frames / (t + 1) : 0;

      let cr = fn_rgba(rgba_data, 0, t, f, f_width, num_frames, fs);
      let cg = fn_rgba(rgba_data, 1, t, f, f_width, num_frames, fs);
      let cb = fn_rgba(rgba_data, 2, t, f, f_width, num_frames, fs);
      dcheck(Math.abs(cr) + Math.abs(cg) + Math.abs(cb) >= 0);

      set_rgb(x, y, cr, cg, cb);
      // set_rgb(w - x - 1, y, r, g, b);
      // set_rgb(x, h - y - 1, r, g, b);
      // set_rgb(w - x - 1, h - y - 1, r, g, b);
    }

    if (performance.now() > time + 250) {
      ctx.putImageData(img, 0, 0);
      await sleep(0);
      time = performance.now();
    }
  }

  ctx.putImageData(img, 0, 0);
  await sleep(0);
}

// f doesn't have to be an integer
function getRgbaSmoothAvg(rgba_data, rgba_idx, t, f, f_width, num_frames, frame_size) {
  dcheck(rgba_idx >= 0 && rgba_idx <= 3);
  dcheck(t >= 0 && t < num_frames);
  dcheck(f_width >= 0 && f_width <= frame_size);
  dcheck(rgba_data.length == num_frames * frame_size * 4);

  let fs = frame_size;
  let nf = num_frames;
  let base = rgba_idx * nf * fs + t * fs;
  let frame = rgba_data.subarray(base, base + fs);

  return !f_width ?
    frame[((f | 0) % fs + fs) % fs] :
    getSmoothAvg(frame, f, f_width);
}

// f doesn't have to be an integer
function getSmoothAvg(frame, f, f_width) {
  let fs = frame.length;
  let f_min = Math.floor(f - f_width);
  let f_max = Math.ceil(f + f_width);
  let sum = 0, w_sum = 0;

  dcheck(f_width >= 1 && f_width <= fs);

  for (let i = f_min; i <= f_max; i++) {
    let w = hann(i, f - f_width, f + f_width);
    sum += w * frame[(i % fs + fs) % fs];
    w_sum += w;
  }

  return sum / w_sum;
}

// output[i] = abs(FFT[i])^2
function computeFFT(input, output) {
  dcheck(input.length == output.length);
  // let temp = FFT.expand(input);
  // let temp2 = FFT.forward(temp);
  let temp2 = ut.forwardFFT(input).array;
  FFT.sqr_abs(temp2, output);
  // dcheck(is_even(output));
}

// https://en.wikipedia.org/wiki/Cross-correlation
// fft_data1 = output of computeFFT()
// fft_data2 = output of computeFFT()
function computeXCF(fft_data1, fft_data2, output) {
  dcheck(fft_data1.length == output.length);
  dcheck(fft_data2.length == output.length);
  let fft1 = FFT.forward(FFT.expand(fft_data1))
  let fft2 = FFT.forward(FFT.expand(fft_data2))
  for (let i = 0; i < output.length; i++) {
    let re1 = fft1[2 * i], im1 = fft1[2 * i + 1];
    let re2 = fft2[2 * i], im2 = fft2[2 * i + 1];
    // (re, im) = (re1, im1) * (re2, -im2)
    let re = +re1 * re2 + im1 * im2;
    let im = -re1 * im2 + re2 * im1;
    output[i] = Math.sqrt(Math.sqrt(re * re + im * im));
  }
}

// Same as computeXCF(input, input, output).
// fft_data = output of computeFFT()
function computeACF(fft_data, output) {
  dcheck(fft_data.length == output.length);
  let fft = FFT.forward(FFT.expand(fft_data))
  // let fft2 = FFT.expand(fft_data);
  // let fft = FFT.forward(fft2)
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
