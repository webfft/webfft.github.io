class MicRecWorklet extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'channel', defaultValue: 0 },
    ];
  }

  constructor() {
    super();
    this.chunks = [];
    this.port.onmessage = (e) => this.onmessage(e);
  }

  async onmessage(e) {
    let buffers = this.chunks.map((a) => a.buffer);
    this.port.postMessage({ channels: [buffers] }, buffers);
    this.chunks = [];
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