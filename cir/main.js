import * as utils from '../utils.js';

const { $, sleep, DB } = utils;
const DB_PATH = 'db_cir/audio/last';

let gui = new dat.GUI();
let canvas = $('canvas');
let conf = {};
conf.sampleRate = 48000;
conf.frameSize = 1024;
conf.numFrames = 2048;
conf.brightness = 2;
conf.color = [255, 85, 28];
conf.disk = true;
let is_drawing = false;
let is_recording = false;
let audio_file = null;
let audio_signal = null;
let spectrogram = null;
let mic_stream = null;

window.onload = init;
utils.setUncaughtErrorHandlers();

async function init() {
  initDebugGUI();
  canvas.onclick = () => uploadAudio();
  $('#upload').onclick = () => uploadAudio();
  $('#record').onclick = () => startRecording();
  $('#zoomin').onclick = () => zoomIn(4000);
  $('#zoomout').onclick = () => zoomIn(-4000);
  $('#br_inc').onclick = () => changeBrightness(+0.5);
  $('#br_dec').onclick = () => changeBrightness(-0.5);
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
  gui.add(conf, 'brightness', 0, 6, 0.1);
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
    let max = 0.1 * Math.max(r, g, b);
    r /= max, g /= max, b /= max;
    let rgb_fn = (x) => [x * r, x * g, x * b];
    let pow = 1.0 / conf.brightness;
    await utils.drawSpectrogram(canvas, spectrogram,
      { disk: conf.disk, fs_full: true, rgb_fn, x2_mul: s => s ** pow });

    if (!conf.disk)
      utils.shiftCanvasData(canvas, { dy: canvas.height / 2 });
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
    await DB.set(DB_PATH, blob);
  } catch (err) {
    console.error(err);
  }
}

async function loadAudioSignal() {
  try {
    console.log('loading audio signal from DB');
    audio_file = await DB.get(DB_PATH);
    if (!audio_file) return;
    console.log('loaded audio:', audio_file);
    audio_signal = await utils.decodeWavFile(audio_file);
    audio_signal.audio_file = audio_file;
    audio_signal.sample_rate = conf.sampleRate;
  } catch (err) {
    console.error(err);
  }
}

async function getMicStream() {
  await utils.showStatus('Requesting mic access');
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleSize: 16,
      sampleRate: { exact: conf.sampleRate },
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }
  });
}

async function startRecording() {
  if (is_recording) return;
  is_recording = true;
  mic_stream = await getMicStream();

  try {
    await utils.showStatus('Initializing AudioRecorder');
    let recorder = new utils.AudioRecorder(mic_stream, conf.sampleRate);
    recorder.onaudiodata = async (blob) => {
      audio_file = blob;
      await sleep(50); // don't block the caller
      redrawImg();
    };
    await recorder.start();
    await utils.showStatus('Recording...', { 'Stop': stopRecording });
  } catch (err) {
    await stopRecording();
    throw err;
  }
}

function stopRecording() {
  if (!is_recording) return;
  console.log('Releasing the mic MediaStream');
  mic_stream.getTracks().map((t) => t.stop());
  mic_stream = null;
  is_recording = false;
  utils.showStatus('');
}