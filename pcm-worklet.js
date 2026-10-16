// Nimmt das Mikrofon-Signal als PCM ab und gibt es in Blöcken an die Seite weiter.
// Läuft nur im Arbeitsspeicher; hier wird nichts gespeichert oder gesendet.
const BLOCK = 4096;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BLOCK);
    this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === "flush") {
        // Rest abgeben und Abschluss melden (Nachrichten kommen in Reihenfolge an)
        if (this.n) { const out = this.buf.slice(0, this.n); this.port.postMessage(out, [out.buffer]); this.n = 0; }
        this.port.postMessage("flushed");
      }
    };
  }

  process(inputs) {
    const inp = inputs[0];
    if (inp && inp.length) {
      const ch0 = inp[0], nch = inp.length;
      for (let i = 0; i < ch0.length; i++) {
        let v = ch0[i];
        if (nch > 1) { for (let c = 1; c < nch; c++) v += inp[c][i]; v /= nch; }
        this.buf[this.n++] = v;
        if (this.n === BLOCK) {
          const out = this.buf;
          this.port.postMessage(out, [out.buffer]);
          this.buf = new Float32Array(BLOCK);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCapture);
