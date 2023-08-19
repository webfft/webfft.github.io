import * as utils from '../utils.js';

const { $, log, showStatus } = utils;

let gui = new dat.GUI({ name: 'Config' });
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 1024;
conf.numFrames = 1024;
conf.numWaves = 25;
conf.brightness = 2;

let is_drawing = false;
let audio_files = null;

window.onload = init;

function init() {
  utils.setUncaughtErrorHandlers();
  initDebugGUI();
  showStatus('Select an audio file:', {
    'Open': () => {
      openFileAndDrawRT();
    }
  });
}

function initDebugGUI() {
  gui.close();
  gui.add(conf, 'sampleRate', 4000, 48000, 4000);
  gui.add(conf, 'frameSize', 256, 4096, 256);
  gui.add(conf, 'numFrames', 256, 4096, 256);
  gui.add(conf, 'numWaves', 0, 150, 1);
  gui.add(conf, 'brightness', 0, 6, 0.1);
  conf.redraw = () => updateCWT();
  gui.add(conf, 'redraw');
}

async function openFileAndDrawRT() {
  audio_files = await utils.selectAudioFile(true);
  await updateCWT();
}

async function updateCWT() {
  if (is_drawing || !audio_files) {
    log('still drawing or file not ready');
    return;
  }

  let time = Date.now();
  is_drawing = true;

  let draw_sg = (sg) => utils.drawSpectrogram(canvas, sg,
    { fs_full: true, db_log: s => s ** (1 / conf.brightness) });

  try {
    let audio_signals = [];
    for (let file of audio_files) {
      await showStatus(['Decoding audio file:', (file.size / 1e6).toFixed(2) + 'MB', file.name]);
      let sig = await utils.decodeAudioFile(file, conf.sampleRate);
      audio_signals.push(sig);
    }

    await showStatus('Computing FFT');
    let spectrogram = await utils.computePaddedSpectrogram(audio_signals[0], {
      num_frames: conf.numFrames,
      frame_size: conf.frameSize,
    });
    await draw_sg(spectrogram);

    let wavelet = conf.numWaves > 0 && audio_signals.length == 1 ?
      utils.createDefaultWavelet(audio_signals[0].length, conf.numWaves) :
      audio_signals.length > 1 ? audio_signals[1].subarray(0, audio_signals[0].length) :
      audio_signals[0];

    await showStatus('Computing CWT');
    let scaleogram = await utils.computeCWT(audio_signals[0], wavelet, {
      time_steps: conf.numFrames,
      num_scales: conf.frameSize / 2,
      async progress(pct, res_partial) {
        if (pct > 0)
          await draw_sg(res_partial);
        await showStatus(['Computing CWT', (pct * 100).toFixed(0) + '%'], {
          'Cancel': () => is_drawing = false,
        });
        return is_drawing ? 1000 : 0; // ms
      }
    });
    await draw_sg(scaleogram);
  } finally {
    is_drawing = false;
  }

  log('done in', Date.now() - time, 'ms');
  showStatus('');
}

