import * as utils from '../utils.js';

const { PI, sqrt, atan2, abs, min, max, sign, ceil, floor, log2, log10 } = Math;
const { $, log, sleep, mix, clamp, dcheck } = utils;

let gui = new dat.GUI({ name: 'Config' });
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 1024;
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

  let draw_sg = (sg) => utils.drawSpectrogram(canvas, sg,
    { fs_full: true, x2_mul: s => s ** (1 / conf.brightness) });

  try {
    log('decoding audio file:', audio_file.name);
    let audio_signal = await utils.decodeAudioFile(audio_file, conf.sampleRate);
    let spectrogram = await utils.computePaddedSpectrogram(audio_signal, {
      num_frames: conf.numFrames,
      frame_size: conf.frameSize,
    });
    // let correlogram = computeAutoCorrelation(spectrogram);
    // let diskogram = createDiskSpectrogram(correlogram);

    let size = Math.max(spectrogram.dims[0], spectrogram.dims[1]);
    let diskogram = reverseMapping(spectrogram, {
      res_size: [size, size],
      map_values: (re, im) => [re * re + im * im, 0],
      map_coords: (y, x, h, w) => {
        let [r, a] = utils.xy2ra(x / w * 2 - 1, y / h * 2 - 1);
        if (r > 1) return null;
        let t = abs(a / PI) * spectrogram.dims[0];
        let f = (r + 0.5) % 1 * spectrogram.dims[1];
        return [t, f];
      },
    });

    // draw_sg(diskogram);
    let radogram = utils.computeFFT2D(diskogram);
    await draw_sg(radogram);
  } finally {
    utils.shiftCanvasData(canvas, { dx: canvas.width / 2 });
    utils.shiftCanvasData(canvas, { dy: canvas.height / 2 });
    is_drawing = false;
  }

  log('done in', Date.now() - time, 'ms');
}

function reverseMapping(src, { map_coords, map_values, res_size }) {
  dcheck(map_coords);
  dcheck(map_values);
  dcheck(src.rank == 3 && src.dims[2] == 2);
  let [sh, sw] = src.dims;
  let [rh, rw] = res_size || [sh, sw];
  let res = new utils.Float32Tensor([rh, rw, 2]);

  for (let ry = 0; ry < rh; ry++) {
    for (let rx = 0; rx < rw; rx++) {
      let syx = map_coords(ry, rx, rh, rw);
      if (!syx) continue;
      let [sy, sx] = syx;
      sy = Math.round(sy);
      sx = Math.round(sx);
      if (sy < 0 || sy >= sh) continue;
      if (sx < 0 || sx >= sw) continue;
      let ri = ry * rw + rx;
      let si = sy * sw + sx;
      let re = src.data[si * 2 + 0];
      let im = src.data[si * 2 + 1];
      [re, im] = map_values(re, im);
      dcheck(Number.isFinite(re));
      dcheck(Number.isFinite(im));
      res.data[ri * 2 + 0] = re;
      res.data[ri * 2 + 1] = im;
    }
  }

  return res;
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

  for (let t = 0; t < nf; t++) {
    for (let f = -fs / 2; f < fs / 2; f++) {
      let r = t / nf;
      let a = f / fs * 2 * Math.PI;
      let y = r * Math.sin(a) * ds / 2 | 0;
      let x = r * Math.cos(a) * ds / 2 | 0;

      let yx = ((y + ds) % ds * ds + (x + ds) % ds) * 2;
      let tf = (t * fs + (f + fs) % fs) * 2;
      dcheck(yx >= 0 && tf >= 0);

      let re = spectrogram.array[tf + 0];
      let im = spectrogram.array[tf + 1];
      disk.array[yx + 0] += re; // re*re+im*im;
      disk.array[yx + 1] += im; // 0;
    }
  }

  return disk;
}
