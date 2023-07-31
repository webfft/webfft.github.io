import * as utils from '../utils.js';

const { PI, sqrt, atan2, abs, min, max, sign, ceil, floor, log2, log10 } = Math;
const { $, log, sleep, mix, clamp, dcheck } = utils;

let gui = new dat.GUI({ name: 'Config' });
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 4096;
conf.numFrames = 1024;
conf.brightness = 2;
let is_drawing = false;
let audio_file = null;

window.onload = init;
// window.onerror = (event, source, lineno, colno, error) => showStatus(error);
// window.onunhandledrejection = (event) => showStatus(event.reason);

function init() {
  initDebugGUI();
  canvas.onclick = () => openFileAndDrawRT();
}

function initDebugGUI() {
  gui.close();
  gui.add(conf, 'sampleRate', 4000, 48000, 4000);
  gui.add(conf, 'frameSize', 256, 4096, 256);
  gui.add(conf, 'numFrames', 256, 4096, 256);
  gui.add(conf, 'brightness', 0, 6, 0.1);
  conf.redraw = () => redrawRT();
  gui.add(conf, 'redraw');
}

async function openFileAndDrawRT() {
  audio_file = await utils.selectAudioFile();
  await redrawRT();
}

async function redrawRT() {
  if (is_drawing || !audio_file) {
    log('still drawing or file not ready');
    return;
  }

  let time = Date.now();
  is_drawing = true;

  try {
    log('decoding audio file:', audio_file.name);
    let audio_signal = await utils.decodeAudioFile(audio_file, conf.sampleRate);

    log('computing spectrogram');
    let spectrogram = await utils.computePaddedSpectrogram(audio_signal, {
      num_frames: conf.numFrames,
      frame_size: conf.frameSize,
    });
    // await utils.drawSpectrogram(canvas, spectrogram, { fs_full: true });
    // throw new Error('dbg224');

    log('computing autocorrelation');
    let correlogram = computeAutoCorrelation(spectrogram);
    // await utils.drawSpectrogram(canvas, correlogram, { fs_full: true });
    // throw new Error('dbg224');

    let diskogram = createDiskSpectrogram(correlogram);
    // await utils.drawSpectrogram(canvas, diskogram, { fs_full: true });
    // throw new Error('dbg224');

    log('computing radon transform');
    let radogram = utils.computeFFT2D(diskogram);

    log('drawing radon sinogram');
    utils.drawSpectrogram(canvas, radogram,
      { fs_full: true, rgb_fn: s => [s * 25, s * 5, s * 1], db_log: s => s ** (1 / conf.brightness) });

    utils.shiftCanvasData(canvas, { dx: canvas.width / 2 });
    utils.shiftCanvasData(canvas, { dy: canvas.height / 2 });
  } finally {
    is_drawing = false;
  }

  log('done in', Date.now() - time, 'ms');
}

function createSpectrogramFilter(sample_rate, freq_hz_min, freq_hz_max, multiplier = 1.0) {
  return (f, fs) => {
    let hz = min(f, fs - f) / fs * sample_rate;
    return multiplier * utils.hann((hz - freq_hz_min) / (freq_hz_max - freq_hz_min));
  };
}

function applySpectrogramFilter(spectrogram, filter_fn) {
  let [nf, fs] = spectrogram.dimensions;
  let output = spectrogram.clone();

  for (let t = 0; t < nf; t++) {
    let src = spectrogram.subtensor(t);
    let res = output.subtensor(t);

    for (let f = 0; f < fs; f++) {
      let x = filter_fn(f, fs);
      res.array[2 * f + 0] = x * src.array[2 * f + 0];
      res.array[2 * f + 1] = x * src.array[2 * f + 1];
    }
  }

  return output;
}

function computeAutoCorrelation(spectrogram) {
  let output = spectrogram.clone();
  let [nf, fs] = spectrogram.dimensions;
  let tmp = new Float32Array(2 * fs);

  for (let t = 0; t < nf; t++) {
    let src = spectrogram.subtensor(t).array;
    let res = output.subtensor(t).array;

    for (let f = 0; f < fs; f++) {
      let re = src[2 * f];
      let im = src[2 * f + 1];
      res[2 * f] = re * re + im * im;
      res[2 * f + 1] = 0;
    }

    utils.computeFFT(res, tmp);
    res.set(tmp);
  }

  return output;
}

function createDiskSpectrogram(spectrogram, disk_size) {
  let [nf, fs] = spectrogram.dimensions;
  let ds = disk_size || min(nf, fs);
  dcheck(ds <= nf && ds <= fs);

  let sqr2 = (x) => x * x;
  let disk = new utils.Float32Tensor([ds, ds, 2]);

  for (let y = -ds / 2; y < ds / 2; y++) {
    for (let x = -ds / 2; x < ds / 2; x++) {
      let r = sqrt(x * x + y * y) / ds * 2; // 0..1
      let a = atan2(y, x) / PI; // -1..1
      if (r == 0 || r >= 1) continue;

      let t = min(nf - 1, r * nf | 0); // frame id
      let f = ((abs(a) * fs / 2 | 0) + fs) % fs; // freq id
      dcheck(t >= 0 && t < nf);
      dcheck(f >= 0 && f < fs);

      let yx = ((y + ds) % ds * ds + (x + ds) % ds) * 2;
      let tf = (t * fs + f) * 2;

      let re = spectrogram.array[tf + 0];
      let im = spectrogram.array[tf + 1];
      disk.array[yx + 0] = re;
      disk.array[yx + 1] = im;
    }
  }

  return disk;
}
