import { conjugate, fft_rows, mul_const } from './lib/webfft_ext.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const assert = (x, m = 'assert() failed') => { if (!x) { debugger; throw new Error(m); } };

// messages from the UI thread
self.onmessage = (e) => {
  let { txid, ch, ts, fn, args } = e.data;
  let res = null;

  console.debug('Message from main thread', ch, fn, 'ts diff', Date.now() - ts, 'ms');
  ts = Date.now();

  if (fn == applyFFT.name)
    res = applyFFT(...args);

  if (fn == mapTextureToRGBA.name)
    res = mapTextureToRGBA(...args);

  console.debug(ch, fn, 'time:', Date.now() - ts, 'ms');
  ts = Date.now();
  self.postMessage({ txid, ts, ch, fn, res }, [res.buffer]);
};

function mapTextureToRGBA(res, tex, max, scale, contrast) {
  assert(tex.length == 2 * res.length);

  for (let i = 0; i < res.length; i++) {
    let re = tex[i * 2], im = tex[i * 2 + 1];
    let abs2 = re * re + im * im;
    if (contrast != 1.0)
      abs2 = Math.pow(abs2, contrast);
    res[i] = max * clamp(scale * abs2, 0, 1);
  }

  return res;
}

function applyFFT(tex, [h, w]) {
  assert(tex.length == h * w * 2);
  fft_rows(tex, h, w);
  mul_const(tex, 1.0 / Math.sqrt(w)); // unitary DFT
  return tex;
}


