import * as utils from '../utils.js';

const { $, log } = utils;
window.utils = utils;

utils.setUncaughtErrorHandlers();
let gui = new dat.GUI({ name: 'Config' });
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 1024;
conf.numFrames = 1024;
conf.brightness = 5;
conf.useWinFn = false;
let is_drawing = false;
let audio_file = null;

window.onload = init;

function init() {
  initDebugGUI();
  utils.showStatus('Select audio file:', { 'Open': () => openFileAndDrawImg() });
}

function initDebugGUI() {
  gui.close();
  gui.add(conf, 'sampleRate', 4000, 48000, 4000);
  gui.add(conf, 'frameSize', 256, 4096, 256);
  gui.add(conf, 'numFrames', 256, 4096, 256);
  gui.add(conf, 'brightness', 0, 10, 0.1);
  gui.add(conf, 'useWinFn', 0, 10, 0.1);
  conf.redraw = () => redrawImg();
  gui.add(conf, 'redraw');
}

async function openFileAndDrawImg() {
  audio_file = await utils.selectAudioFile();
  utils.showStatus('Computing WHT');
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

  let draw_sg = (sg) => utils.drawSpectrogram(canvas, sg,
    { fs_full: true, x2_mul: s => s ** (1 / conf.brightness) });

  try {
    log('decoding audio file:', audio_file.name);
    let audio_signal = await utils.decodeAudioFile(audio_file, conf.sampleRate);
    log('audio signal:', (audio_signal.length / conf.sampleRate).toFixed(1) + 's');
    let spectrogram = await utils.computePaddedSpectrogram(audio_signal, {
      use_winf: conf.useWinFn,
      num_frames: conf.numFrames,
      frame_size: conf.frameSize,
      transform: (src, res) => {
        let tmp = res.subarray(res.length / 2);
        let wht = res.subarray(0, res.length / 2);
        utils.walshPermutation(src, wht);
        tmp.set(wht);
        utils.fwht(tmp, wht);
        utils.re2reim(wht, res);
      }
    });
    await draw_sg(spectrogram);
  } finally {
    is_drawing = false;
  }

  log('done in', Date.now() - time, 'ms');
}
