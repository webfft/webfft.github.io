class MicRecWorklet extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'foo', defaultValue: 0.25, minValue: 0, maxValue: 1 },
    ];
  }

  constructor() {
    super();
    this.chunks = [];
    this.port.onmessage = (e) => this.onmessage(e);
    console.debug('MicRecWorklet created');
  }

  onmessage(e) {
    console.debug(e.data);
    let size = this.chunks.reduce((s, a) => s + a.length, 0);
    let merged = new Float32Array(size);
    let offset = 0;
    for (let chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    this.port.postMessage({ data: merged.buffer, size }, [merged.buffer]);
  }

  process(inputs, outputs, params) {
    let num_inputs = Math.min(inputs.length, outputs.length);

    for (let k = 0; k < num_inputs; k++) {
      let input = inputs[k];
      let output = outputs[k];
      let num_channels = Math.min(input.length, output.length);

      for (let ch = 0; ch < num_channels; ch++) {
        let num_samples = input[ch].length;
        for (let i = 0; i < num_samples; i++)
          output[ch][i] = input[ch][i];
      }

      if (num_channels > 0)
        this.chunks.push(input[0].slice(0));
    }

    return true;
  }
}

registerProcessor('mic-rec', MicRecWorklet);