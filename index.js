import { createEXR } from './third_party/exr.js';

const $ = (x) => document.querySelector(x);
const assert = (x, m = 'assert() failed') => { if (!x) { debugger; throw new Error(m); } };

const topCanvas = $('canvas');
const elStatus = $('#status');

const TXID_STEP = 100;
const MAX_CHANNELS = 3; // because those need to map to RGB eventually
const IMAGE_SIZE = [1024, 1024];
const AUDIO_SIZE = [1024, 2048];
const SAMPLE_RATE = 24000; // 12 kHz is enough for audible sounds

let bgThreads = []; // 3 total: one per channel
let base_txid = 0;
let textureHDR = []; // 1..3 Float32Arrays of (re,im) pairs.
let gamma = 2.0, brightness = 0.0; // HDR tone mapping: x -> A*pow(x,1.0/GAMMA)

window.onerror = (event, source, lineno, colno, error) => setStatus(error, 'error');
window.onunhandledrejection = (event) => setStatus(event.reason, 'error');
window.onload = () => init();

function init() {
  $('#open_audio').onclick = () => openAudio();
  $('#open_image').onclick = () => openImage();
  $('#fft_rows').onclick = () => applyFFT();
  $('#conjugate').onclick = () => conjugateIm();
  $('#transpose').onclick = () => transposeImage();
  $('#h_shift').onclick = () => shiftTexture();
  $('#save_png').onclick = () => savePNG();
  $('#save_exr').onclick = () => saveEXR();
  $('#abs_square').onclick = () => squareAbs();
  $('#gaussian').onclick = () => applyGaussianWindow();
  $('svg').onclick = (e) => setToneMapping(e);
  initWorkerThreads();
  updateSVG();
  setStatus('Ready');
}

function setStatus(text, type = '') {
  elStatus.textContent = text;
  elStatus.className = type;
}

async function openAudio() {
  let file = await openFile('audio/*');
  if (!file) return;

  let [w, h] = AUDIO_SIZE;
  topCanvas.width = w;
  topCanvas.height = h;
  updateSVG();

  setStatus('Decoding audio file...');
  let channels = await decodeAudio(file);

  if (channels.length > MAX_CHANNELS)
    console.warn('Audio contains more than 3 channels:', channels.length);

  textureHDR.length = 0;
  for (let ch = 0; ch < channels.length && ch < MAX_CHANNELS; ch++) {
    let len = channels[ch].length;
    let tex = new Float32Array(h * w * 2);
    let step = (len - w) / h | 0;

    assert((h - 1) * step + w - 1 < len);

    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        tex[(y * w + x) * 2] = channels[ch][y * step + x];

    textureHDR[ch] = tex;
  }

  drawTextureHDR();
}

async function openImage() {
  let file = await openFile('image/*');
  if (!file) return;

  let [w, h] = IMAGE_SIZE;
  topCanvas.width = w;
  topCanvas.height = h;
  updateSVG();

  setStatus('Decoding image file...');
  let img = await drawImage(file, topCanvas);
  textureHDR.length = 0;
  for (let ch = 0; ch < 3; ch++) {
    textureHDR[ch] = new Float32Array(h * w * 2);
    for (let i = 0; i < h * w; i++)
      textureHDR[ch][i * 2] = img.data[i * 4 + ch] / 256;
  }

  drawTextureHDR();
}

function openFile(mime_type) {
  let input = document.createElement('input');
  input.type = 'file';
  input.accept = mime_type;
  input.multiple = false;
  input.click();
  return new Promise(resolve =>
    input.onchange = () =>
      resolve(input.files[0]));
}

/// Image related utils.

function getTextureHW() {
  return [topCanvas.height, topCanvas.width];
}

function shiftTexture() {
  let h = topCanvas.height;
  let w = topCanvas.width;
  let tmp = new Float32Array(w * 2);

  setStatus('Shifting texture...');
  for (let tex of textureHDR) {
    for (let y = 0; y < h; y++) {
      let scanline = tex.subarray(y * w * 2, (y + 1) * w * 2);
      tmp.set(scanline);
      scanline.set(tmp.subarray(w));
      scanline.set(tmp.subarray(0, w), w);
    }
  }

  drawTextureHDR();
}

// This can be done with WebGL.
async function mapTextureToRGBA(rgba, max = 1.0, scale = 1.0, contrast = 1.0) {
  let txid = base_txid;

  let tasks = textureHDR.map(async (tex, ch) => {
    let res = rgba.slice(0, tex.length / 2);
    let args = [res, tex, max, scale, contrast];
    res = await postThreadMessage(ch, txid + ch, mapTextureToRGBA.name, args, [res.buffer]);

    for (let i = 0; i < res.length; i++)
      rgba[i * 4 + ch] = res[i];
  });

  await Promise.all(tasks);
}

function setToneMapping(e) {
  let svg = $('svg');
  let x = (e.clientX - svg.parentElement.offsetLeft) / svg.clientWidth;
  let y = 1 - (e.clientY - svg.parentElement.offsetTop) / svg.clientHeight;
  let [xmin, ymin, svgw, svgh] = svg.getAttribute('viewBox').split(' ').map(x => +x);
  gamma = xmin + x * svgw;
  brightness = ymin + y * svgh;
  updateSVG();
  drawTextureHDR();
}

function updateSVG() {
  let dot = $('svg circle');
  dot.setAttribute('cx', gamma);
  dot.setAttribute('cy', brightness);
  $('#alpha').textContent = brightness.toFixed(2);
  $('#gamma').textContent = gamma.toFixed(2);
}

async function drawTextureHDR() {
  setStatus('Drawing the texture...');
  dropPendingTXIDs();

  let ts = Date.now();
  let ctx = topCanvas.getContext('2d');
  let w = topCanvas.width, h = topCanvas.height;
  let img = ctx.getImageData(0, 0, w, h);
  new Int32Array(img.data.buffer).fill(0xFF000000); // R,G,B,A = 0,0,0,1
  await mapTextureToRGBA(img.data, 0xFF, 10 ** brightness, 1.0 / gamma);
  ctx.putImageData(img, 0, 0);
  setStatus('drawTexture time: ' + (Date.now() - ts) + ' ms');
}

async function drawImage(blob, canvas) {
  let img = new Image;
  img.src = URL.createObjectURL(blob);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  let ctx = canvas.getContext('2d');
  let w = canvas.width, h = canvas.height;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

function transposeImage() {
  let h = topCanvas.height;
  let w = topCanvas.width;

  setStatus('Transposing the texture...');
  for (let tex of textureHDR) {
    let tmp = new Float32Array(h * w * 2);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let i = 0; i < 2; i++)
          tmp[(x * h + y) * 2 + i] = tex[(y * w + x) * 2 + i];
    tex.set(tmp);
  }

  topCanvas.width = h;
  topCanvas.height = w;
  drawTextureHDR();
}

function genImageName(ext) {
  let t = new Date().toJSON().replace(/[-:T]|\.\d+Z$/g, '');
  return 'image_' + t + '.' + ext;
}

function saveBlobAsFile(blob, name) {
  let a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
}

async function savePNG() {
  setStatus('Creating an RGB x int16 PNG image');
  dropPendingTXIDs();
  let w = topCanvas.width;
  let h = topCanvas.height;
  let u16 = new Uint16Array(4 * h * w);

  // PNG alpha=1.0
  for (let i = 0; i < h * w; i++)
    u16[i * 4 + 3] = 0xFFFF;

  await mapTextureToRGBA(u16, 0xFFFF, 10 ** brightness, 1.0 / gamma);

  // big-endian for PNG
  let bswap = (b) => (b >> 8) | ((b & 255) << 8);
  for (let i = 0; i < u16.length; i++)
    u16[i] = bswap(u16[i]);

  let png = UPNG.encodeLL([u16.buffer], w, h, 3, 1, 16);
  let blob = new Blob([png], { type: 'image/png' });
  saveBlobAsFile(blob, genImageName('png'));
}

async function saveEXR() {
  setStatus('Creating an RGB x float32 EXR image');
  dropPendingTXIDs();
  let w = topCanvas.width;
  let h = topCanvas.height;
  let rgba = new Float32Array(w * h * 4);
  await mapTextureToRGBA(rgba, 1.0, 10 ** brightness, 1.0 / gamma);
  let blob = createEXR(w, h, 3, rgba);
  saveBlobAsFile(blob, genImageName('exr'));
}

/// Audio related utils.

async function decodeAudio(blob) {
  let encoded_data = await blob.arrayBuffer();
  let ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  try {
    let cloned_data = encoded_data.slice(0);
    let audio_buffer = await ctx.decodeAudioData(cloned_data);
    let channels = [];
    for (let i = 0; i < audio_buffer.numberOfChannels; i++)
      channels[i] = audio_buffer.getChannelData(i);
    return channels;
  } finally {
    ctx.close();
  }
}

/// FFT related utils

function conjugateIm() {
  for (let tex of textureHDR)
    for (let i = 0; i < tex.length / 2; i++)
      tex[2 * i + 1] *= -1;
  drawTextureHDR();
}

function squareAbs() {
  for (let tex of textureHDR) {
    for (let i = 0; i < tex.length / 2; i++) {
      let re = tex[2 * i], im = tex[2 * i + 1];
      tex[2 * i] = re * re + im * im;
      tex[2 * i + 1] = 0;
    }
  }
  drawTextureHDR();
}

function applyGaussianWindow() {
  let [h, w] = getTextureHW();
  let mask = new Float32Array(w);

  for (let x = 0; x < w; x++) {
    let dx = Math.min(x, w - x) / w * 2; // -1..1
    mask[x] = Math.exp(-dx * dx);
  }

  for (let tex of textureHDR)
    for (let y = 0; y < h; y++)
      for (let i = 0; i < w * 2; i++)
        tex[y * w * 2 + i] *= mask[i >> 1];

  drawTextureHDR();
}

async function applyFFT() {
  let txid = dropPendingTXIDs();
  let [h, w] = getTextureHW();

  let tasks = textureHDR.map(async (tex, ch) => {
    let args = [tex, [h, w]];
    let res = await postThreadMessage(ch, txid + ch, applyFFT.name, args);
    tex.set(res);
  });

  await Promise.all(tasks);
  drawTextureHDR();
}

/// Worker thread related utils

function dropPendingTXIDs() {
  return base_txid += TXID_STEP;
}

function initWorkerThreads() {
  for (let ch = 0; ch < MAX_CHANNELS; ch++) {
    let w = new Worker('thread.js', { type: 'module' });
    w.onmessage = processThreadMessage;
    w.promises = {};
    bgThreads[ch] = w;
  }
}

function postThreadMessage(ch, txid, fn, args, transfer) {
  return new Promise((resolve, reject) => {
    let ts = Date.now();
    bgThreads[ch].promises[txid] = { resolve, reject };
    bgThreads[ch].postMessage({ txid, ts, ch, fn, args }, transfer);
  });
}

function processThreadMessage(message) {
  let { txid, ch, ts, fn, res, err } = message.data;
  console.debug('Message from bg thread', ch, fn, 'ts diff', Date.now() - ts, 'ms');

  if (txid < base_txid) {
    console.warn('Dropped outdated response: txid', txid, '<', base_txid);
    return;
  }

  let promises = bgThreads[ch].promises;
  let promise = promises[txid];
  delete promises[txid];
  promise.resolve(res);
}

