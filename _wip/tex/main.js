import * as utils from '../utils.js';

const { PI, sqrt, sin, abs, min, max, sign, ceil, floor, log2, log10 } = Math;
const { $, log, sleep, mix, clamp, dcheck } = utils;

utils.setUncaughtErrorHandlers();
window.onload = init;

let gui = new dat.GUI({ name: 'Config' });
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 1024;
conf.numFrames = 1024;
conf.brightness = 2;
let is_drawing = false;
let audio_file = null;

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

  is_drawing = true;

  try {
    log('decoding audio file:', audio_file.name);
    let signal = await utils.decodeAudioFile(audio_file, conf.sampleRate);
    let spectrum = utils.fft.sqr_abs(utils.forwardFFT(utils.zeroPadPow2(signal)).data);
    await drawSpectrumTiles(canvas, spectrum);
  } finally {
    utils.shiftCanvasData(canvas, { dx: canvas.width / 2 });
    utils.shiftCanvasData(canvas, { dy: canvas.height / 2 });
    is_drawing = false;
  }
}

async function drawSpectrumTiles(canvas, spectrum, n = 1024) {
  let w = canvas.width;
  let h = canvas.height;
  let spectrum_small = new Float32Array(n);
  utils.downsampleSignal(spectrum, spectrum_small);
  let sum = spectrum_small.reduce((s, x) => s + x, 0);
  let tiles = new Float32Array(h * w);
  console.log(spectrum_small);

  for (let s = 1; s < n / 2; s++) {
    let a = spectrum_small[s] / sum;
    if (a < 1e-5) continue;
    console.debug('drawing freq tiles for', s, '/', n / 2, 'a=' + a.toFixed(4));
    await sleep(0);
    addTiles(tiles, a, s, w, h);
    drawDensityMap(canvas, tiles);
  }
}

let vsin = (x) => {
  x = x / PI * 2 % 4;
  return max(min(x, 2 - x), x - 4);
};

function addTiles(tiles, a, s, w, h) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // checker-board pattern
      let px = sign(sin(x / w * s * 2 * PI));
      let py = sign(sin(y / h * s * 2 * PI));
      tiles[y * w + x] += a * sign(px * py);
    }
  }
}

function drawDensityMap(canvas, density) {
  let w = canvas.width;
  let h = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, w, h);

  dcheck(density.length == h * w);
  img.data.fill(0);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let offset = (y * w + x) * 4;
      let tw = density[y * w + x];
      img.data[offset + 0] = 256 * 9 * tw;
      img.data[offset + 1] = 256 * 3 * tw;
      img.data[offset + 2] = 256 * 1 * tw;
      img.data[offset + 3] = 256;
    }
  }

  ctx.putImageData(img, 0, 0);
}
