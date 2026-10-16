// Reine Hilfsfunktionen (ohne Browser-Zugriff, damit sie getestet werden können)

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export function dateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function timeStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${dateStamp(d)}_${p(d.getHours())}${p(d.getMinutes())}`;
}

// Mehrere Kanäle zu einem Mono-Signal mitteln
export function mixToMono(channels) {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) out[i] += ch[i];
  for (let i = 0; i < n; i++) out[i] /= channels.length;
  return out;
}

// Sucht nahe 'target' (innerhalb der letzten 'lookSec' Sekunden davor) die leiseste Stelle,
// damit ein Abschnitt möglichst in einer Sprechpause endet.
export function findCutPoint(samples, target, sr, lookSec = 10, frameSec = 0.25) {
  const frame = Math.floor(frameSec * sr);
  const from = Math.max(0, target - Math.floor(lookSec * sr));
  let best = target;
  let bestE = Infinity;
  for (let pos = from; pos + frame <= target; pos += Math.floor(frame / 2)) {
    let e = 0;
    for (let i = pos; i < pos + frame; i++) e += samples[i] * samples[i];
    if (e < bestE) {
      bestE = e;
      best = pos + Math.floor(frame / 2);
    }
  }
  return best;
}

// Teilt das Signal in Abschnitte (Standard ca. 5 Minuten), die lückenlos aneinander anschließen.
export function splitSegments(samples, sr, maxSec = 300) {
  const max = Math.floor(maxSec * sr);
  const parts = [];
  let start = 0;
  while (start < samples.length) {
    let end = start + max;
    if (end >= samples.length) {
      end = samples.length;
    } else {
      end = findCutPoint(samples, end, sr);
      if (end <= start) end = start + max;
    }
    parts.push([start, end]);
    start = end;
  }
  return parts;
}

// Baut das interne Volltranskript als Word-Dokument.
// docxLib: das 'docx'-Modul (im Browser window.docx, im Test das npm-Paket)
export function buildTranscriptDoc(docxLib, meta, segs) {
  const { Document, Paragraph, TextRun, Header, Footer, AlignmentType, PageNumber, HeadingLevel } = docxLib;
  const FONT = "Arial";
  const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: 22, ...opts });

  const children = [];
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      spacing: { after: 120 },
      children: [run("Volltranskript", { bold: true, size: 36 })],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [run("Nur zur internen Verwendung. Nicht Bestandteil der Niederschrift.", { italics: true, color: "B00020" })],
    })
  );

  const metaLines = [
    ["Titel", meta.title],
    ["Datum", meta.date],
    ["Teilnehmende", meta.participants],
    ["Aufnahmedauer", meta.duration],
    ["Erkennungsmodell", meta.model],
  ];
  for (const [k, v] of metaLines) {
    if (!v) continue;
    children.push(new Paragraph({ spacing: { after: 60 }, children: [run(`${k}: `, { bold: true }), run(String(v))] }));
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { before: 360, after: 160 },
      children: [run("Transkript", { bold: true, size: 28 })],
    })
  );

  const rows = segs.filter((s) => s.text && s.text.trim());
  if (rows.length === 0) {
    children.push(new Paragraph({ children: [run("(kein Text erkannt)")] }));
  }
  for (const s of rows) {
    if (s.kind === "pause") {
      children.push(new Paragraph({ spacing: { after: 100 }, children: [run(s.text.trim(), { italics: true, color: "555555" })] }));
      continue;
    }
    children.push(
      new Paragraph({
        spacing: { after: 100 },
        children: [run(`[${fmtTime(s.start)}] `, { bold: true, color: "555555" }), run(s.text.trim())],
      })
    );
  }

  return new Document({
    creator: "Protokoll-Assistent",
    title: "Volltranskript (intern)",
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [run("-"), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 22 }), run("-")],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [run("Intern – Volltranskript", { size: 18, color: "777777" })] })],
          }),
        },
        children,
      },
    ],
  });
}

// ---------- Live-Erkennung: Stücke, Zeitachse, Filter (rein, ohne Browser testbar) ----------

// Länge der Stücke für die Live-Erkennung. Geschnitten wird an der leisesten Stelle zwischen MIN und MAX.
export const CHUNK_MIN_SEC = 30;
export const CHUNK_MAX_SEC = 60;

// Nimmt fortlaufend PCM-Daten an und gibt fertige Stücke zurück, lückenlos und ohne Überlappung.
// start = Position des ersten Samples in der Aufnahme (ohne Pausen gezählt).
export class Chunker {
  constructor(sr, { minSec = CHUNK_MIN_SEC, maxSec = CHUNK_MAX_SEC } = {}) {
    this.sr = sr;
    this.min = Math.floor(minSec * sr);
    this.max = Math.floor(maxSec * sr);
    this.buf = new Float32Array(this.max);
    this.len = 0;
    this.offset = 0;
  }
  get recordedSamples() { return this.offset + this.len; }
  get bufferedSamples() { return this.len; }
  push(data) {
    const out = [];
    let i = 0;
    while (i < data.length) {
      const n = Math.min(this.max - this.len, data.length - i);
      this.buf.set(data.subarray(i, i + n), this.len);
      this.len += n; i += n;
      if (this.len === this.max) out.push(this._cut());
    }
    return out;
  }
  _cut() {
    const cut = chooseCut(this.buf, this.sr, this.min, this.max);
    const chunk = { start: this.offset, samples: this.buf.slice(0, cut) };
    this.buf.copyWithin(0, cut, this.len);
    this.len -= cut; this.offset += cut;
    return chunk;
  }
  // Rest als letztes (kürzeres) Stück abgeben, z. B. bei Pause oder Ende
  flush() {
    if (!this.len) return null;
    const chunk = { start: this.offset, samples: this.buf.slice(0, this.len) };
    this.offset += this.len; this.len = 0;
    return chunk;
  }
}

// Schnittpunkt in buf[0..max): leiseste Stelle zwischen min und max
function chooseCut(buf, sr, min, max) {
  const cut = findCutPoint(buf, max, sr, (max - min) / sr);
  return cut > 0 && cut <= max ? cut : max;
}

// Gleiche Planung für eine ganze Datei: liefert [start, ende]-Paare, ohne die Daten zu kopieren.
export function planChunks(samples, sr, { minSec = CHUNK_MIN_SEC, maxSec = CHUNK_MAX_SEC } = {}) {
  const min = Math.floor(minSec * sr), max = Math.floor(maxSec * sr);
  const out = [];
  let start = 0;
  while (samples.length - start >= max) {
    const cut = chooseCut(samples.subarray(start, start + max), sr, min, max);
    out.push([start, start + cut]);
    start += cut;
  }
  if (start < samples.length) out.push([start, samples.length]);
  return out;
}

// Zeitachse mit Pausen. Eine Pause: { recAt: Aufnahme-Sekunde beim Pausieren, from, to: Sitzungszeit in s }.
// Sitzungszeit = Aufnahmezeit + Dauer aller abgeschlossenen Pausen, die vorher begonnen haben.
export function sessionTime(recSec, pauses) {
  let t = recSec;
  for (const p of pauses) if (p.recAt <= recSec && p.to != null) t += p.to - p.from;
  return t;
}

export function pauseText(p) {
  return `[Pause ${fmtTime(p.from)}–${fmtTime(p.to)}]`;
}

// Stille-Erkennung: Ein Stück gilt als still, wenn weniger als MIN_VOICED_SEC Sprache darin ist.
export const SILENCE_FRAME_SEC = 0.1;   // Länge eines Messfensters
export const SPEECH_FRAME_RMS = 0.008;  // ab dieser Lautstärke (RMS, ca. -42 dBFS) zählt ein Fenster als „Ton“
export const MIN_VOICED_SEC = 0.4;      // so viel „Ton“ muss mindestens im Stück sein

export function analyzeLevel(samples, sr, { frameSec = SILENCE_FRAME_SEC, speechRms = SPEECH_FRAME_RMS, minVoicedSec = MIN_VOICED_SEC } = {}) {
  const frame = Math.max(1, Math.floor(frameSec * sr));
  let voiced = 0, maxRms = 0;
  for (let pos = 0; pos < samples.length; pos += frame) {
    const end = Math.min(samples.length, pos + frame);
    let e = 0;
    for (let i = pos; i < end; i++) e += samples[i] * samples[i];
    const r = Math.sqrt(e / (end - pos));
    if (r > maxRms) maxRms = r;
    if (r >= speechRms) voiced += end - pos;
  }
  const voicedSec = voiced / sr;
  return { silent: voicedSec < minVoicedSec, voicedSec, maxRms };
}

// Bekannte Whisper-„Halluzinationen“ bei Stille (stammen aus Untertiteln im Trainingsmaterial).
// Entfernt werden nur ganze Sätze, die einem Muster komplett entsprechen, und nur am Ende eines Textes.
export const HALLUCINATION_PATTERNS = [
  /untertitel(?:ung)?\s+(?:im auftrag|der amara|aufgrund der amara|von|des|by|durch)\b.*/i,
  /untertitel(?:ung)?\s*:.*/i,
  /(?:vielen\s+)?dank(?:e)?\s+f(?:ü|ue)r(?:s|'s|\s+das|\s+ihr|\s+eure)?\s+zu(?:schauen|sehen|hören)/i,
  /copyright\b.*\b(?:wdr|zdf|swr|ndr|br|ard|mdr|hr|rbb)\b.*/i,
  /©.*\b(?:wdr|zdf|swr|ndr|br|ard|mdr|hr|rbb)\b.*/i,
  /(?:zdf|wdr|swr|ndr|ard|mdr)(?:\s*,\s*\d{4})?/i,
  /(?:abonniert|abonnieren sie|abonniere)\b.*\bkanal\b.*/i,
  /(?:wenn (?:euch|dir|ihnen) )?(?:das|dieses) video gefallen hat.*/i,
  /[[(*♪\s]*musik[\])*♪\s]*/i,
  /[♪♫\s]+/,
];

function isHallucinationSentence(s) {
  const t = s.trim().replace(/[.!?…]+$/, "").trim();
  if (!t) return true;
  return HALLUCINATION_PATTERNS.some((re) => new RegExp(`^(?:${re.source})$`, re.flags).test(t));
}

// Entfernt Halluzinations-Sätze am Textende (bei reinen Halluzinationen bleibt leerer Text).
export function filterHallucinations(text) {
  let rest = String(text || "").trim();
  let hits = 0;
  while (rest) {
    const parts = rest.split(/(?<=[.!?…])\s+/);
    const last = parts[parts.length - 1];
    if (!isHallucinationSentence(last)) break;
    hits++;
    parts.pop();
    rest = parts.join(" ").trim();
  }
  return { text: rest, hits };
}

// Ersatzliste: Paare [falsch, richtig]. Nur ganze Wörter, Groß-/Kleinschreibung wird beachtet.
export function normalizePairs(pairs) {
  const seen = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const from = String(p[0] ?? "").trim(), to = String(p[1] ?? "").trim();
    if (!from || from === to) continue;
    seen.set(from, to);
  }
  return [...seen.entries()];
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function applyReplacements(text, pairs) {
  const list = normalizePairs(pairs).sort((a, b) => b[0].length - a[0].length);
  if (!list.length || !text) return text;
  const map = new Map(list);
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${list.map((p) => escapeRe(p[0])).join("|")})(?![\\p{L}\\p{N}_])`, "gu");
  return text.replace(re, (m) => map.get(m));
}

// Ersatz-Umrechnung der Abtastrate (nur falls der Browser keinen 16-kHz-Audiokontext erlaubt).
// Mittelwert über das jeweilige Eingangsfenster; Zustand bleibt zwischen Aufrufen erhalten.
export function createResampler(inRate, outRate) {
  if (inRate === outRate) return (x) => x;
  const step = inRate / outRate;
  let pos = 0;
  let carry = new Float32Array(0);
  return (input) => {
    let data = input;
    if (carry.length) { data = new Float32Array(carry.length + input.length); data.set(carry); data.set(input, carry.length); }
    const out = new Float32Array(Math.max(0, Math.floor((data.length - pos) / step) + 1));
    let k = 0;
    while (pos + step <= data.length) {
      const a = Math.floor(pos), b = Math.floor(pos + step);
      let v;
      if (b <= a) v = data[a];
      else { let s = 0; for (let i = a; i < b; i++) s += data[i]; v = s / (b - a); }
      out[k++] = v;
      pos += step;
    }
    const keep = Math.floor(pos);
    carry = data.slice(keep);
    pos -= keep;
    return out.subarray(0, k);
  };
}

// Wiederholungsschleifen (Whisper hängt z. B. bei Musik): Ein Wort oder eine Gruppe aus bis zu
// REPEAT_MAX_WORDS Wörtern, die mindestens REPEAT_MIN_COUNT-mal direkt hintereinander steht,
// wird auf ein Vorkommen gekürzt. Satzzeichen und Groß-/Kleinschreibung zählen dabei nicht.
// REPEAT_MIN_COUNT = 6 ist geschätzt: Echte Schleifen sind meist viel länger (gemessen: ca. 160×),
// 5× kommt in normaler Rede gelegentlich vor und soll stehen bleiben.
export const REPEAT_MIN_COUNT = 6;
export const REPEAT_MAX_WORDS = 4;
export const REPEAT_MARK = "[Wiederholung entfernt]";

export function collapseRepeats(text, { minCount = REPEAT_MIN_COUNT, maxWords = REPEAT_MAX_WORDS } = {}) {
  const tokens = String(text || "").split(/\s+/).filter(Boolean);
  const keys = tokens.map((t) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
  const out = [];
  let hits = 0;
  let i = 0;
  while (i < tokens.length) {
    let found = 0, size = 0;
    for (let n = 1; n <= maxWords && !found; n++) {
      if (i + n * minCount > tokens.length) break;
      if (keys.slice(i, i + n).some((k) => !k)) continue;
      let count = 1;
      while (i + (count + 1) * n <= tokens.length && keys.slice(i + count * n, i + (count + 1) * n).every((k, j) => k === keys[i + j])) count++;
      if (count >= minCount) { found = count; size = n; }
    }
    if (found) {
      const first = tokens.slice(i, i + size).join(" ").replace(/[\p{P}\s]+$/u, "");
      out.push(`${first} ${REPEAT_MARK}`);
      hits++;
      i += found * size;
    } else {
      out.push(tokens[i]);
      i++;
    }
  }
  return { text: hits ? out.join(" ") : String(text || "").trim(), hits };
}
