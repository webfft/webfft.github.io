import * as utils from '../utils.js';
import { FFT } from 'https://soundshader.github.io/webfft.js';

const { $, log } = utils;
window.utils = utils;

utils.setUncaughtErrorHandlers();
let gui = new dat.GUI({ name: 'Config' });
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 512;
conf.numFrames = 512;
conf.brightness = 2.0;
conf.useWinFn = true;
conf.timeframe = 0;
let is_drawing = false;
let audio_file = null;
let audio_signal = null;
let dft2d_img = null;

window.onload = init;

function init() {
  initDebugGUI();
  utils.showStatus('Select audio file:', { 'Open': () => openFileAndDrawImg() });
}

function initDebugGUI() {
  gui.close();
  gui.add(conf, 'sampleRate', 4000, 48000, 4000);
  gui.add(conf, 'frameSize', 256, 4096, 256);
  gui.add(conf, 'numFrames', 256, 8192, 256);
  gui.add(conf, 'brightness', 0, 5, 0.1);
  conf.redraw = () => redrawImg();
  gui.add(conf, 'redraw');
}

async function openFileAndDrawImg() {
  audio_file = await utils.selectAudioFile();
  utils.showStatus('Computing 2D DFT');
  await redrawImg();
  utils.showStatus('');
}

async function redrawImg() {
  if (is_drawing || !audio_file) {
    log('still drawing or file not ready');
    return;
  }

  let time = Date.now();
  is_drawing = true;

  try {
    log('decoding audio file:', audio_file.name);
    audio_signal = await utils.decodeAudioFile(audio_file, conf.sampleRate);
    log('audio signal:', (audio_signal.length / conf.sampleRate).toFixed(1) + 's');
    let ctx = { cancelled: false };
    await utils.showStatus('Drawing frames...', { 'Stop': () => ctx.cancelled = true });
    await drawAnimation(ctx);
  } finally {
    is_drawing = false;
  }

  log('done in', Date.now() - time, 'ms');
}

async function drawAnimation(ctx) {
  for (let i = 0; i < conf.numFrames && !ctx.cancelled; i++) {
    await drawFrame2D(i);
    await utils.sleep(5);
  }
}

async function drawFrame2D(frame_id = Math.round(conf.timeframe * conf.numFrames)) {
  if (!audio_signal) return;
  console.log('drawing frame', frame_id);
  let audio_frame = new Float32Array(conf.frameSize);
  utils.readAudioFrame(audio_signal, audio_frame,
    { num_frames: conf.numFrames, frame_id, use_winf: conf.useWinFn });
  let spectrum = utils.forwardFFT(audio_frame);
  let n = conf.frameSize;

  if (dft2d_img?.length != n * n)
    dft2d_img = new Float32Array(n * n);

  for (let i = -n / 2; i < n / 2; i++) {
    let re = spectrum.data[(i + n) % n * 2];
    let im = spectrum.data[(i + n) % n * 2 + 1];
    let [amp, arg] = utils.xy2ra(re, im);
    let x = Math.cos(arg) * i;
    let y = Math.sin(arg) * i;
    x = (Math.round(x) + n) % n;
    y = (Math.round(y) + n) % n;
    dft2d_img[y * n + x] += amp * amp;
  }

  let src2d = new utils.Float32Tensor([n, n, 2], FFT.expand(dft2d_img));
  let res2d = utils.computeFFT2D(src2d);

  await utils.drawSpectrogram(canvas, res2d,
    { disk: false, fs_full: true, x2_mul: (s) => s ** (1.0 / conf.brightness) });

  utils.shiftCanvasData(canvas, { dx: canvas.width / 2 });
  utils.shiftCanvasData(canvas, { dy: canvas.height / 2 });
}
