// The barebones no-BS FFT library.
// All the extras go to webfft_ext.

export const assert = (x, m = 'assert() failed') => { if (x) return; debugger; throw new Error(m); };
export const is_pow2 = (n) => (n & (n - 1)) == 0;

// Computes in-place DFT.
export function fft_1d(a, n = a.length / 2, sign = +1) {
  assert(n * 2 == a.length);
  assert(is_pow2(n));

  fft_bit_reversal(a, n);
  for (let s = 2; s <= n; s *= 2)
    fft_update(a, n, s, sign);
}

export function fft_1d_inverse(a) {
  let n = a.length / 2;
  fft_1d(a, n, -1);
  for (let i = 0; i < n * 2; i++)
    a[i] /= n;
}

function fft_update(a, n, s, sign) {
  let phi = sign * 2 * Math.PI / s; // -phi for inverse FFT
  let e0 = Math.cos(phi), e1 = Math.sin(phi);

  // updates a[0..s-1], a[s..2s-1], ...
  for (let i = 0; i < n; i += s) {
    let w0 = 1, w1 = 0; // w = exp(2*PI*i/s)^j

    // updates a[i..i+s-1]
    for (let j = 0; j < s / 2; j++) {
      let u = i + j, v = i + j + s / 2;
      let u0 = a[u * 2], u1 = a[u * 2 + 1];
      let v0 = a[v * 2], v1 = a[v * 2 + 1];

      let vw0 = v0 * w0 + v1 * w1;
      let vw1 = v1 * w0 - v0 * w1;

      a[u * 2 + 0] = u0 + vw0;
      a[u * 2 + 1] = u1 + vw1;

      a[v * 2 + 0] = u0 - vw0;
      a[v * 2 + 1] = u1 - vw1;

      let we0 = w0 * e0 - w1 * e1;
      let we1 = w0 * e1 + w1 * e0;
      w0 = we0, w1 = we1;
    }
  }
}

// https://graphics.stanford.edu/~seander/bithacks.html#BitReverseObvious
function fft_bit_reversal(a, n) {
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1;
    while (j >= b)
      j -= b, b >>= 1;
    j += b;
    if (i < j)
      swap(a, i, j);
  }
}

function swap(a, i, j) {
  let x0 = a[2 * i];
  let x1 = a[2 * i + 1];
  a[2 * i + 0] = a[2 * j];
  a[2 * i + 1] = a[2 * j + 1];
  a[2 * j + 0] = x0;
  a[2 * j + 1] = x1;
}
