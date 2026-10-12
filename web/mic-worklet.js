// Procesador de audio del micrófono: lo baja a PCM de 16 kHz, 16 bits, mono (little-endian)
// y lo entrega en tramas de 20 ms. Es el formato que espera el servidor para el dictado.
//
// Es un archivo aparte y sin importaciones porque los AudioWorklet se cargan por su cuenta
// (en Firefox también). La reducción promedia ventanas de muestras (un filtro simple, de
// sobra para voz); no depende de que el navegador acepte un AudioContext a 16 kHz.

const TARGET_RATE = 16000;
const FRAME = 320; // muestras: 20 ms a 16 kHz

class Pcm16kProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.step = sampleRate / TARGET_RATE; // muestras de entrada por muestra de salida
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(FRAME);
    this.filled = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const length = channels[0].length;
    for (let i = 0; i < length; i++) {
      let x = 0;
      for (const ch of channels) x += ch[i];
      this.sum += x / channels.length; // más de un canal: se mezclan
      this.count++;
      this.phase++;
      if (this.phase < this.step) continue;
      this.phase -= this.step;
      const v = Math.max(-1, Math.min(1, this.sum / this.count));
      this.sum = 0;
      this.count = 0;
      this.frame[this.filled++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.filled === FRAME) {
        this.port.postMessage(this.frame.buffer, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm16k", Pcm16kProcessor);
