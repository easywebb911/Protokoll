// Tests der reinen Hilfsfunktionen. Start: node --test tests/
// Alle Testsignale sind künstlich erzeugt (Töne, Rauschen, Stille), keine echten Aufnahmen.
import test from "node:test";
import assert from "node:assert/strict";
import {
  Chunker, planChunks, sessionTime, pauseText, analyzeLevel, filterHallucinations,
  normalizePairs, applyReplacements, createResampler, CHUNK_MIN_SEC, CHUNK_MAX_SEC,
  collapseRepeats, REPEAT_MIN_COUNT, REPEAT_MAX_WORDS, pauseText as pauseLine,
} from "../helpers.js";

const SR = 16000;

// Reproduzierbares Pseudo-Rauschen (kein Math.random)
function lcg(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32 * 2 - 1; };
}

// „Sprache“ = Ton 220 Hz mit Amplitude 0.2 plus Rauschen; Stille = exakt 0
function speechSignal(totalSec, silences) {
  const x = new Float32Array(totalSec * SR);
  const rnd = lcg(7);
  for (let i = 0; i < x.length; i++) x[i] = 0.2 * Math.sin(2 * Math.PI * 220 * i / SR) + 0.02 * rnd();
  for (const [a, b] of silences) x.fill(0, a * SR, b * SR);
  return x;
}

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function pushInBlocks(chunker, x, sizes) {
  const out = [];
  let i = 0, k = 0;
  while (i < x.length) {
    const n = Math.min(sizes[k++ % sizes.length], x.length - i);
    out.push(...chunker.push(x.subarray(i, i + n)));
    i += n;
  }
  return out;
}

const SIL = [[41, 42], [95, 96], [150, 151]];
// Vorher festgelegt: Raster 2000 Samples, Fenster 4000 → Mitte des ersten ganz stillen Fensters
const EXPECTED = [[0, 658000], [658000, 1522000], [1522000, 2402000], [2402000, 2880000]];

test("Konstanten wie gefordert (30–60 s)", () => {
  assert.equal(CHUNK_MIN_SEC, 30);
  assert.equal(CHUNK_MAX_SEC, 60);
});

test("Datei-Planung schneidet in der Stille (erwartete Werte)", () => {
  const x = speechSignal(180, SIL);
  assert.deepEqual(planChunks(x, SR), EXPECTED);
});

test("Live-Stückelung = Datei-Planung, lückenlos, bei beliebigen Blockgrößen", () => {
  const x = speechSignal(180, SIL);
  for (const sizes of [[128], [4096], [1000, 37, 9999, 128, 4096], [x.length]]) {
    const c = new Chunker(SR);
    const chunks = pushInBlocks(c, x, sizes);
    const last = c.flush();
    if (last) chunks.push(last);
    assert.deepEqual(chunks.map((ch) => [ch.start, ch.start + ch.samples.length]), EXPECTED, `Blockgrößen ${sizes.join(",")}`);
    assert.deepEqual(concat(chunks.map((ch) => ch.samples)), x, "zusammengesetzt = Original");
  }
});

test("Ohne Stille: Schnitt spätestens nach 60 s, frühestens nach 30 s", () => {
  const x = speechSignal(200, []);
  const r = planChunks(x, SR);
  for (const [a, b] of r.slice(0, -1)) {
    assert.ok(b - a >= 30 * SR && b - a <= 60 * SR, `${(b - a) / SR} s`);
  }
  assert.equal(r[0][0], 0);
  for (let i = 1; i < r.length; i++) assert.equal(r[i][0], r[i - 1][1], "keine Lücke");
  assert.equal(r.at(-1)[1], x.length);
});

test("Kurze und leere Eingaben", () => {
  assert.deepEqual(planChunks(new Float32Array(0), SR), []);
  assert.deepEqual(planChunks(new Float32Array(5), SR), [[0, 5]]);
  const c = new Chunker(SR);
  assert.equal(c.flush(), null);
  assert.deepEqual(c.push(new Float32Array(0)), []);
  assert.equal(c.flush(), null);
});

test("Pausen: Stücke werden an der Pause abgeschlossen, Zeitachse läuft durch", () => {
  // Ablauf wie auf der Seite: 70 s Ton, Pause (40 s), 20 s Ton, Pause (15 s), 100 s Ton, Ende
  const parts = [speechSignal(70, []), speechSignal(20, []), speechSignal(100, [[50, 51]])];
  const pauses = [];
  const c = new Chunker(SR);
  const chunks = [];
  const take = (arr) => { for (const ch of arr) chunks.push({ ...ch, session: sessionTime(ch.start / SR, pauses) }); };
  const pauseFor = (dur) => {
    const f = c.flush(); if (f) take([f]);
    const recAt = c.recordedSamples / SR;
    const p = { recAt, from: sessionTime(recAt, pauses), to: null };
    pauses.push(p);
    p.to = p.from + dur;
  };
  take(pushInBlocks(c, parts[0], [4096]));
  pauseFor(40);
  take(pushInBlocks(c, parts[1], [4096]));
  pauseFor(15);
  take(pushInBlocks(c, parts[2], [4096]));
  const f = c.flush(); if (f) take([f]);

  assert.deepEqual(concat(chunks.map((ch) => ch.samples)), concat(parts), "lückenlos");
  assert.deepEqual(pauses.map(pauseText), ["[Pause 00:01:10–00:01:50]", "[Pause 00:02:10–00:02:25]"]);
  // Erstes Stück nach Pause 1 beginnt bei 70 s Aufnahme = 110 s Sitzung
  const after1 = chunks.find((ch) => ch.start === 70 * SR);
  assert.equal(after1.session, 110);
  const after2 = chunks.find((ch) => ch.start === 90 * SR);
  assert.equal(after2.session, 145);
  for (const ch of chunks) assert.ok(ch.samples.length <= 60 * SR);
});

test("Pause am Anfang", () => {
  const pauses = [{ recAt: 0, from: 0, to: 30 }];
  assert.equal(pauseText(pauses[0]), "[Pause 00:00:00–00:00:30]");
  assert.equal(sessionTime(0, pauses), 30);
  assert.equal(sessionTime(12.5, pauses), 42.5);
});

test("Mehrere Pausen", () => {
  const pauses = [{ recAt: 100, from: 100, to: 160 }, { recAt: 250, from: 310, to: 400 }];
  assert.deepEqual([50, 100, 200, 250, 300].map((t) => sessionTime(t, pauses)), [50, 160, 260, 400, 450]);
});

test("Ende während Pause: offene Pause zählt erst, wenn sie abgeschlossen ist", () => {
  const pauses = [{ recAt: 100, from: 100, to: 160 }, { recAt: 300, from: 360, to: null }];
  assert.equal(sessionTime(300, pauses), 360);
  pauses[1].to = 380; // Ende gedrückt 20 s nach Beginn der Pause
  assert.equal(pauseText(pauses[1]), "[Pause 00:06:00–00:06:20]");
});

test("Stille-Erkennung", () => {
  const z = new Float32Array(60 * SR);
  assert.equal(analyzeLevel(z, SR).silent, true);
  const rnd = lcg(3);
  const noise = Float32Array.from({ length: 60 * SR }, () => 0.002 * rnd());
  assert.equal(analyzeLevel(noise, SR).silent, true, "leises Rauschen");
  const burst = new Float32Array(60 * SR);
  for (let i = 0; i < 0.3 * SR; i++) burst[10 * SR + i] = 0.1 * Math.sin(i / 5);
  assert.equal(analyzeLevel(burst, SR).silent, true, "0,3 s Ton reicht nicht");
  const word = new Float32Array(60 * SR);
  for (let i = 0; i < 2 * SR; i++) word[20 * SR + i] = 0.1 * Math.sin(i / 5);
  const r = analyzeLevel(word, SR);
  assert.equal(r.silent, false);
  assert.ok(Math.abs(r.voicedSec - 2) < 0.11, `voicedSec ${r.voicedSec}`);
  assert.equal(analyzeLevel(new Float32Array(0), SR).silent, true);
});

test("Halluzinations-Filter", () => {
  const cases = [
    ["Untertitel im Auftrag des ZDF, 2017.", "", 1],
    ["Untertitel der Amara.org-Community", "", 1],
    ["Der Haushalt ist beschlossen. Vielen Dank fürs Zuschauen!", "Der Haushalt ist beschlossen.", 1],
    ["Danke fürs Zuschauen. Untertitel von Stephanie Geiges.", "", 2],
    ["Wir prüfen das. ZDF, 2020", "Wir prüfen das.", 1],
    ["[Musik]", "", 1],
    ["*Musik*", "", 1],
    ["♪ ♪", "", 1],
    ["Vielen Dank.", "Vielen Dank.", 0],
    ["Wir brauchen Untertitel für das Video.", "Wir brauchen Untertitel für das Video.", 0],
    ["Musik ist unser Thema.", "Musik ist unser Thema.", 0],
    ["Vielen Dank fürs Zuschauen. Wir machen weiter.", "Vielen Dank fürs Zuschauen. Wir machen weiter.", 0],
    ["", "", 0],
  ];
  for (const [inp, text, hits] of cases) assert.deepEqual(filterHallucinations(inp), { text, hits }, inp);
});

test("Ersatzliste", () => {
  assert.equal(applyReplacements("Herr Maier und Frau Maierhofer", [["Maier", "Meier"]]), "Herr Meier und Frau Maierhofer");
  assert.equal(applyReplacements("Maier", [["maier", "Meier"]]), "Maier", "Groß-/Kleinschreibung");
  assert.equal(applyReplacements("A-Team B-Team", [["A-Team", "B-Team"], ["B-Team", "C-Team"]]), "B-Team C-Team", "keine Kettenersetzung");
  assert.equal(applyReplacements("Die Schul AG und die Schul", [["Schul", "Schule"], ["Schul AG", "Schul-AG"]]), "Die Schul-AG und die Schule", "längere zuerst");
  assert.equal(applyReplacements("Mullers Muller, Müllerin", [["Muller", "Müller"], ["Müller", "X"]]), "Mullers Müller, Müllerin", "Umlaute als Wortteil");
  assert.equal(applyReplacements("Wir nutzen C++ und (Klammer)", [["C++", "C plus plus"], ["(Klammer)", "[Klammer]"]]), "Wir nutzen C plus plus und [Klammer]");
  assert.equal(applyReplacements("", [["a", "b"]]), "");
  assert.equal(applyReplacements("abc", []), "abc");
  assert.deepEqual(normalizePairs([[" a ", " b "], ["", "x"], ["c", "c"], "kaputt", null, ["a", "z"]]), [["a", "z"]]);
  assert.deepEqual(normalizePairs("kein Array"), []);
});

test("Abtastrate umrechnen (Ersatzweg)", () => {
  const sine = (rate, sec) => Float32Array.from({ length: rate * sec }, (_, i) => Math.sin(2 * Math.PI * 440 * i / rate));
  const x48 = sine(48000, 1);
  const one = createResampler(48000, 16000)(x48);
  assert.equal(one.length, 16000);
  const r = createResampler(48000, 16000);
  const parts = [];
  for (let i = 0, k = 0; i < x48.length; k++) { const n = [128, 1000, 7, 4096][k % 4]; parts.push(r(x48.subarray(i, i + n))); i += n; }
  assert.deepEqual(concat(parts), one, "Blockweise = am Stück");
  let zc = 0;
  for (let i = 1; i < one.length; i++) if ((one[i - 1] < 0) !== (one[i] < 0)) zc++;
  assert.ok(Math.abs(zc - 880) <= 2, `Nulldurchgänge ${zc}`);
  const x44 = sine(44100, 1);
  const o44 = createResampler(44100, 16000)(x44);
  assert.ok(Math.abs(o44.length - 16000) <= 1, `Länge ${o44.length}`);
  const same = createResampler(16000, 16000);
  assert.equal(same(x48), x48);
});

test("2 Stunden live: Speicher begrenzt, lückenlos", () => {
  const c = new Chunker(SR);
  const rnd = lcg(11);
  const block = new Float32Array(4096);
  let total = 0, next = 0, count = 0, maxLen = 0;
  const check = (ch) => { assert.equal(ch.start, next); next = ch.start + ch.samples.length; count++; maxLen = Math.max(maxLen, ch.samples.length); };
  const t0 = performance.now();
  while (total < 2 * 3600 * SR) {
    for (let i = 0; i < block.length; i++) block[i] = (total + i) % (47 * SR) < 2 * SR ? 0 : 0.1 * rnd();
    for (const ch of c.push(block)) check(ch);
    total += block.length;
  }
  const last = c.flush(); if (last) check(last);
  assert.equal(next, total);
  console.log(`  2 h = ${total} Samples (${(total * 4 / 1e6).toFixed(1)} MB als Float32), ${count} Stücke, längstes ${(maxLen / SR).toFixed(1)} s, Puffer ${(c.buf.byteLength / 1e6).toFixed(2)} MB, ${(performance.now() - t0).toFixed(0)} ms`);
});

test("Wiederholungsschleifen: Zeile [00:38:06] (nachgebaut, 959 Zeichen)", () => {
  const loop = "Nimm," + " nimm,".repeat(158) + " nimm.";
  assert.equal(loop.length, 959);
  assert.deepEqual(collapseRepeats(loop), { text: "Nimm [Wiederholung entfernt]", hits: 1 });
});

test("Wiederholungsschleifen: Schwelle und Fälle", () => {
  assert.equal(REPEAT_MIN_COUNT, 6);
  assert.equal(REPEAT_MAX_WORDS, 4);
  const cases = [
    ["Ja, ja, ja, ja.", "Ja, ja, ja, ja.", 0],
    ["Ragebait, Ragebait, Ragebait, Ragebait, Ragebait ist das Jugendwort", "Ragebait, Ragebait, Ragebait, Ragebait, Ragebait ist das Jugendwort", 0],
    ["nein nein nein nein nein nein", "nein [Wiederholung entfernt]", 1],
    ["und so weiter ".repeat(6) + "Ende.", "und so weiter [Wiederholung entfernt] Ende.", 1],
    ["und so weiter und so weiter.", "und so weiter und so weiter.", 0],
    ["Okay! OKAY? okay, Okay. okay; okay", "Okay [Wiederholung entfernt]", 1],
    ["Wir beginnen. Nimm nimm nimm nimm nimm nimm nimm Danach weiter.", "Wir beginnen. Nimm [Wiederholung entfernt] Danach weiter.", 1],
    ["la la la la la la und dann blah, blah, blah, blah, blah, blah, blah.", "la [Wiederholung entfernt] und dann blah [Wiederholung entfernt]", 2],
    ["eins zwei drei vier ".repeat(6).trim(), "eins zwei drei vier [Wiederholung entfernt]", 1],
    ["a b c d e ".repeat(6).trim(), "a b c d e ".repeat(6).trim(), 0],
    ["[Pause 00:01:00–00:02:00]", "[Pause 00:01:00–00:02:00]", 0],
    ["  normaler Satz mit  Leerzeichen  ", "normaler Satz mit  Leerzeichen", 0],
    ["", "", 0],
  ];
  for (const [inp, text, hits] of cases) assert.deepEqual(collapseRepeats(inp), { text, hits }, inp);
  assert.deepEqual(collapseRepeats(null), { text: "", hits: 0 });
  // Mit Schwelle 5 würde der Ragebait-Fall gekürzt (Konflikt, siehe Bericht)
  assert.deepEqual(collapseRepeats("Ragebait, Ragebait, Ragebait, Ragebait, Ragebait ist das Jugendwort", { minCount: 5 }),
    { text: "Ragebait [Wiederholung entfernt] ist das Jugendwort", hits: 1 });
});

test("Wiederholungsschleifen: kein Einfluss auf Pausen-Zeilen und Ersatzliste", () => {
  const p = pauseLine({ from: 60, to: 120 });
  assert.equal(collapseRepeats(p).text, p);
  const t = collapseRepeats("Herr Maier sagt " + "nimm ".repeat(10)).text;
  assert.equal(t, "Herr Maier sagt nimm [Wiederholung entfernt]");
  assert.equal(applyReplacements(t, [["Maier", "Meier"], ["Wiederholung", "X"]]), "Herr Meier sagt nimm [X entfernt]");
});
