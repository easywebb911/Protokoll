// Tests der Niederschrift ohne KI: Stichwortsuche, Zitat-Prüfung, TOP-Zuordnung, Satzvorlagen, Word-Datei.
// Alle Beispielsätze sind erfunden.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";
import {
  findCandidates, splitSentences, verifyQuote, assignTops, decisionSentence, dutySentence, buildMinutesDoc,
} from "../helpers.js";

const kinds = (text) => [...new Set(findCandidates([{ start: 0, text }]).candidates.map((c) => c.kind))];

test("Beschluss: Treffer", () => {
  for (const t of [
    "Die Fachschaft beschließt den Haushalt.", "Das wurde so beschlossen.", "Der Beschluss gilt ab heute.",
    "Die Abstimmung ergibt sieben Stimmen.", "Es wurde abgestimmt.",
    "Das ist einstimmig.", "Gegenstimmen? Keine.", "Bei zwei Enthaltungen angenommen.", "Der Antrag ist abgelehnt.",
    "Gut, wir machen das so.", "Die Beschlüsse stehen im Anhang.",
  ]) assert.deepEqual(kinds(t), ["Beschluss"], t);
});

test("Zuständigkeit: Treffer", () => {
  for (const [t, exp] of [
    ["Lisa übernimmt die Einladung.", ["Zuständigkeit"]],
    ["Ich übernehme das.", ["Zuständigkeit"]],
    ["Wir übernehmen die Kasse.", ["Zuständigkeit"]],
    ["Tom kümmert sich um die Getränke.", ["Zuständigkeit"]],
    ["Ich kümmere mich darum.", ["Zuständigkeit"]],
    ["Frau Meier ist zuständig.", ["Zuständigkeit"]],
    ["Das ist deine Aufgabe.", ["Zuständigkeit"]],
    ["Das machen wir bis nächste Woche.", ["Zuständigkeit"]],
    ["Bitte bis zur nächsten Sitzung erledigen.", ["Zuständigkeit"]],
    ["Bitte bis zum 15.12. erledigen.", ["Zuständigkeit", "Termin"]],
  ]) assert.deepEqual(kinds(t), exp, t);
});

test("Termin: Treffer", () => {
  for (const t of ["Wir treffen uns am 12.11. wieder.", "Das Fest ist am 12.11.2026.", "Am 12. November ist Wahl.", "Wir sehen uns nächsten Dienstag.", "Kommenden Freitag geht es los."]) {
    assert.deepEqual(kinds(t), ["Termin"], t);
  }
});

test("Nicht-Treffer", () => {
  for (const t of [
    "Wir haben darüber gesprochen.", "Das kümmert mich nicht.", "Wir übernachten in der Jugendherberge.",
    "Version 2.0 ist fertig.", "Es kostet 1.250 Euro.", "Die Stimmung war gut.", "Ein Abschluss ist geplant.",
    "Am Dienstag war es kalt.", "", "   ",
  ]) assert.deepEqual(kinds(t), [], JSON.stringify(t));
});

test("Grenzfälle: formal Treffer, inhaltlich keine Beschlüsse", () => {
  // Diese Sätze enthalten Stichwörter, sind aber keine Beschlüsse/Aufgaben – deshalb prüft Easy jeden Kandidaten.
  assert.deepEqual(kinds("Ich beschließe das Fenster zu öffnen."), ["Beschluss"]);
  assert.deepEqual(kinds("Ich hätte angenommen, dass es regnet."), ["Beschluss"]);
  assert.deepEqual(kinds("Wer ist dafür eigentlich zuständig?"), ["Zuständigkeit"]);
  assert.deepEqual(kinds("Die Abstimmungsfrage klären wir später."), ["Beschluss"]);
  // Verpasst: abgetrenntes Verb („stimmen … ab“) steht nicht in der Stichwortliste
  assert.deepEqual(kinds("Wir stimmen jetzt ab, wer ist dafür?"), []);
});

test("Satztrennung: nicht nach Zahl+Punkt oder Abkürzung", () => {
  const t = (x) => splitSentences([{ start: 0, text: x }]).map((s) => s.text);
  assert.deepEqual(t("Am 12. November ist Wahl. Danach Feier."), ["Am 12. November ist Wahl.", "Danach Feier."]);
  assert.deepEqual(t("Wir treffen uns am 12.11. um acht. Gut."), ["Wir treffen uns am 12.11. um acht.", "Gut."]);
  assert.deepEqual(t("Das gilt z. B. für Haus A. Fertig!"), ["Das gilt z. B. für Haus A.", "Fertig!"]);
  // Bekannte Grenze: Satzende nach einer Zahl wird nicht erkannt (Ordnungszahl-Regel) – Sätze verschmelzen
  assert.deepEqual(t("Wir sind 3. Fertig!"), ["Wir sind 3. Fertig!"]);
  assert.deepEqual(t("Ja? Nein! Vielleicht… Gut."), ["Ja?", "Nein!", "Vielleicht…", "Gut."]);
});

test("Zitat = Satz davor + Satz + Satz danach, wörtlich im Transkript, mit Zeitmarke", () => {
  const lines = [
    { start: 10, text: "Wir kommen zum Haushalt." },
    { start: 25, text: "Die Fachschaft hat einstimmig beschlossen, 200 Euro auszugeben. Danke dafür." },
    { start: 40, text: "Nächster Punkt." },
  ];
  const { candidates, dropped } = findCandidates(lines);
  assert.equal(dropped, 0);
  assert.equal(candidates.length, 1);
  const c = candidates[0];
  assert.equal(c.kind, "Beschluss");
  assert.equal(c.start, 25);
  assert.equal(c.lineIndex, 1);
  assert.equal(c.sentence, "Die Fachschaft hat einstimmig beschlossen, 200 Euro auszugeben.");
  assert.equal(c.quote, "Wir kommen zum Haushalt. Die Fachschaft hat einstimmig beschlossen, 200 Euro auszugeben. Danke dafür.");
  assert.ok(verifyQuote(c.quote, lines));
  // Erster und letzter Satz: nur ein Nachbar
  const edge = findCandidates([{ start: 0, text: "Beschlossen. Ende." }]).candidates[0];
  assert.equal(edge.quote, "Beschlossen. Ende.");
});

test("Zitat-Prüfung verwirft Fremdtext", () => {
  const lines = [{ start: 0, text: "Der Antrag ist angenommen." }];
  assert.equal(verifyQuote("Der Antrag ist angenommen.", lines), true);
  assert.equal(verifyQuote("Der Antrag ist  angenommen.", lines), true, "Leerräume egal");
  assert.equal(verifyQuote("Der Antrag ist abgelehnt.", lines), false);
  assert.equal(verifyQuote("", lines), false);
});

test("Sätze, Ids und Ergebnis sind deterministisch", () => {
  const lines = [{ start: 1, text: "Ich übernehme das. Beschlossen!" }, { start: 2, text: "am 3.4. treffen" }];
  assert.deepEqual(splitSentences(lines).map((s) => [s.text, s.start, s.lineIndex]), [["Ich übernehme das.", 1, 0], ["Beschlossen!", 1, 0], ["am 3.4. treffen", 2, 1]]);
  assert.deepEqual(findCandidates(lines), findCandidates(lines));
  assert.deepEqual(findCandidates(lines).candidates.map((c) => c.id), ["Zuständigkeit|1|Ich übernehme das.", "Beschluss|1|Beschlossen!", "Termin|2|am 3.4. treffen"]);
});

test("TOP-Zuordnung über Marker", () => {
  assert.deepEqual(assignTops(6, [{ lineIndex: 1, topId: "a" }, { lineIndex: 4, topId: "b" }]), [null, "a", "a", "a", "b", "b"]);
  assert.deepEqual(assignTops(3, []), [null, null, null]);
  assert.deepEqual(assignTops(0, [{ lineIndex: 0, topId: "a" }]), []);
  assert.deepEqual(assignTops(3, [{ lineIndex: 0, topId: "a" }, { lineIndex: 0, topId: "b" }]), ["b", "b", "b"], "letzter Marker je Zeile gilt");
});

test("Satzvorlagen und Anrede", () => {
  assert.equal(decisionSentence("Fachschaft"), "Die Fachschaft beschließt …");
  assert.equal(decisionSentence(""), "Die … beschließt …");
  assert.equal(dutySentence("Frau", "Lisa Meier"), "Frau Lisa Meier übernimmt …");
  assert.equal(dutySentence("Herr", " Tom "), "Herr Tom übernimmt …");
  assert.equal(dutySentence("xyz", ""), "Herr … übernimmt …", "unbekannte Anrede → Herr, Name offen");
});

// ---- Word-Datei: docx aus vendor/ in Node laden und erzeugte Datei entpacken ----
function loadDocx() {
  const code = fs.readFileSync(new URL("../vendor/docx-9.11.0/index.iife.js", import.meta.url), "utf8");
  const ctx = { console, setTimeout, clearTimeout, TextEncoder, TextDecoder, Blob, Uint8Array, ArrayBuffer, Promise, Buffer };
  ctx.globalThis = ctx; ctx.window = ctx; ctx.self = ctx;
  vm.runInNewContext(code + "\n;globalThis.docx = docx;", ctx);
  return ctx.docx;
}
function unzip(buf) {
  const files = {};
  let eocd = buf.length - 22;
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n--;) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nl);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    files[name] = (method === 8 ? zlib.inflateRawSync(raw) : raw).toString("utf8");
    p += 46 + nl + el + cl;
  }
  return files;
}
const textOf = (xml) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
const sample = (approved) => ({
  approved,
  head: { gremium: "Fachschaft", titel: "Sitzung der Fachschaft", datum: "18.10.2026", beginn: "18:00", ende: "19:30", ort: "Raum 1", vorsitz: "Frau Lisa Meier", schriftfuehrer: "Herr Tom Maier", anwesende: "Lisa Meier\nTom Maier", entschuldigt: "" },
  tops: [
    { title: "Begrüßung", summary: "Die Vorsitzende begrüßt alle.", decisions: [], duties: [], dates: [] },
    { title: "Haushalt", summary: "Der Haushalt wird vorgestellt.", decisions: ["Die Fachschaft beschließt 200 Euro für das Fest."], duties: ["Herr Tom Maier übernimmt die Einladung."], dates: ["Fest am 12.11."] },
  ],
  unassigned: { decisions: [], duties: [], dates: [] },
});

test("Word: gültige Datei mit Titel, TOPs, Beschluss, Seitenzahl „-n-“, ENTWURF ohne Freigabe", async () => {
  const docx = loadDocx();
  for (const approved of [false, true]) {
    const blob = await docx.Packer.toBlob(buildMinutesDoc(docx, sample(approved), [["Maier", "Meyer"]]));
    const buf = Buffer.from(await blob.arrayBuffer());
    assert.equal(buf.readUInt32LE(0), 0x04034b50, "Zip-Kopf");
    const files = unzip(buf);
    for (const f of ["[Content_Types].xml", "word/document.xml"]) assert.ok(files[f], f);
    for (const [name, xml] of Object.entries(files)) if (name.endsWith(".xml")) {
      assert.ok(xml.startsWith("<?xml"), name);
      assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(xml), `${name}: keine ungültigen Zeichen`);
    }
    const body = textOf(files["word/document.xml"]);
    for (const t of ["Niederschrift", "Sitzung der Fachschaft", "Tagesordnung", "TOP 1: Begrüßung", "TOP 2: Haushalt", "Die Fachschaft beschließt 200 Euro für das Fest.", "Zuständigkeiten:", "Vorsitz: Frau Lisa Meier", "Schriftführer: Herr Tom Meyer"]) {
      assert.ok(body.includes(t), `${approved}: ${t}`);
    }
    assert.ok(body.includes("Herr Tom Meyer übernimmt die Einladung."), "Ersatzliste angewendet");
    assert.ok(!body.includes("Maier"), "Ersatzliste überall");
    const footer = Object.entries(files).filter(([n]) => /word\/footer\d*\.xml/.test(n)).map(([, x]) => x).join("");
    assert.ok(/PAGE/.test(footer), "Seitenzahl-Feld");
    assert.ok(/<w:t[^>]*>-<\/w:t>/.test(footer), "Bindestriche um die Seitenzahl");
    const header = Object.entries(files).filter(([n]) => /word\/header\d*\.xml/.test(n)).map(([, x]) => textOf(x)).join(" ");
    const draft = "ENTWURF – nicht freigegeben";
    if (approved) { assert.ok(!body.includes(draft) && !header.includes(draft), "freigegeben: kein ENTWURF"); }
    else { assert.ok(body.includes(draft), "ENTWURF im Text"); assert.ok(header.includes(draft), "ENTWURF in der Kopfzeile"); }
  }
});

test("Word: nur übergebene (übernommene) Sätze, „Ohne Zuordnung“ nur wenn nötig", async () => {
  const docx = loadDocx();
  const d = sample(true);
  d.unassigned = { decisions: ["Die Fachschaft beschließt X."], duties: [], dates: [] };
  const files = unzip(Buffer.from(await (await docx.Packer.toBlob(buildMinutesDoc(docx, d))).arrayBuffer()));
  const body = textOf(files["word/document.xml"]);
  assert.ok(body.includes("Ohne Zuordnung zu einem TOP") && body.includes("Die Fachschaft beschließt X."));
  const files2 = unzip(Buffer.from(await (await docx.Packer.toBlob(buildMinutesDoc(docx, sample(true)))).arrayBuffer()));
  assert.ok(!textOf(files2["word/document.xml"]).includes("Ohne Zuordnung"));
});
