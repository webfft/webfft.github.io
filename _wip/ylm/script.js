import * as utils from '../utils.js';

const { PI, sin, cos, abs, exp, log, sqrt, atan2 } = Math;

// Maps k = 1, 2, 3, ... to (m, n) drum modes ordered by energy levels.
// In practice, k won't exceed 20, since it's the number of harmonics.
const drum_modes = (() => {
  let s = (n) => [0, n];
  let p = (n) => [1, n];
  let d = (n) => [2, n];
  let f = (n) => [3, n];
  return [
    s(1),
    s(2),
    p(2), s(3),
    p(3), s(4),
    d(3), p(4), s(5),
    d(4), p(5), s(6),
    f(4), d(5), p(6), s(7),
    f(5), d(6), p(7), s(8)];
})();

// https://en.wikipedia.org/wiki/Vibrations_of_a_circular_membrane
//
//  J_m(j_mn rad) cos(m (arg + phase))
//
// J_m    = the 1st kind Bessel function, m = 0, 1, 2, ...
// j_mn   = the n-th root of J_m
// phase  = 0..2pi, rotates the drum mode: 0, pi/2 
// rad    = 0..1
// arg    = 0..2pi
//
function drum_mode(m, n, rad, arg, phase = 0) {
  let j_mn = besselj_root(m, n);
  let b_mn = besselj(m, rad * j_mn);
  return b_mn * cos(m * (arg + phase));
}

// The 1st kind Bessel function of integer order.
// Uses a naive approximation with cos & sin.
function besselj(m, r) {
  let c = m > 0 ? sin(r / 4 * PI) : cos(r / 4 * PI);
  return c * 5 ** (-r / 10);
}

// The n-th root of J_m - the 1st kind Bessel function.
// n = 1, 2, 3, ...
// Uses a naive approximation with cos & sin.
function besselj_root(m, n) {
  return m > 0 ? (n - 1) * 4 : 2 + (n - 1) * 4;
}

function kth_drum_mode_image(k, phase = 0, w = 256, h = 256) {
  let img = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx = x / w * 2 - 1; // -1..1
      let dy = y / h * 2 - 1; // -1..1
      let rad = sqrt(dx * dx + dy * dy); // 0..sqrt(2)
      let arg = atan2(dy, dx); // -PI..PI
      if (rad > 1) continue;

      let [m, n] = drum_modes[k];
      let dm = drum_mode(m, n, rad, arg, phase);
      img[y * w + x] = dm;
    }
  }

  return img;
}

function draw_drum_mode(dm_img, canvas, [rr, gg, bb] = [9, 3, 1]) {
  let w = canvas.width, h = canvas.height;
  let ctx = canvas.getContext('2d');
  let img = ctx.getImageData(0, 0, w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ywx = y * w + x;
      let dm = dm_img[ywx];
      let z = dm ** 2 * 255 | 0;
      let i = 4 * ywx;
      img.data[i + 0] += z * rr;
      img.data[i + 1] += z * gg;
      img.data[i + 2] += z * bb;
      img.data[i + 3] += 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

// harmonics[k] = |FFT[k * base_freq]|**2
function sum_harmonics(harmonics, dm_images, scale = 1) {
  let h_len = harmonics.length;
  if (h_len != dm_images.length)
    throw new Error('Harmonics do not match drum mode images');

  let wh = dm_images[0].length;
  let sum = new Float32Array(wh);

  for (let k = 0; k < h_len; k++) {
    for (let i = 0; i < wh; i++) {
      let dm = dm_images[k][i];
      sum[i] += harmonics[k] * dm * scale;
    }
  }

  return sum;
}

function addCanvas(w = 256, h = 256) {
  let canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  document.body.appendChild(canvas);
  return canvas;
};

window.onload = () => {
  let dm_images = [];

  for (let k = 0; k < 20; k++) {
    let canvas = addCanvas();
    let [m, n] = drum_modes[k];
    canvas.title = n + 'spdf'[m];
    dm_images[k] = kth_drum_mode_image(k, PI / 2);
    draw_drum_mode(dm_images[k], canvas);
  }

  let fft_canvas = addCanvas();
  let dhs_canvas = addCanvas();

  fft_canvas.style.cursor = 'pointer';
  fft_canvas.title = 'Open audio file';

  let harmonics = new Float32Array(20);
  harmonics[4] = -0.3;
  harmonics[6] = -0.6;
  harmonics[12] = 0.7;
  harmonics[14] = 0.2;
  let dm_sum = sum_harmonics(harmonics, dm_images);
  draw_drum_mode(dm_sum, dhs_canvas);

  fft_canvas.onclick = async () => {
    let sample_rate = 48000;
    let num_frames = 256;
    let frame_size = 1024;
    let base_freq_hz = 110;
    let num_freqs = 12;

    let file = await utils.selectAudioFile();
    if (!file) return;
    fft_canvas.title = file.name;
    console.log('Decoding audio file...');
    let signal = await utils.decodeAudioFile(file, sample_rate);
    let spectrogram = utils.computeSpectrogram(signal, num_frames, frame_size);
    utils.drawSpectrogram(fft_canvas, spectrogram);
    console.log('Spectrogram ready');
    console.log('Use up/down arrow keys');

    let avg_spectrum = utils.getAvgSpectrum(spectrogram);
    let avg_spectrum_max = avg_spectrum.reduce((s, x) => Math.max(s, x), 0);
    let avg_spectrum_sum = avg_spectrum.reduce((s, x) => s + x, 0);

    dhs_canvas.getContext('2d').clearRect(0, 0, dhs_canvas.width, dhs_canvas.height);
    for (let nf = 0; nf < num_freqs; nf++) {
      drawSumHarmonics(nf, 25.0);
      await utils.sleep(0);
    }

    function drawSumHarmonics(nf, brightness = 1.0) {
      let ts0 = Date.now();
      let freq_hz = base_freq_hz * 2 ** (nf / num_freqs);
      let base_freq_id = freq_hz / sample_rate * frame_size;
      let harmonics = new Float32Array(20);
      let freq_id_max = frame_size / 2 - 1; // fft is symmetric
      let band_width = base_freq_id / num_freqs;

      for (let k = 0; k < harmonics.length; k++) {
        let f_min = (k + 1) * (base_freq_id - band_width / 2);
        let f_max = (k + 1) * (base_freq_id + band_width / 2);
        if (f_min >= freq_id_max) break;

        for (let f = f_min; f < f_max; f++) {
          let f_int = Math.round(f);
          if (f_int >= freq_id_max) break;
          harmonics[k] = avg_spectrum[f_int] / avg_spectrum_sum * band_width;
        }
      }

      let dm_sum = sum_harmonics(harmonics, dm_images, brightness);
      let phase = nf / num_freqs;
      let cos2 = (x) => Math.cos(x * 2 * PI) * 0.5 + 0.5;
      let rr = cos2(phase + 0);
      let gg = cos2(phase + 1 / 3);
      let bb = cos2(phase + 2 / 3);
      draw_drum_mode(dm_sum, dhs_canvas, [rr, gg, bb]);

      let h_sum = harmonics.reduce((s, x) => s + x, 0);
      console.log('base freq:', freq_hz.toFixed(1), 'Hz, sum:',
        (h_sum / avg_spectrum_sum * 100).toFixed(1) + '%',
        Date.now() - ts0, 'ms');
    }
  };
};
