import { FFT } from 'https://soundshader.github.io/webfft.js';

export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => document.querySelectorAll(selector);
export const log = (...args) => console.log(args.join(' '));
export const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
export const mix = (a, b, x) => a * (1 - x) + b * x;
export const step = (min, x) => x < min ? 0 : 1;
export const clamp = (x, min = 0, max = 1) => Math.max(Math.min(x, max), min);
export const hann = (x) => x > 0 && x < 1 ? Math.sin(Math.PI * x) ** 2 : 0;
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
    this.dimension_size = ds;

    this.array = this.data; // don't use
    this.dimensions = this.dims; //  don't use
  }

  slice(begin, end) {
    dcheck(begin >= 0 && begin < end && end <= this.dims[0]);
    let size = this.dimension_size[0];
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

export function computeFFT(src, res) {
  return FFT.forward(src, res);
}

export function forwardFFT(signal_re) {
  let n = signal_re.length;
  let res2 = forwardReFFT(signal_re);
  return new Float32Tensor([n, 2], res2);
}

export function inverseFFT(frame) {
  dcheck(frame.rank == 2 && frame.dimensions[1] == 2);
  let n = frame.dimensions[0];
  let sig2 = new Float32Array(n * 2);
  FFT.inverse(frame.array, sig2);
  return FFT.re(sig2);
}

// Input: Float32Tensor, H x W x 2
// Output: Float32Tensor, H x W x 2
export function computeFFT2D(input) {
  let [h, w, rsn] = input.dimensions;
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
function xy2ra(x, y) {
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
    let num_freqs = computeSpectrumPercentile(sg, config.num_freqs);
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
export function computeSpectrogram(signal, { num_frames, frame_size, frame_width, min_frame, max_frame }) {
  dcheck(frame_width <= frame_size);
  dcheck(is_pow2(frame_size));

  let sig1 = new Float32Array(frame_size);
  let tmp1 = new Float32Array(frame_size);
  let tmp2 = new Float32Array(frame_size);

  min_frame = min_frame || 0;
  max_frame = max_frame || num_frames - 1;

  let frames = new Float32Tensor([max_frame - min_frame + 1, frame_size, 2]); // (re, im)

  for (let t = min_frame; t <= max_frame; t++) {
    let res1 = frames.subtensor(t - min_frame).array;
    readAudioFrame(signal, sig1, { num_frames, frame_id: t, frame_width });
    forwardReFFT(sig1, res1, [tmp1, tmp2]);
  }

  return frames;
}

// Pads the input signal with zeros for smoothness.
export async function computePaddedSpectrogram(signal, { num_frames, frame_size, frame_width }) {
  let padded = new Float32Array(signal.length + frame_size * 2);
  padded.set(signal, (padded.length - signal.length) / 2);
  let frame_step = signal.length / num_frames;
  let padded_frames = padded.length / frame_step | 0;
  let spectrogram = computeSpectrogram(padded, { num_frames: padded_frames, frame_size, frame_width });
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

function computeSpectrumPercentile(spectrogram, percentile) {
  dcheck(is_spectrogram(spectrogram));
  dcheck(percentile >= 0.0 && percentile <= 1.0);
  let spectrum = getAvgSpectrum(spectrogram);
  let n = spectrum.length;
  let sum = spectrum.reduce((sum, x2) => sum + x2, 0.0);
  let psum = spectrum[0];

  for (let i = 1; i < n / 2; i++) {
    if (psum >= sum * percentile)
      return i;
    psum += spectrum[i];
    psum += spectrum[n - i];
  }

  return n / 2;
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
export function readAudioFrame(signal, frame, { num_frames, frame_id, t_step = 1, frame_width = frame.length }) {
  let step = signal.length / num_frames;
  let base = frame_id * step | 0;
  let len0 = Math.min(frame_width, (signal.length - 1 - base) / t_step | 0);

  // frame.set(
  //   signal.subarray(
  //     clamp(t, 0, n - 1),
  //     clamp(t + len, 0, n - 1)));
  //
  // for (let i = 0; i < len; i++)
  //   frame[i] *= hann(i / len);

  frame.fill(0);

  for (let i = 0; i < len0; i++) {
    let h = hann(i / frame_width);
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

export function createDefaultWavelet(n, reps = 25) {
  let w = new Float32Array(n);
  for (let i = 0; i < n; i++)
    w[i] = Math.cos(i / n * 2 * Math.PI * reps) * hann(i / n);
  return w;
}

function convolveReSignal(sig_fft, wav, res) {
  let n = sig_fft.length / 2;
  dcheck(wav.length == n);
  dcheck(res.length == n);
  let wav_fft = forwardFFT(wav).array;
  let res_fft = FFT.dot(sig_fft, wav_fft);
  FFT.re(FFT.inverse(res_fft), res);
}

function sampleSignal(src, res) {
  for (let j = 0; j < res.length; j++) {
    let t = (j + 0.5) / res.length; // absolute 0..1 coordinate
    let i = t * src.length - 0.5; // fractional index in src
    let i1 = Math.max(0, Math.floor(i));
    let i2 = Math.min(src.length - 1, Math.ceil(i));
    res[j] = src[i1] * (i2 - i) + src[i2] * (i - i1);
  }
}

function downsampleSignal(src, res, scale) {
  dcheck(scale > 0 && scale <= 1);
  dcheck(src.length == res.length);
  res.fill(0);
  // Equally-spaced sampling is, perhaps, the worst
  // and the simplest downsampling algorithm known to man.
  let n = src.length;
  sampleSignal(src, res.subarray(0, Math.ceil(n * scale)));
}

function shiftSignal(src, res, shift) {
  dcheck(src.length <= res.length);
  let n = res.length;
  for (let i = 0; i < src.length; i++)
    res[(Math.round(i + shift) + n) % n] = src[i];
}

// Output: time_steps x num_scales x 2.
export async function computeCWT(signal, wavelet,
  { time_steps = 1024, num_scales = 1024, progress } = {}) {

  wavelet = wavelet || createDefaultWavelet(signal.length);

  // Zero padding and 2^N alignment for FFT.
  let n = 2 ** (Math.ceil(Math.log2(signal.length)) + 1);
  let output = new Float32Tensor([time_steps, num_scales, 2]);
  let wav_scaled = new Float32Array(wavelet.length);
  let wav_shifted = new Float32Array(n);
  let convolved = new Float32Array(n);
  let sig_padded = new Float32Array(n);
  sig_padded.set(signal);
  let signal_fft = forwardFFT(sig_padded).array;
  let samples = new Float32Array(time_steps);
  let t = Date.now(), dt = await progress?.(0);

  // A faster method to compute CWT is to split the input signal
  // into overlapping sub-signals, so the wavelet would always
  // fit within at least one of the sub-signal.
  for (let s = 0; s < num_scales; s++) {
    let zoom = (s + 1) / num_scales;
    downsampleSignal(wavelet, wav_scaled, zoom);
    shiftSignal(wav_scaled, wav_shifted, -zoom * wav_scaled.length / 2);
    convolveReSignal(signal_fft, wav_shifted, convolved);
    sampleSignal(convolved.subarray(0, signal.length), samples);

    // When wavelet is downscaled, it should be multiplied
    // correspondingly: see a definition of the Morlet wavelet.
    for (let t = 0; t < time_steps; t++)
      output.array[(t * num_scales + s) * 2] = samples[t] / zoom;

    if (dt > 0 && Date.now() - t > dt) {
      t = Date.now();
      dt = await progress((s + 1) / num_scales, output);
      if (!dt) break;
    }
  }

  return output;
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
