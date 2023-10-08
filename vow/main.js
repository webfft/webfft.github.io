import * as utils from '../utils.js';

const { $, sleep, ctcheck, fft, DB } = utils;
const DB_PATH = 'db_vow/audio/last';

let gui = new dat.GUI();
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.targetRate = 12000;
conf.frameSize = 2048;
conf.numFrames = 2048;
conf.brightness = 2.5;
conf.zoom = 1.0;
conf.color = [255, 85, 28];
conf.disk = true;
conf.acf = true;
let ctoken = null;
let audio_file = null;
let audio_signal = null;
let spectrogram = null;
let correlogram = null;

window.onload = init;
utils.setUncaughtErrorHandlers();

async function init() {
  initDebugGUI();
  canvas.onclick = () => uploadAudio();
  $('#upload').onclick = () => uploadAudio();
  $('#record').onclick = () => recordAudio();
  $('#zoomin').onclick = () => zoomIn(+0.1);
  $('#zoomout').onclick = () => zoomIn(-0.1);
  $('#br_inc').onclick = () => changeBrightness(+0.5);
  $('#br_dec').onclick = () => changeBrightness(-0.5);
  await loadAudioSignal();
  if (audio_signal)
    redrawImg();
}

async function cancelImg() {
  if (!ctoken) return;
  ctoken.cancelled = true;
  console.log('waiting for ctoken=null');
  await new Promise((resolve) => {
    let timer = setInterval(() => {
      if (ctoken) return;
      clearInterval(timer);
      resolve();
    }, 150);
  });
}

async function recordAudio() {
  await cancelImg();
  audio_file = await utils.recordMic();
  redrawImg();
}

async function changeBrightness(diff) {
  await cancelImg();
  conf.brightness = Math.max(0.5, conf.brightness + diff);
  console.log('brightness:', conf.brightness);
  redrawImg();
}

async function zoomIn(diff) {
  await cancelImg();
  conf.zoom = Math.max(0.1, conf.zoom + diff);
  redrawImg();
}

function initDebugGUI() {
  gui.close();
  gui.add(conf, 'sampleRate', 4000, 48000, 4000);
  gui.add(conf, 'targetRate', 4000, 48000, 4000);
  gui.add(conf, 'frameSize', 256, 8192, 256);
  gui.add(conf, 'numFrames', 256, 4096, 256);
  gui.add(conf, 'brightness', 0, 6, 0.1);
  gui.addColor(conf, 'color');
  gui.add(conf, 'disk');
  gui.add(conf, 'acf');
  conf.redraw = () => hardRefresh();
  gui.add(conf, 'redraw');
}

async function hardRefresh() {
  await cancelImg();
  audio_signal = null;
  redrawImg();
}

async function uploadAudio() {
  await cancelImg();
  audio_file = await utils.selectAudioFile();
  await redrawImg();
}

async function redrawImg() {
  if (ctoken || !audio_file)
    return;

  let time = Date.now();
  ctoken = {};

  try {
    if (audio_signal?.audio_file != audio_file || audio_signal?.sample_rate != conf.sampleRate) {
      console.log('decoding audio file:', audio_file.name);
      audio_signal = await utils.decodeAudioFile(audio_file, conf.sampleRate);
      audio_signal.audio_file = audio_file; // to detect file change
      audio_signal.sample_rate = conf.sampleRate;
      saveAudioSignal();
      await ctcheck(ctoken);
    }

    if (spectrogram?.audio_signal != audio_signal) {
      console.log('computing spectrogram');
      let dsrate = Math.ceil(conf.sampleRate / conf.targetRate);
      let lowpass_signal = new Float32Array(audio_signal.length / dsrate | 0);
      for (let i = 0; i < lowpass_signal.length; i++)
        lowpass_signal[i] = audio_signal[i * dsrate + 0];

      lowpass_signal = utils.trimSilence(lowpass_signal, conf.frameSize);

      spectrogram = await utils.computePaddedSpectrogram(lowpass_signal, {
        num_frames: conf.numFrames,
        frame_size: conf.frameSize,
      });
      spectrogram.audio_signal = audio_signal;
      await ctcheck(ctoken);
    }

    // plain spectrogram preview
    await drawSG(spectrogram);
    await ctcheck(ctoken);

    if (conf.acf && correlogram?.spectrogram != spectrogram) {
      console.log('computing autocorrelogram');
      correlogram = spectrogram.clone();
      correlogram.spectrogram = spectrogram;
      let tmp = new Float32Array(conf.frameSize * 2);
      for (let t = 0; t < conf.numFrames; t++) {
        let frame = correlogram.subtensor(t);
        fft.sqr_abs_reim(frame.data, frame.data);
        fft.inverse(frame.data, tmp);
        fft.sqr_abs_reim(tmp, frame.data);
        fft.map(frame.data, (re, im) => [Math.sqrt(re), 0]);
      }
      await ctcheck(ctoken);
    }

    // low-quality drawing
    await drawSG(conf.acf ? correlogram : spectrogram, { disk: conf.disk, fs_full: !conf.disk });
    await ctcheck(ctoken);

    if (conf.disk) {
      console.log('drawing highq spectrogram');
      await drawSG(conf.acf ? correlogram : spectrogram, { disk: conf.disk, highq: true, fs_full: !conf.disk });
    }

    let file_name = (audio_file.name || '').replace(/\.\w+$/, '');
    utils.drawText(canvas, (conf.targetRate / 1000) + ' kHz ' + file_name,
      { x: 8, y: -8, font: '24px monospace', color: '#ccc' });
    console.log('img ready in', Date.now() - time, 'ms');
  } catch (err) {
    if (err.message == 'Cancelled')
      console.log('redrawImg cancelled');
  } finally {
    ctoken = null;
  }
}

async function drawSG(sg, args = {}) {
  let [r, g, b] = conf.color;
  let max = 0.1 * Math.max(r, g, b);
  r /= max, g /= max, b /= max;
  let rgb_fn = (x) => [x * r, x * g, x * b];
  let pow = 1.0 / conf.brightness;

  await utils.drawSpectrogram(canvas, sg,
    { ctoken, r_zoom: conf.zoom, fs_full: true, rgb_fn, x2_mul: s => s ** pow, ...args });
  if (!args.disk)
    utils.shiftCanvasData(canvas, { dy: canvas.height / 2 });
  await sleep(50);
}

async function saveAudioSignal() {
  try {
    if (!audio_signal) return;
    console.log('saving audio signal to DB');
    let blob = utils.generateWavFile(audio_signal, conf.sampleRate);
    let file = new File([blob], audio_file.name, { type: blob.type });
    await DB.set(DB_PATH, file);
  } catch (err) {
    console.error(err);
  }
}

async function loadAudioSignal() {
  try {
    console.log('loading audio signal from DB');
    audio_file = await DB.get(DB_PATH);
    if (!audio_file) return;
    audio_signal = await utils.decodeWavFile(audio_file);
    audio_signal.audio_file = audio_file;
    audio_signal.sample_rate = conf.sampleRate;
  } catch (err) {
    console.error(err);
  }
}
