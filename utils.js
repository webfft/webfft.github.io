import { FFT } from 'https://soundshader.github.io/webfft.js';

let { min, max, sin, cos, abs, PI } = Math;

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);
export const log = (...args) => console.log(args.join(' '));
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const mix = (a, b, x) => a * (1 - x) + b * x;
export const step = (min, x) => x < min ? 0 : 1;
export const sqr = (x) => x * x;
export const clamp = (x, min = 0, max = 1) => Math.max(Math.min(x, max), min);
export const hann = (x) => x > 0 && x < 1 ? sqr(Math.sin(Math.PI * x)) : 0;
export const hann_ab = (x, a, b) => hann((x - a) / (b - a));
export const lanczos = (x, p) => x == 0 ? 1 : sin(PI * x) * sin(PI * x / p) / (PI * PI * x * x) * p;
export const lanczos_ab = (x, p, a, b) => lanczos((x - a) / (b - a) * 2 - 1, p);
export const fract = (x) => x - Math.floor(x);
export const reim2 = (re, im) => re * re + im * im;
export const is_pow2 = (x) => (x & (x - 1)) == 0;
export const dcheck = (x) => { if (x) return; debugger; throw new Error('dcheck failed'); }

export function $$$(tag_name, attrs = {}, content = []) {
  let el = document.createElement(tag_name);
  for (let name in attrs)
    el.setAttribute(name, attrs[name]);
  if (typeof content == 'string')
    el.textContent = content;
  else if (Array.isArray(content))
    el.append(...content);
  else
    throw new Error('Invalid element content passed to $$$');
  return el;
}

const is_spectrogram = (s) => s.rank == 3 && s.dimensions[2] == 2;

export class Float32Tensor {
  constructor(dims, array) {
    let size = dims.reduce((p, d) => p * d, 1);
    dcheck(!array || array.length == size);

    // ds[i] = dims[i + 1] * dims[i + 2] * ...
    let dim = dims, ds = dim.slice(), n = ds.length;

    ds[n - 1] = 1;
    for (let i = n - 2; i >= 0; i--)
      ds[i] = ds[i + 1] * dim[i + 1];

    this.data = array || new Float32Array(size);

    this.rank = dims.length;
    this.dims = dims;
    this.dim_size = ds;

    this.array = this.data; // don't use
    this.dimensions = this.dims; //  don't use
  }

  at(...indexes) {
    dcheck(indexes.length == this.rank);
    let offset = 0;
    for (let i = 0; i < this.rank; i++)
      offset += indexes[i] * this.dim_size[i];
    return this.data[offset];
  }

  slice(begin, end) {
    dcheck(begin >= 0 && begin < end && end <= this.dims[0]);
    let size = this.dim_size[0];
    let dims = this.dims.slice(1);
    let data = this.data.subarray(begin * size, end * size);
    return new Float32Tensor([end - begin, ...dims], data);
  }

  subtensor(index) {
    let t = this.slice(index, index + 1);
    let d = t.dims;
    dcheck(d[0] == 1);
    return new Float32Tensor(d.slice(1), t.data);
  }

  transpose() {
    dcheck(this.rank == 2);
    let [n, m] = this.dims;
    let r = new Float32Tensor([m, n]);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < m; j++)
        r.data[j * n + i] = this.data[i * m + j];
    return r;
  }

  clone() {
    return new Float32Tensor(this.dims.slice(), this.data.slice(0));
  }
}

export function sumTensors(...tensors) {
  let res = tensors[0].clone();

  for (let t = 1; t < tensors.length; t++) {
    let src = tensors[0];
    dcheck(src instanceof Float32Tensor);
    dcheck(src.array.length == res.array.length);
    for (let i = 0; i < src.array.length; i++)
      res.array[i] += src.array[i];
  }

  return res;
}

// https://en.wikipedia.org/wiki/Bit-reversal_permutation
// bitrev(i, 16) = [0 8 4 12 2 10 6 14 1 9 5 13 3 11 7 15]
export function bitrev(x, num_bits) {
  let r = 0;
  for (let i = 0; (1 << i) < num_bits; i++)
    r = (r << 1) | (x >> i) & 1;
  return r;
}

// invgraycode(graycode(x)) == x
export function invgraycode(i) {
  i ^= i >> 16;
  i ^= i >> 8;
  i ^= i >> 4;
  i ^= i >> 2;
  i ^= i >> 1;
  return i;
}

// https://en.wikipedia.org/wiki/Gray_code
// 0 1 3 2 6 7 5 4 12 13 15 14 10 11 9 8 ...
export function graycode(i) {
  return i ^ (i >> 1);
}

// https://en.wikipedia.org/wiki/Walsh_matrix
// walsh(i, 16) = [0 8 12 4 6 14 10 2 3 11 15 7 5 13 9 1]
export function walsh(i, n) {
  return bitrev(graycode(i), n);
}

const walshseqs = new Map();
export function walshPermutation(src, res = src.slice(0)) {
  let n = src.length;
  dcheck(is_pow2(n) && res.length == n);

  let seq = walshseqs.get(n);
  if (!seq) {
    seq = new Int32Array(n);
    for (let i = 0; i < n; i++)
      seq[i] = walsh(i, n);
    walshseqs.set(n, seq);
  }

  for (let i = 0; i < n; i++)
    res[seq[i]] = src[i];
  return res;
}

export function re2reim(src, res = new Float32Array(src.length * 2)) {
  let n = src.length;
  dcheck(res.length == 2 * n);
  for (let i = n - 1; i >= 0; i--)
    res[2 * i] = src[i], res[2 * i + 1] = 0;
  return res;
}

// https://en.wikipedia.org/wiki/Fast_Walsh%E2%80%93Hadamard_transform
// fwht(fwht(a)) == a
// fwht(a, a) is OK
export function fwht(src, res = new Float32Array(src.length)) {
  let h = 1, n = src.length;
  dcheck(is_pow2(n) && res.length == src.length);
  if (src != res) res.set(src, 0);

  for (let h = 1; h < n; h *= 2) {
    for (let i = 0; i < n; i += h * 2) {
      for (let j = i; j < i + h; j++) {
        let x = res[j];
        let y = res[j + h];
        res[j] = x + y;
        res[j + h] = x - y;
      }
    }
  }

  let norm = 1 / Math.sqrt(n);
  for (let i = 0; i < n; i++)
    res[i] *= norm;
  return res;
}

export function computeFFT(src, res) {
  return FFT.forward(src, res);
}

export function forwardFFT(signal_re) {
  let n = signal_re.length;
  let res2 = forwardReFFT(signal_re);
  return new Float32Tensor([n, 2], res2);
}

export function inverseFFT(frame) {
  dcheck(frame.rank == 2 && frame.dims[1] == 2);
  let n = frame.dims[0];
  let sig2 = new Float32Array(n * 2);
  FFT.inverse(frame.array, sig2);
  return FFT.re(sig2);
}

// Input: Float32Tensor, H x W x 2
// Output: Float32Tensor, H x W x 2
export function computeFFT2D(input) {
  let [h, w, rsn] = input.dims;
  dcheck(input.rank == 3 && rsn == 2);

  let output = new Float32Tensor([h, w, 2]);
  let row = new Float32Array(w * 2);
  let col = new Float32Array(h * 2);
  let tmp = new Float32Array(h * 2);

  // row-by-row fft
  for (let y = 0; y < h; y++) {
    let sig = input.subtensor(y).array;
    FFT.forward(sig, row);
    output.subtensor(y).array.set(row);
  }

  // col-by-col fft
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let p = y * w + x;
      col[y * 2 + 0] = output.array[p * 2 + 0];
      col[y * 2 + 1] = output.array[p * 2 + 1];
    }

    FFT.forward(col, tmp);

    for (let y = 0; y < h; y++) {
      let p = y * w + x;
      output.array[p * 2 + 0] = tmp[y * 2 + 0];
      output.array[p * 2 + 1] = tmp[y * 2 + 1];
    }
  }

  return output;
}

// http://www.robinscheibler.org/2013/02/13/real-fft.html
// x -> Z -> (Xe, Xo) -> X
export function forwardReFFT(x, X, [Xe, Xo] = []) {
  let n = x.length;

  X = X || new Float32Array(2 * n);
  Xe = Xe || new Float32Array(n);
  Xo = Xo || new Float32Array(n);

  let Z = X.subarray(0, n);

  dcheck(X.length == 2 * n);
  dcheck(Z.length == n);
  dcheck(Xe.length == n);
  dcheck(Xo.length == n);

  FFT.forward(x, Z);
  splitDFTs(Xe, Xo, Z);
  mergeDFTs(Xe, Xo, X);

  return X;
}

// Z -> X + iY
function splitDFTs(X, Y, Z) {
  let n = X.length / 2;

  dcheck(Y.length == 2 * n);
  dcheck(Z.length == 2 * n);

  for (let k = 0; k < n; k++) {
    let k1 = k, k2 = (-k + n) % n;
    let re1 = Z[2 * k1 + 0];
    let im1 = Z[2 * k1 + 1];
    let re2 = Z[2 * k2 + 0];
    let im2 = Z[2 * k2 + 1];
    X[2 * k + 0] = (re1 + re2) / 2;
    X[2 * k + 1] = (im1 - im2) / 2;
    Y[2 * k + 0] = (im1 + im2) / 2;
    Y[2 * k + 1] = (re2 - re1) / 2;
  }
}

// (Xe, Xo) -> X
function mergeDFTs(Xe, Xo, X) {
  let n = Xe.length;
  let uroots = FFT.get(n).uroots;

  dcheck(Xo.length == n);
  dcheck(X.length == 2 * n);

  for (let k = 0; k < n; k++) {
    let k1 = k % (n / 2);
    let k2 = (n - k) % n;
    let re1 = Xe[2 * k1 + 0];
    let im1 = Xe[2 * k1 + 1];
    let re2 = Xo[2 * k1 + 0];
    let im2 = Xo[2 * k1 + 1];
    let cos = uroots[k2 * 2 + 0];
    let sin = uroots[k2 * 2 + 1];
    // (re1, im1) + (re2, im2) * (cos, sin)
    X[2 * k + 0] = re1 + re2 * cos - im2 * sin;
    X[2 * k + 1] = im1 + re2 * sin + im2 * cos;
  }
}

export function applyBandpassFilter(signal, filter_fn) {
  let n = signal.length;
  let fft = forwardFFT(signal);

  for (let i = 0; i < n; i++) {
    let f = Math.min(i, n - i);
    let s = filter_fn(f);
    fft.array[2 * i + 0] *= s;
    fft.array[2 * i + 1] *= s;
  }

  return inverseFFT(fft);
}

export function drawSpectrogram(canvas, spectrogram, {
  x2_mul = s => s, rgb_fn = s => [s * 9, s * 3, s * 1], sqrabs_max = 0,
  reim_fn = reim2, disk = false, fs_full = false, clear = true, num_freqs = 0 } = {}) {

  let h = canvas.height;
  let w = canvas.width;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, w, h);
  sqrabs_max = sqrabs_max || getSpectrogramMax(spectrogram, reim_fn);
  let rgb_reim = (re, im) => rgb_fn(x2_mul(reim_fn(re, im) / sqrabs_max));
  let [num_frames, frame_size] = spectrogram.dims;

  if (clear) img.data.fill(0);

  if (!disk) {
    for (let x = 0; x < w; x++) {
      let frame = spectrogram.subtensor(x / w * num_frames | 0);
      drawSpectrogramFrame(img, frame, x, rgb_reim, fs_full, num_freqs);
    }
  } else {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let dx = (x - 0.5) / w * 2 - 1;
        let dy = (y - 0.5) / h * 2 - 1;
        let [r, a] = xy2ra(dy, dx);
        if (r >= 1.0) continue;
        let t = Math.abs((a / Math.PI + 2.0) % 1.0) * num_frames;
        let f = (Math.sign(a) * r * 0.5 * num_freqs + frame_size) % frame_size;
        dcheck(t >= 0 && t < num_frames);
        dcheck(f >= 0 && f < frame_size);
        let tf = Math.round(t) * frame_size + Math.round(f);
        let re = spectrogram.data[tf * 2 + 0];
        let im = spectrogram.data[tf * 2 + 1];
        addFreqRGB(img, x, y, rgb_reim(re, im));
      }
    }
  }

  ctx.putImageData(img, 0, 0);
}

// (1, 0) -> (1, 0)
// (-1, +0) -> (1, +PI)
// (-1, -0) -> (1, -PI)
export function xy2ra(x, y) {
  let r = Math.sqrt(x * x + y * y);
  let a = Math.atan2(y, x); // -PI..PI
  return [r, a]
}

export async function drawSpectrogramFromFile(canvas, file_blob, config = {}) {
  if (config.num_freqs < 1.0)
    dcheck(config.frame_size > 0);

  config.colors = config.colors || 'flame';
  config.sample_rate = config.sample_rate || 48000;
  config.num_frames = config.num_frames || 1024;
  config.num_freqs = config.num_freqs || 1024;
  config.frame_size = config.frame_size || config.num_freqs * 2;
  config.frame_width = config.frame_width || Math.round(config.sample_rate * 0.020);
  config.frame_width = Math.min(config.frame_width, config.frame_size);
  config.rgb_fn = config.rgb_fn || {
    'flame': s => [s * 4, s * 2, s * 1],
    'black-white': s => [1 - 3 * s, 1 - 3 * s, 1 - 3 * s],
  }[config.colors];

  let sig = await decodeAudioFile(file_blob, config.sample_rate);
  let sg = await computePaddedSpectrogram(sig, config);

  if (config.num_freqs < 1.0) {
    let { freq_max } = computeSpectrumPercentile(sg, config.num_freqs);
    let num_freqs = freq_max;
    console.log('spectrum pctile:', config.num_freqs, num_freqs, '/', config.frame_size / 2);
    config = { ...config, num_freqs };
  }

  await drawSpectrogram(canvas, sg, config);
  return canvas;
}

export function getMaskedSpectrogram(spectrogram1, mask_fn) {
  dcheck(is_spectrogram(spectrogram1));
  let dims = spectrogram1.dimensions.slice(0);
  let [t_size, f_size] = dims;
  let data = new Float32Array(t_size * f_size * 2);
  let spectrogram2 = new Float32Tensor(dims, data);

  for (let t = 0; t < t_size; t++) {
    let frame1 = spectrogram1.subtensor(t).array;
    let frame2 = spectrogram2.subtensor(t).array;

    for (let f = 0; f < f_size; f++) {
      let m = mask_fn(t, f);
      frame2[2 * f + 0] = m * frame1[2 * f + 0];
      frame2[2 * f + 1] = m * frame1[2 * f + 1];
    }
  }

  return spectrogram2;
}

export function getSpectrogramMax(sg, fn = reim2) {
  return getFrameMax(sg.array, fn);
}

export function getFrameMax(data, reim_fn = reim2) {
  return aggFrameData(data, reim_fn, Math.max, 0);
}

export function getFrameSum(data) {
  return aggFrameData(data, reim2, (sum, sqr) => sum + sqr, 0);
}

function aggFrameData(data, fn, reduce, initial = 0) {
  let max = initial;
  for (let i = 0; i < data.length / 2; i++) {
    let re = data[i * 2];
    let im = data[i * 2 + 1];
    max = reduce(max, fn(re, im));
  }
  return max;
}

function drawSpectrogramFrame(img, frame, x, rgb_fn, fs_full, num_freqs) {
  let frame_size = frame.dimensions[0];
  let freq_max = Math.min(num_freqs || frame_size, frame_size) / (fs_full ? 1 : 2);
  let w = img.width;
  let h = img.height;

  for (let y = 0; y < h; y++) {
    let f = (h - 1 - y) / h * freq_max | 0;
    let re = frame.array[f * 2];
    let im = frame.array[f * 2 + 1];
    let rgb = rgb_fn(re, im);
    addFreqRGB(img, x, y, rgb);
  }
}

function addFreqRGB(img, x, y, rgb) {
  let i = (x + y * img.width) * 4;

  img.data[i + 0] += 255 * rgb[0];
  img.data[i + 1] += 255 * rgb[1];
  img.data[i + 2] += 255 * rgb[2];
  img.data[i + 3] += 255;
}

// Returns a Float32Tensor: num_frames x frame_size x 2.
export function computeSpectrogram(signal, { transform, use_winf, num_frames, frame_size, frame_width, min_frame, max_frame }) {
  if (frame_width) dcheck(frame_width <= frame_size);
  dcheck(is_pow2(frame_size));

  let sig1 = new Float32Array(frame_size);
  let tmp1 = new Float32Array(frame_size);
  let tmp2 = new Float32Array(frame_size);

  min_frame = min_frame || 0;
  max_frame = max_frame || num_frames - 1;
  transform = transform || ((sig, res) => forwardReFFT(sig, res, [tmp1, tmp2]));

  let frames = new Float32Tensor([max_frame - min_frame + 1, frame_size, 2]); // (re, im)

  for (let t = min_frame; t <= max_frame; t++) {
    let res1 = frames.subtensor(t - min_frame).data;
    readAudioFrame(signal, sig1, { use_winf, num_frames, frame_id: t, frame_width });
    transform(sig1, res1);
  }

  return frames;
}

// Pads the input signal with zeros for smoothness.
export async function computePaddedSpectrogram(signal, { use_winf, transform, num_frames, frame_size, frame_width }) {
  let padded = new Float32Array(signal.length + frame_size * 2);
  padded.set(signal, (padded.length - signal.length) / 2);
  let frame_step = signal.length / num_frames;
  let padded_frames = padded.length / frame_step | 0;
  let spectrogram = computeSpectrogram(padded, { use_winf, transform, num_frames: padded_frames, frame_size, frame_width });
  let null_frames = (padded_frames - num_frames) / 2 | 0;
  return spectrogram.slice(null_frames, null_frames + num_frames);
}

export function getAvgSpectrum(spectrogram) {
  dcheck(is_spectrogram(spectrogram));
  let [num_frames, frame_size] = spectrogram.dimensions;
  let spectrum = new Float32Array(frame_size);

  for (let t = 0; t < num_frames; t++) {
    let frame = spectrogram.subtensor(t).array;
    for (let f = 0; f < frame_size; f++)
      spectrum[f] += reim2(frame[2 * f], frame[2 * f + 1]) / num_frames;
  }


  return spectrum;
}

// Finds the smallest sub-rectangle of the spectrogram that
// contains at least |pctile| fraction of the total energy.
export function computeSpectrumPercentile(spectrogram, freq_pctile, time_pctile = freq_pctile) {
  dcheck(is_spectrogram(spectrogram));
  dcheck(freq_pctile >= 0.0 && freq_pctile <= 1.0);
  dcheck(time_pctile >= 0.0 && time_pctile <= 1.0);

  let spectrum = getAvgSpectrum(spectrogram);
  let timeline = getVolumeTimeline(spectrogram);
  let sum_x2 = spectrum.reduce((sum, x2) => sum + x2, 0.0);

  let n = spectrum.length;
  let psum = sum_x2 - spectrum[n / 2];
  let freq_max = n / 2 - 1;

  while (freq_max > 0) {
    let psum2 = psum - spectrum[freq_max] - spectrum[(n - freq_max) % n];
    if (psum2 < sum_x2 * freq_pctile)
      break;
    psum = psum2;
    freq_max--;
  }

  let m = timeline.length;
  let vsum = sum_x2;
  let time_min = 0, time_max = m - 1;

  while (time_min < time_max) {
    let diff = 0.0;
    if (vsum - timeline[time_min] >= sum_x2 * time_pctile && time_min < time_max) {
      diff += timeline[time_min];
      time_min++;
    }
    if (vsum - timeline[time_max] >= sum_x2 * time_pctile && time_min < time_max) {
      diff += timeline[time_max];
      time_max--;
    }
    if (diff > 0)
      vsum -= diff;
    else
      break;
  }

  return { freq_max, time_min, time_max };
}

export function getVolumeTimeline(spectrogram) {
  dcheck(is_spectrogram(spectrogram));
  let [num_frames, frame_size] = spectrogram.dimensions;
  let timeline = new Float32Array(num_frames);

  for (let t = 0; t < num_frames; t++) {
    let frame = spectrogram.subtensor(t).array;
    timeline[t] = getFrameSum(frame) / frame_size;
  }

  return timeline;
}

export function getAmpDensity(spectrogram, num_bins = 1024, amp2_map = Math.sqrt) {
  dcheck(is_spectrogram(spectrogram));
  let density = new Float32Array(num_bins);
  let abs2_max = getFrameMax(spectrogram.array);

  aggFrameData(spectrogram.array, reim2, (_, abs2) => {
    let i = amp2_map(abs2 / abs2_max) * num_bins | 0;
    density[i] += 2 / spectrogram.array.length;
  });

  return density;
}

// frame_size = fft_bins * 2
export function readAudioFrame(signal, frame,
  { num_frames, frame_id, t_step = 1, frame_width = frame.length, use_winf = true }) {
  let step = signal.length / num_frames;
  let base = frame_id * step | 0;
  let len0 = Math.min(frame_width, (signal.length - 1 - base) / t_step | 0);

  frame.fill(0);

  for (let i = 0; i < len0; i++) {
    let h = use_winf ? lanczos_ab(i / frame_width, 1, 0, 1) : 1.0;
    let k = base + t_step * i | 0;
    let s = k < signal.length ? signal[k] : 0;
    frame[i] = h * s;
  }

  return frame;
}

// Returns null if no file was selected.
export async function selectAudioFile({ multiple = false } = {}) {
  let input = document.createElement('input');
  input.type = 'file';
  input.accept = 'audio/*';
  input.multiple = multiple;
  input.click();
  return await new Promise(resolve =>
    input.onchange = () => resolve(multiple ? input.files : input.files[0]));
}

// Returns a Float32Array.
export async function decodeAudioFile(file, sample_rate = 48000) {
  let encoded_data = await file.arrayBuffer();
  let audio_ctx = new AudioContext({ sampleRate: sample_rate });
  try {
    let audio_buffer = await audio_ctx.decodeAudioData(encoded_data);
    let channel_data = audio_buffer.getChannelData(0);
    return channel_data;
  } finally {
    audio_ctx.close();
  }
}

export async function playSound(sound_data, sample_rate) {
  let audio_ctx = new AudioContext({ sampleRate: sample_rate });
  try {
    let buffer = audio_ctx.createBuffer(1, sound_data.length, sample_rate);
    buffer.getChannelData(0).set(sound_data);
    let source = audio_ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(audio_ctx.destination);
    source.start();
    await new Promise(resolve => source.onended = resolve);
  } finally {
    audio_ctx.close();
  }
}

// Returns an audio/wav Blob.
export async function recordAudio({ sample_rate = 48000, max_duration = 1.0 } = {}) {
  let stream = await navigator.mediaDevices.getUserMedia({ audio: true, sampleRate: sample_rate });
  try {
    let recorder = new AudioRecorder(stream, sample_rate);
    await recorder.start();

    if (max_duration > 0)
      await sleep(max_duration * 1000);
    else if (max_duration instanceof Promise)
      await max_duration;
    else
      dcheck('Invalid max_duration: ' + max_duration);

    let blob = await recorder.fetch();
    await recorder.stop();
    return blob;
  } finally {
    stream.getTracks().map(t => t.stop());
  }
}

// When wavelet is downscaled, it should be multiplied
// correspondingly: see a definition of the Morlet wavelet.
export function createDefaultWavelet(num_reps, padding_sec) {
  return (time_sec) => {
    let im = Math.sin(time_sec * 2 * Math.PI);
    let wf = hann_ab(time_sec / (num_reps + padding_sec), -0.5, 0.5);
    return im * wf;
  };
}

function convolveReSignal(sig_fft, wav, res) {
  let n = sig_fft.length / 2;
  dcheck(wav.length == n);
  dcheck(res.length == n);
  let wav_fft = forwardFFT(wav).array;
  let res_fft = FFT.dot(sig_fft, wav_fft);
  FFT.re(FFT.inverse(res_fft), res);
}

export function upsampleSignal(src, res) {
  for (let j = 0; j < res.length; j++) {
    let t = (j + 0.5) / res.length; // absolute 0..1 coordinate
    let i = t * src.length - 0.5; // fractional index in src
    let a = Math.max(0, Math.floor(i));
    let b = Math.min(src.length - 1, Math.ceil(i));
    res[j] = mix(src[a], src[b], i - a);
  }
}

// Same as the convolution with a basic rectangular window function.
export function downsampleSignal(src, res) {
  dcheck(src.length >= res.length);
  let n = src.length, m = res.length;

  for (let j = 0; j < m; j++) {
    let i_min = Math.ceil(j * n / m - 0.5);
    let i_max = Math.floor((j + 1) * n / m - 0.5);
    dcheck(i_min >= 0 && i_max < n);
    dcheck(i_min <= i_max);

    let sum = 0;
    for (let i = i_min; i <= i_max; i++)
      sum += src[i];

    res[j] = sum * m / n;
  }
}

function shiftSignal(src, res, shift) {
  dcheck(src.length <= res.length);
  let n = res.length;
  for (let i = 0; i < src.length; i++)
    res[(Math.round(i + shift) + n) % n] = src[i];
}

// Output: Float32Tensor(time_steps x num_freqs x 2).
export async function computeCWT(signal, {
  sample_rate,
  // The wavelet function at scale=1.
  base_wavelet = createDefaultWavelet(15, 0.025),
  time_steps = 1024,
  num_freqs = 1024,
  freq_min = 0,
  freq_max = sample_rate / 2,
  progress_fn } = {}) {

  dcheck(sample_rate > 0);
  dcheck(time_steps > 0);
  dcheck(num_freqs > 0);
  dcheck(freq_min >= 0 && freq_max <= sample_rate / 2 && freq_min <= freq_max);
  dcheck(base_wavelet);

  // Zero padding and 2^N alignment for FFT.
  let n = 2 ** (Math.ceil(Math.log2(signal.length)) + 1);
  let output = new Float32Tensor([time_steps, num_freqs, 2]);
  let wav_centered = new Float32Array(n);
  let convolved = new Float32Array(n);
  let sig_padded = new Float32Array(n);
  sig_padded.set(signal);
  let signal_fft = forwardFFT(sig_padded).array;
  let samples = new Float32Array(time_steps);
  let t = Date.now(), dt = await progress_fn?.(0);

  for (let s = 0; s < num_freqs; s++) {
    let freq_hz = mix(freq_min, freq_max, s / num_freqs);
    for (let i = -n / 2; i < n / 2; i++)
      wav_centered[(i + n) % n] = base_wavelet(i / sample_rate * freq_hz) * freq_hz;

    convolveReSignal(signal_fft, wav_centered, convolved);
    for (let i = 0; i < n; i++)
      convolved[i] = reim2(convolved[i], 0);

    downsampleSignal(convolved.subarray(0, signal.length), samples);
    for (let i = 0; i < time_steps; i++)
      samples[i] = Math.sqrt(samples[i]);

    for (let t = 0; t < time_steps; t++)
      output.array[(t * num_freqs + s) * 2] = samples[t];

    if (progress_fn && dt > 0 && Date.now() - t > dt) {
      t = Date.now();
      dt = await progress_fn((s + 1) / num_freqs, output);
      if (!dt) break;
    }
  }

  return output;
}

export function computeAutoCorrelation(signal, res = signal.slice(0)) {
  let n = signal.length;
  let sig1 = new Float32Array(2 ** Math.ceil(Math.log2(2 * n)));
  let sig2 = sig1.slice(0);

  sig1.set(signal);
  sig2.set(signal, 0);
  sig2.set(signal, n);

  let fft1 = forwardReFFT(sig1);
  let fft2 = forwardReFFT(sig2);

  FFT.conjugate(fft1);
  FFT.dot(fft1, fft2, fft1);
  FFT.inverse(fft1, fft2);
  FFT.re(fft2, sig1);

  res.set(sig1.subarray(0, n));
  return res;
}

export class AudioRecorder {
  constructor(stream, sample_rate) {
    this.stream = stream;
    this.sample_rate = sample_rate;
    this.onaudiodata = null;

    this.audio_blob = null;
    this.audio_ctx = null;
    this.worklet = null;
    this.mss = null;
    this.stream_ended = null;
  }

  async start() {
    try {
      await this.init();
    } catch (err) {
      this.close();
      throw err;
    }

    let stream = this.stream;
    if (!stream.active)
      throw new Error('Stream is not active: ' + stream.id);

    this.stream_ended = new Promise((resolve) => {
      if ('oninactive' in stream) {
        console.debug('Watching for stream.oninactive');
        stream.addEventListener('inactive', resolve);
      } else {
        console.debug('Started a timer waiting for !stream.active');
        let timer = setInterval(() => {
          if (!stream.active) {
            resolve();
            clearInterval(timer);
            console.debug('Stopped the !stream.active timer');
          }
        }, 25);
      }
    });

    this.stream_ended.then(async () => {
      console.debug('Audio stream ended');
      this.stop();
    });
  }

  async stop() {
    await this.fetch();
    this.close();
  }

  async init() {
    log('Initializing the mic recorder @', this.sample_rate, 'Hz');
    this.audio_ctx = new AudioContext({ sampleRate: this.sample_rate });

    await this.audio_ctx.audioWorklet.addModule('/mic-rec.js');
    this.worklet = new AudioWorkletNode(this.audio_ctx, 'mic-rec');
    // this.worklet.onprocessorerror = (e) => console.error('mic-rec worklet:', e);

    this.mss = this.audio_ctx.createMediaStreamSource(this.stream);
    this.mss.connect(this.worklet);
    await this.audio_ctx.resume();
  }

  async fetch() {
    if (!this.worklet) return;
    log('Fetching audio data from the worklet');
    this.worklet.port.postMessage('foo');
    let { channels } = await new Promise((resolve) =>
      this.worklet.port.onmessage = (e) => resolve(e.data));

    dcheck(channels.length > 0);
    let blob = new Blob(channels[0]);
    let data = await blob.arrayBuffer();
    dcheck(data.byteLength % 4 == 0);
    let wave = new Float32Array(data);
    log('Recorded audio:', (wave.length / this.sample_rate).toFixed(2), 'sec');
    let wav_buffer = generateWavFile(wave, this.sample_rate);
    this.audio_blob = new Blob([wav_buffer], { type: 'audio/wav' });
    this.onaudiodata?.(this.audio_blob);
    return this.audio_blob;
  }

  close() {
    this.mss?.disconnect();
    this.worklet?.disconnect();
    this.audio_ctx?.close();
    this.mss = null;
    this.worklet = null;
    this.audio_ctx = null;
  }
}

// https://docs.fileformat.com/audio/wav
export function generateWavFile(wave, sample_rate) {
  let len = wave.length;
  let i16 = new Int16Array(22 + len + len % 2);
  let i32 = new Int32Array(i16.buffer);

  i16.set([
    0x4952, 0x4646, 0x0000, 0x0000, 0x4157, 0x4556, 0x6d66, 0x2074,
    0x0010, 0x0000, 0x0001, 0x0001, 0x0000, 0x0000, 0x0000, 0x0000,
    0x0002, 0x0010, 0x6164, 0x6174, 0x0000, 0x0000]);

  i32[1] = i32.length * 4; // file size
  i32[6] = sample_rate;
  i32[7] = sample_rate * 2; // bytes per second
  i32[10] = len * 2; // data size

  for (let i = 0; i < len; i++)
    i16[22 + i] = wave[i] * 0x7FFF;

  return i16.buffer;
}

class FFTWorker {
  static workers = [];
  static requests = {};
  static handlers = {};

  static get(worker_id) {
    let worker = FFTWorker.workers[worker_id] || new FFTWorker(worker_id);
    return FFTWorker.workers[worker_id] = worker;
  }

  constructor(id) {
    this.id = id;
    this.worker = new Worker('/utils.js', { type: 'module' });
    this.worker.onmessage = (e) => {
      let { txid, res, err } = e.data;
      // this.dlog('received a message:', txid, { res, err });
      let promise = FFTWorker.requests[txid];
      dcheck(promise);
      delete FFTWorker.requests[txid];
      err ? promise.reject(err) : promise.resolve(res);
    };
    this.dlog('started');
  }

  terminate() {
    this.worker.terminate();
    delete FFTWorker.workers[this.id];
    this.dlog('terminated');
  }

  sendRequest(req, transfer = []) {
    dcheck(req && req.call && req.args);
    dcheck(Array.isArray(transfer));
    let txid = Date.now() + '.' + (Math.random() * 1e6).toFixed(0);
    let message = { req, txid };
    this.worker.postMessage(message, transfer);
    // this.dlog('was sent a message:', txid, req);
    return new Promise((resolve, reject) => {
      FFTWorker.requests[txid] = { resolve, reject };
    });
  }

  dlog(...args) {
    console.info('fftw.' + this.id, ...args);
  }
}

if (typeof window === 'undefined') {
  console.debug('Registering a Worker onmessage handler');
  onmessage = (e) => {
    let { txid, req } = e.data;
    // console.debug('Routing a worker request:', txid, req);
    dcheck(txid && req && req.call && req.args);
    let handler = FFTWorker.handlers[req.call];
    dcheck(handler);
    try {
      let { res, transfer } = handler(...req.args);
      dcheck(Array.isArray(transfer));
      let message = { txid, res };
      // console.debug('Posting a worker message:', message);
      postMessage(message, transfer);
    } catch (err) {
      let message = { txid, err };
      postMessage(message);
    }
  };
}

FFTWorker.handlers['spectrogram'] = (signal, config) => {
  console.debug('"spectrogram" handler invoked:', config);
  let frames = computeSpectrogram(signal, config);
  let dims = frames.dimensions;
  let data = frames.array;
  return { res: { dims, data }, transfer: [data.buffer] };
};

async function computeSpectrogramAsync(worker_id, signal, config) {
  let worker = FFTWorker.get(worker_id);
  let req = { call: 'spectrogram', args: [signal, config] };
  let { dims, data } = await worker.sendRequest(req, [signal.buffer]);
  return new Float32Tensor(dims, data);
}

export function shiftCanvasData(canvas, { dx = 0, dy = 0 }) {
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.putImageData(img, -dx, -dy);
  ctx.putImageData(img, +dx, +dy);
}

// await showStatus("foobar", { "exit": () => ... })
export async function showStatus(text, buttons) {
  let str = Array.isArray(text) ? text.join(' ') : text + '';
  str && console.info(str);
  let status = initStatusBar();
  status.style.display = str || buttons ? '' : 'none';
  status.innerText = str;
  if (buttons) {
    for (let name in buttons) {
      let handler = buttons[name];
      let a = document.createElement('a');
      a.innerText = name;
      if (typeof handler == 'function')
        a.onclick = () => { a.onclick = null; handler(); };
      else if (typeof handler == 'string')
        a.href = handler;
      else
        throw new Error('Invalid button handler for ' + name);
      a.style.textDecoration = 'underline';
      a.style.cursor = 'pointer';
      a.style.marginLeft = '1em';
      a.style.color = 'inherit';
      status.append(a);
    }
  }
  await sleep(15);
}

export function hideStatus() {
  showStatus('');
}

function initStatusBar() {
  let id = 'status_283992';
  let status = $('#' + id);
  if (status) return status;

  status = document.createElement('div');
  status.id = id;
  status.style.background = '#448';
  status.style.color = '#fff';
  status.style.padding = '0.25em';
  status.style.display = 'none';

  let middle = document.createElement('div');
  middle.style.zIndex = '432';
  middle.style.position = 'fixed';
  middle.style.width = '100%';
  middle.style.top = '50%';
  middle.style.textAlign = 'center';

  middle.append(status);
  document.body.append(middle);
  return status;
}

export function setUncaughtErrorHandlers() {
  window.onerror = (event, source, lineno, colno, error) => showStatus(error);
  window.onunhandledrejection = (event) => showStatus(event.reason);
}

// An indexedDB wrapper:
//
//    db = DB.open("foo");
//    tab = db.openTable("bar");
//    await tab.set("key", "value");
//    val = await tab.get("key");
//
//    tab = DB.open("foo/bar"); // short form
//
export class DB {
  static open(name) {
    if (name.indexOf('/') < 0)
      return new DB(name);
    let [db_name, tab_name, ...etc] = name.split('/');
    dcheck(etc.length == 0);
    return DB.open(db_name).openTable(tab_name);
  }

  static get(key_path) {
    let [db_name, tab_name, key_name, ...etc] = key_path.split('/');
    dcheck(etc.length == 0);
    return DB.open(db_name).openTable(tab_name).get(key_name);
  }

  static set(key_path, val) {
    let [db_name, tab_name, key_name, ...etc] = key_path.split('/');
    dcheck(etc.length == 0);
    return DB.open(db_name).openTable(tab_name).set(key_name, val);
  }

  constructor(name) {
    dcheck(name.indexOf('/') < 0);
    this.name = name;
    this.version = 1;
    this.tnames = new Set();
  }
  openTable(name) {
    if (this.tnames.has(name))
      throw new Error(`Table ${this.name}.${name} is alredy opened.`);
    let t = new IndexedDBTable(name, this);
    this.tnames.add(name);
    return t;
  }
  _init() {
    if (this.ready)
      return this.ready;
    let time = Date.now();
    this.ready = new Promise((resolve, reject) => {
      let req = indexedDB.open(this.name, this.version);
      req.onupgradeneeded = (e) => {
        log(this.name + ':upgradeneeded');
        let db = e.target.result;
        for (let tname of this.tnames) {
          log('Opening a table:', tname);
          db.createObjectStore(tname);
        }
      };
      req.onsuccess = (e) => {
        // log(this.name + ':success', Date.now() - time, 'ms');
        this.db = e.target.result;
        resolve(this.db);
      };
      req.onerror = e => {
        console.error(this.name + ':error', e);
        reject(e);
      };
    });
    return this.ready;
  }
}

class IndexedDBTable {
  constructor(name, db) {
    dcheck(name.indexOf('/') < 0);
    this.name = name;
    this.db = db;
  }
  async get(key) {
    let db = await this.db._init();
    return new Promise((resolve, reject) => {
      let t = db.transaction(this.name, 'readonly');
      let s = t.objectStore(this.name);
      let r = s.get(key);
      r.onerror = () => reject(new Error(`${this.name}.get(${key}) failed: ${r.error}`));
      r.onsuccess = () => resolve(r.result);
    });
  }
  async set(key, value) {
    let db = await this.db._init();
    await new Promise((resolve, reject) => {
      let t = db.transaction(this.name, 'readwrite');
      let s = t.objectStore(this.name);
      let r = s.put(value, key);
      r.onerror = () => reject(new Error(`${this.name}.set(${key}) failed: ${r.error}`));
      r.onsuccess = () => resolve();
    });
  }
  async remove(key) {
    let db = await this.db._init();
    await new Promise((resolve, reject) => {
      let t = db.transaction(this.name, 'readwrite');
      let s = t.objectStore(this.name);
      let r = s.delete(key);
      r.onerror = () => reject(new Error(`${this.name}.remove(${key}) failed: ${r.error}`));
      r.onsuccess = () => resolve();
    });
  }
  async keys() {
    let db = await this.db._init();
    return new Promise((resolve, reject) => {
      let t = db.transaction(this.name, 'readonly');
      let s = t.objectStore(this.name);
      let r = s.getAllKeys();
      r.onerror = () => reject(new Error(`${this.name}.keys() failed: ${r.error}`));
      r.onsuccess = () => resolve(r.result);
    });
  }
}

export function setPixels(canvas, rgba_fn) {
  let w = canvas.width;
  let h = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let yx = (y * w + x) * 4;
      let [r, g, b, a = 1] = rgba_fn(x, y, w, h);
      img.data[yx + 0] = r * 255;
      img.data[yx + 1] = g * 255;
      img.data[yx + 2] = b * 255;
      img.data[yx + 3] = a * 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

export function drawCurve(canvas, steps, t2xy_fn) {
  dcheck(steps >= 2);
  let ctx = canvas.getContext('2d');
  ctx.beginPath();

  for (let i = 0; i < steps; i++) {
    let t = i / (steps - 1);
    let [x, y] = t2xy_fn(t);
    i > 0 ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }

  ctx.stroke();
}

export function hsl2rgb(h, s, l) {
  if (!s) return [l, l, l];

  let q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  let p = 2 * l - q;
  let r = hue2rgb(p, q, h + 1 / 3);
  let g = hue2rgb(p, q, h);
  let b = hue2rgb(p, q, h - 1 / 3);

  return [r, g, b];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

export function rgb2hsl(r, g, b) {
  let vmax = max(r, g, b);
  let vmin = min(r, g, b);
  let c = vmax - vmin; // chroma
  let h, l = (vmax + vmin) / 2;
  let s = 0.5 * c / min(l, 1.0 - l);

  if (!c) return [0, 0, l];

  if (vmax == r) h = (g - b) / c + (g < b ? 6 : 0);
  if (vmax == g) h = (b - r) / c + 2;
  if (vmax == b) h = (r - g) / c + 4;

  return [h / 6, s, l];
}

export function rgb2hcl(r, g, b) {
  let [h, s, l] = rgb2hsl(r, g, b);
  let c = s * min(l, 1.0 - l) * 2;
  return [h, c, l];
}

export function hcl2rgb(h, c, l) {
  let s = 0.5 * c / min(l, 1.0 - l);
  return hsl2rgb(h, min(s, 1.0), l);
}

function resampleData(src, res, { coords_fn, num_steps }) {
  dcheck(src.rank == 2 && res.rank == 2);
  let [src_r, src_a] = src.dims;
  let [res_h, res_w] = res.dims;
  let r_steps = src_r * max(1, Math.ceil(num_steps[0] / src_r));
  let a_steps = src_a * max(1, Math.ceil(num_steps[1] / src_a));
  let scale = res_h / r_steps * res_w / a_steps;
  let lw = 1;

  res.data.fill(0);

  let lanczos_xy = (x, y) =>
    lanczos(x, lw) * lanczos(y, lw);

  let interpolate_src = (r, a) => {
    let a0 = Math.round(a);
    let r0 = Math.round(r);
    if (a == a0 && r == r0)
      return src.at(r, a);
    let sum = 0;
    for (let i = -lw; i <= lw; i++) {
      for (let j = -lw; j <= lw; j++) {
        if (i && j) continue;
        let a1 = a0 + i, r1 = r0 + j;
        if (a1 < 0 || a1 >= src_a || r1 < 0 || r1 >= src_r)
          continue;
        sum += src.at(r1, a1) * lanczos_xy(a1 - a, r1 - r);
      }
    }
    return sum;
  };

  for (let sr = 0; sr < r_steps; sr++) {
    for (let sa = 0; sa < a_steps; sa++) {
      let r = sr / r_steps * src_r;
      let a = sa / a_steps * src_a;

      for (let [x, y, w] of coords_fn(a, r)) {
        if (!w) continue;
        x = Math.round(x);
        y = Math.round(y);
        if (x < 0 || x >= res_w || y < 0 || y >= res_h)
          continue;
        res.data[y * res_w + x] += interpolate_src(r, a) * scale * w;
      }
    }
  }
}

export function resampleRect(src, res) {
  dcheck(src.rank == 2 && res.rank == 2);
  let [src_h, src_w] = src.dims;
  let [res_h, res_w] = res.dims;

  resampleData(src, res, {
    num_steps: [res_h, res_w],
    coords_fn: (x, y) => [[
      (x + 0.5) / src_w * res_w - 0.5,
      (y + 0.5) / src_h * res_h - 0.5,
      1.0]],
  });
}

export function resampleDisk(src, res, { num_reps = 1 } = {}) {
  dcheck(src.rank == 2 && res.rank == 2);
  let [src_r, src_a] = src.dims; // src.at(radius, arg)
  let [res_h, res_w] = res.dims;

  resampleData(src, res, {
    num_steps: [
      0.5 * max(res_w, res_h), // radius
      0.5 * (res_w + res_h) * PI], // circumference
    coords_fn: (a, r) => {
      let coords = [];
      for (let i = 0; i < num_reps; i++) {
        let rad = (r + 0.5) / src_r;
        let arg = (a + 0.5) / src_a * 2 * PI / num_reps + 2 * PI * i / num_reps;
        let x = (rad * Math.sin(arg) * 0.5 + 0.5) * res_w;
        let y = (rad * Math.cos(arg) * 0.5 + 0.5) * res_h;
        coords.push([x, y, 1.0 / num_reps]);
      }
      return coords;
    },
  });
}

export function resampleSphere(src, res, { num_reps = 1 } = {}) {
  dcheck(src.rank == 2 && res.rank == 2);
  let [src_r, src_a] = src.dims; // src.at(radius, arg)
  let [res_h, res_w] = res.dims;

  resampleData(src, res, {
    num_steps: [
      2.0 * max(res_w, res_h),
      0.5 * (res_w + res_h) * PI], // circumference
    coords_fn: (a, r) => {
      let coords = [];
      for (let i = 0; i < num_reps; i++) {
        let theta = (r + 0.5) / src_r * PI;
        let phi = (a + 0.5) / src_a * 2 * PI / num_reps + 2 * PI * i / num_reps;
        let x = (Math.sin(theta) * Math.sin(phi) * 0.5 + 0.5) * res_w;
        let y = (Math.sin(theta) * Math.cos(phi) * 0.5 + 0.5) * res_h;
        let z = (Math.cos(theta) * 0.5 + 0.5) * res_h;
        coords.push([x, y, 1.0 / num_reps]);
      }
      return coords;
    },
  });
}
