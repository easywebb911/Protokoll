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
