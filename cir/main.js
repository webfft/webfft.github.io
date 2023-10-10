import * as utils from '../utils.js';

const { $, sleep, DB } = utils;
const DB_PATH = 'db_cir/audio/last';

let gui = new dat.GUI();
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 1024;
conf.numFrames = 2048;
conf.brightness = 20;
conf.color = [255, 85, 28];
conf.disk = true;
let is_drawing = false;
let audio_file = null;
let audio_signal = null;
let spectrogram = null;

window.onload = init;
utils.setUncaughtErrorHandlers();

async function init() {
  initDebugGUI();
  canvas.onclick = () => uploadAudio();
  $('#upload').onclick = () => uploadAudio();
  $('#record').onclick = () => recordAudio();
  $('#zoomin').onclick = () => zoomIn(4000);
  $('#zoomout').onclick = () => zoomIn(-4000);
  $('#br_inc').onclick = () => changeBrightness(+5);
  $('#br_dec').onclick = () => changeBrightness(-5);
  await loadAudioSignal();
  if (audio_signal)
    redrawImg();
}

function changeBrightness(diff) {
  if (is_drawing) return;
  conf.brightness = Math.max(0, conf.brightness + diff);
  redrawImg();
}

function zoomIn(diff_hz) {
  if (is_drawing) return;
  conf.sampleRate -= diff_hz;
  conf.sampleRate = utils.clamp(conf.sampleRate, 4000, 48000);
  redrawImg();
}

function initDebugGUI() {
  gui.close();
  gui.add(conf, 'sampleRate', 4000, 48000, 4000);
  gui.add(conf, 'frameSize', 256, 4096, 256);
  gui.add(conf, 'numFrames', 256, 4096, 256);
  gui.add(conf, 'brightness', 5, 100, 5);
  gui.addColor(conf, 'color');
  gui.add(conf, 'disk');
  conf.redraw = () => hardRefresh();
  gui.add(conf, 'redraw');
}

function hardRefresh() {
  if (is_drawing) return;
  audio_signal = null;
  redrawImg();
}

async function uploadAudio() {
  if (is_drawing) return;
  audio_file = await utils.selectAudioFile();
  await redrawImg();
}

async function redrawImg() {
  if (is_drawing || !audio_file)
    return;

  let time = Date.now();
  is_drawing = true;

  try {
    if (audio_signal?.audio_file != audio_file || audio_signal?.sample_rate != conf.sampleRate) {
      console.log('decoding audio file:', audio_file.name);
      audio_signal = await utils.decodeAudioFile(audio_file, conf.sampleRate);
      audio_signal.audio_file = audio_file; // to detect file change
      audio_signal.sample_rate = conf.sampleRate;
      saveAudioSignal();
    }

    if (spectrogram?.audio_signal != audio_signal) {
      console.log('computing spectrogram');
      spectrogram = await utils.computePaddedSpectrogram(audio_signal, {
        num_frames: conf.numFrames,
        frame_size: conf.frameSize,
      });
      spectrogram.audio_signal = audio_signal;
    }

    console.log('drawing spectrogram');
    let [r, g, b] = conf.color;
    let max = Math.max(r, g, b);
    let pow = conf.brightness;
    r /= max, g /= max, b /= max;
    let rgb_fn = (x) => [x * r * pow, x * g * pow, x * b * pow];
    let reim_fn = (re, im) => Math.sqrt(re * re + im * im);
    await utils.drawSpectrogram(canvas, spectrogram.transpose(),
      { disk: conf.disk, fs_full: true, rgb_fn, reim_fn });

    if (!conf.disk)
      utils.shiftCanvasData(canvas, { dy: canvas.height / 2 });

    let file_name = (audio_file.name || '').replace(/\.\w+$/, '');
    utils.drawText(canvas, (conf.sampleRate / 1000) + ' kHz ' + file_name,
      { x: 8, y: -8, font: '16px monospace', color: '#f84' });
  } finally {
    is_drawing = false;
  }

  console.log('done in', Date.now() - time, 'ms');
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

async function recordAudio() {
  audio_file = await utils.recordMic({ sample_rate: conf.sampleRate });
  await redrawImg();
}
