import { assert, swap2, fft_1d, fft_1d_inverse, is_pow2 } from './webfft.js';

// Computes complex-valued DFT in-place.
export function fft_2d(a, n) {
  // Square only: transposing in-place a NxM matrix is a hard problem:
  // https://en.wikipedia.org/wiki/In-place_matrix_transposition
  assert(a.length == n * n * 2);
  assert(is_pow2(n));
  fft_rows(a, n, n);
  transpose(a, n);
  fft_rows(a, n, n);
  transpose(a, n);
}

export function fft_2d_inverse(a, n) {
  conjugate(a);
  fft_2d(a, n);
  conjugate(a);
  mul_const(a, 1 / n ** 2);
}

export function conjugate(a) {
  assert(a.length % 2 == 0);
  for (let i = 1; i < a.length; i += 2)
    a[i] *= -1;
}

export function fft_rows(a, rows, cols) {
  assert(a.length == 2 * rows * cols);
  for (let i = 0; i < rows; i++)
    fft_1d(a.subarray(i * cols * 2, (i + 1) * cols * 2));
}

function transpose(a, n) {
  assert(a.length == 2 * n * n);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < i; j++)
      swap2(a, i * n + j, j * n + i);
}

// b = conv(a, b), len(a) = len(b) = 2**p
function conv_1d(a, b) {
  let n = a.length / 2;
  let m = b.length / 2;
  assert(m == n);
  fft_1d(a);
  fft_1d(b);
  mul2(b, a);
  fft_1d_inverse(b);
}

// https://en.wikipedia.org/wiki/Chirp_Z-transform#Bluestein.27s_algorithm
// https://www.nayuki.io/res/free-small-fft-in-multiple-languages/fft.py
// Arbitrary size DFT: b = fft(a), len(b) != len(a) != 2**p
// Cost: 6 x fft_1d
export function bluestein_fft_1d(a, b, dir = +1) {
  let n = a.length / 2, m = b.length / 2;
  assert(n % 1 == 0 && m % 1 == 0);
  let nm = Math.max(n, m);
  let k = 2 ** Math.ceil(Math.log2(2 * nm - 1));
  let aa = new Float32Array(k * 2);
  let bb = new Float32Array(k * 2);
  let chirp = new Float32Array(k * 2);

  chirp_init(chirp, k, m);
  if (dir < 0) conjugate(chirp);

  aa.set(a);
  mul2(aa.subarray(0, 2 * n), chirp);

  bb.set(chirp.subarray(0, 2 * nm));
  for (let i = 0; i < nm; i++) {
    bb[(k - i) * 2 + 0] = bb[i * 2 + 0];
    bb[(k - i) * 2 + 1] = bb[i * 2 + 1];
  }

  conjugate(bb);
  conv_1d(aa, bb); // b2 = conv(a2, b2)
  b.set(bb.subarray(0, m * 2));
  mul2(b, chirp);
}

export function bluestein_fft_1d_inverse(a, b) {
  bluestein_fft_1d(a, b, -1);
  mul_const(b, 2 / b.length);
}

// z[m] = exp(-i*PI/M*m^2)
function chirp_init(z, k, M) {
  assert(z.length == k * 2);

  // Simpler, but cos/sin are too slow:
  // for (let m = 0; m < k; m++) {
  //   let phi = -Math.PI / M * m * m;
  //   z[2 * m + 0] = Math.cos(phi);
  //   z[2 * m + 1] = Math.sin(phi);
  // }

  // z[0] = 1, z[1] = exp(-i*PI/M)
  // u[m] = z[m]/z[m-1] = exp(-i*PI/M*(2m-1))
  // u[0] = z[1]*, u[1] = z[1]
  // u[m]/u[m-1] = exp(-i*PI/M*2) = z[1]^2 = v

  let e0 = Math.cos(-Math.PI / M);
  let e1 = Math.sin(-Math.PI / M);

  if (k <= 2) {
    z[0] = 1, z[1] = 0;
    if (k == 2)
      z[2] = e0, z[3] = e1;
    return;
  }

  let v0 = Math.cos(-2 * Math.PI / M);
  let v1 = Math.sin(-2 * Math.PI / M);

  z[0] = e0, z[1] = -e1;

  for (let m = 1; m < k; m++) {
    let z0 = z[2 * m - 2];
    let z1 = z[2 * m - 1];
    z[2 * m + 0] = z0 * v0 - z1 * v1;
    z[2 * m + 1] = z0 * v1 + z1 * v0;
    // prevent accumulation of rounding errors
    if (m % 64 == 0) {
      let phi = -Math.PI / M * (2 * m - 1);
      z[2 * m + 0] = Math.cos(phi);
      z[2 * m + 1] = Math.sin(phi);
    }
  }

  // at this point z[m] = u[m] = z1^(2m-1)

  z[0] = 1, z[1] = 0;

  for (let m = 1; m < k; m++) {
    let u0 = z[2 * m - 2];
    let u1 = z[2 * m - 1];
    let z0 = z[2 * m + 0];
    let z1 = z[2 * m + 1];
    z[m * 2 + 0] = z0 * u0 - z1 * u1;
    z[m * 2 + 1] = z0 * u1 + z1 * u0;
    // prevent accumulation of rounding errors
    if (m % 64 == 0) {
      let phi = -Math.PI / M * m * m;
      z[2 * m + 0] = Math.cos(phi);
      z[2 * m + 1] = Math.sin(phi);
    }
  }
}

export function mul_const(a, c) {
  for (let i = 0; i < a.length; i++)
    a[i] *= c;
}

export function mul_const2(a, [re, im]) {
  assert(a.length % 2 == 0);
  for (let i = 0; i < a.length / 2; i++) {
    let p = a[2 * i + 0];
    let q = a[2 * i + 1];
    a[2 * i + 0] = p * re - q * im;
    a[2 * i + 1] = p * im + q * re;
  }
}

// a[0..n-1] = a[0..n-1] * b[0..n-1]
function mul2(a, b, n = Math.min(a.length, b.length) / 2) {
  for (let i = 0; i < n; i++) {
    let p0 = b[i * 2];
    let p1 = b[i * 2 + 1];
    let q0 = a[i * 2];
    let q1 = a[i * 2 + 1];
    a[i * 2 + 0] = p0 * q0 - p1 * q1;
    a[i * 2 + 1] = p0 * q1 + p1 * q0;
  }
}
