import * as utils from '../utils.js';

const { $, log, showStatus } = utils;

let gui = new dat.GUI({ name: 'Config' });
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 12000;
conf.frameSize = 1024;
conf.numFrames = 1024;
conf.numWaves = 15;
conf.brightness = 2;
conf.disk = false;

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
  gui.add(conf, 'numWaves', 1, 100, 1);
  gui.add(conf, 'brightness', 0, 6, 0.1);
  gui.add(conf, 'disk');
  conf.redraw = () => updateCWT();
  gui.add(conf, 'redraw');
}

async function openFileAndDrawRT() {
  audio_files = await utils.selectAudioFile({ multiple: true });
  await updateCWT();
}

async function updateCWT() {
  if (is_drawing || !audio_files) {
    log('still drawing or file not ready');
    return;
  }

  let time = Date.now();
  is_drawing = true;

  let draw_sg = (sg, opts = {}) => utils.drawSpectrogram(canvas, sg,
    { fs_full: true, x2_mul: s => s ** (1 / conf.brightness), ...opts });

  try {
    let audio_signals = [];
    for (let file of audio_files) {
      await showStatus(['Decoding audio file:', (file.size / 1e6).toFixed(2) + 'MB', file.name]);
      let sig = await utils.decodeAudioFile(file, conf.sampleRate);
      audio_signals.push(sig);
    }

    let sig0 = audio_signals[0];

    canvas.width = conf.numFrames;
    canvas.height = conf.frameSize;

    await showStatus('Computing FFT');
    let spectrogram = await utils.computePaddedSpectrogram(sig0, {
      num_frames: conf.numFrames,
      frame_size: conf.frameSize,
    });

    let { freq_max, time_min, time_max } = await utils.computeSpectrumPercentile(spectrogram, 0.99995, 1.0);
    console.log('99%-tile: freq=0..' + freq_max, 'time=' + time_min + '..' + time_max);

    await draw_sg(spectrogram, { num_freqs: freq_max, fs_full: false });

    let signal = sig0.subarray(
      time_min / conf.numFrames * sig0.length | 0,
      time_max / conf.numFrames * sig0.length | 0);

    await showStatus('Computing CWT: signal=' + signal.length);
    let scaleogram = await utils.computeCWT(signal, {
      base_wavelet: utils.createDefaultWavelet(conf.numWaves, 0.025),
      time_steps: conf.numFrames,
      num_freqs: conf.frameSize,
      freq_max: freq_max / conf.frameSize * conf.sampleRate,
      sample_rate: conf.sampleRate,

      progress_fn: async (pct, res_partial) => {
        if (pct > 0) {
          if (conf.disk) {
            let diskogram = createDiskSpectrogram(res_partial, conf.frameSize);
            await draw_sg(diskogram);
          } else {
            await draw_sg(res_partial);
          }
        }
        await showStatus(['Computing CWT', (pct * 100).toFixed(0) + '%'], {
          'Cancel': () => is_drawing = false,
        });
        return is_drawing ? 1500 : 0; // ms
      }
    });

    if (conf.disk) {
      let diskogram = createDiskSpectrogram(scaleogram, conf.frameSize);
      await draw_sg(diskogram);
    } else {
      await draw_sg(scaleogram);
    }
  } finally {
    is_drawing = false;
  }

  log('done in', Date.now() - time, 'ms');
  showStatus('');
}

function createDiskSpectrogram(spectrogram, diameter) {
  let [num_frames, frame_size] = spectrogram.dimensions;
  let disk = new utils.Float32Tensor([diameter, diameter, 2]);

  let downsampled = spectrogram.clone();
  downsampled.data.fill(0);
  for (let f = 1; f < frame_size; f++) {
    let src = new Float32Array(num_frames);
    for (let t = 0; t < num_frames; t++)
      src[t] = spectrogram.data[(t * frame_size + f) * 2];
    let res = new Float32Array(Math.round(f / frame_size * num_frames));
    utils.downsampleSignal(src, res);
    for (let t = 0; t < res.length; t++)
      downsampled.data[(t * frame_size + f) * 2] = res[t];
  }

  for (let y = 0; y < diameter; y++) {
    for (let x = 0; x < diameter; x++) {
      let dx = (x - 0.5) / diameter - 0.5;
      let dy = (y - 0.5) / diameter - 0.5;
      let [r, a] = utils.xy2ra(dx, dy);

      let t = Math.round(Math.abs(a / Math.PI) * (num_frames - 1) * r / 0.75);
      let f = Math.round(r / 0.75 * (frame_size - 1));
      utils.dcheck(t >= 0 && t < num_frames);
      utils.dcheck(f >= 0 && f < frame_size);
      // if (a < 0) t = num_frames - 1 - t;
      let tf = t * frame_size + f;
      let re = downsampled.data[tf * 2 + 0];
      let im = downsampled.data[tf * 2 + 1];

      let yx = y * diameter + x;
      disk.data[yx * 2 + 0] = re;
      disk.data[yx * 2 + 1] = im;
    }
  }

  return disk;
}