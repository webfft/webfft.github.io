Fast spectrogram analyzer. Works on mobile.

### How it works

- Mic capture: getUserMedia + AudioWorkletNode, lossless, up to 48 kHz, although you may try higher sample rates.
- Audio decoding: AudioContext, up to 384 kHz.
- Spectrogram: standard FFT optimized for real-only signals, basic JS, no WebWorkers.

### Ultrasound

Dodotronic UM250K captures up to 125 kHz audio frequencies.

getUserMedia doesn't support high sample rates, but you can use ffmpeg to record a 250 kHz wav file:

```
arecord -L
ffmpeg -f alsa -channels 1 -sample_rate 250000 -i hw:CARD=r4,DEV=0 -t 5 mic.wav
```
### Wavelets

Wavelets and chirplets aren't supported yet.
