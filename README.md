A simple, but fast [webfft.js](lib/webfft.js) library based on the Cooley-Tukey DIF algorithm. Demo: [webfft.net](https://webfft.net).

There is a basic UI that works with a 3-channel 1024×1024 float32 texture. The UI doesn't have a button to compute 2D FFT, but it provides a set of simpler transforms that can be chained together to make 2D FFT:

  1. Apply the per-row FFT.
  2. Transpose the texture.
  3. Apply the per-row FFT again.
  4. Transpose the texture again.

Inverse FFT can be done this way:

  1. Conjugate: (re, im) -> (re, -im).
  2. FFT.
  3. Conjugate again.

The texture can be saved as:

  - PNG in the RGB×int16 format
  - EXR in the RGB×float32 format

Heavy operations run on 3 background threads, one per texture channel.

### Images

![](img/scr/10.jpg)

![](img/scr/11.jpg)

![](img/scr/15.jpg)

### Audio

48 kHz audio is first loaded into an array of samples and then recasted into the 2048×1024 texture. Each row in the texture becomes a 20ms audio frame. Then per-row FFT can be applied.

![](img/scr/12.jpg)

![](img/scr/13.jpg)

![](img/scr/14.jpg)

### License

Public Domain
