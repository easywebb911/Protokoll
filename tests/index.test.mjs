// Prüft Datenschutz-Texte, Einwilligung und Export-Hinweis in index.html (ohne Browser). Start: node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("Einwilligung: Wortlaut, nicht vorbelegt, nicht wiederherstellbar", () => {
  const box = html.match(/<input type="checkbox" id="fConsent"[^>]*>/)[0];
  assert.ok(!/\bchecked\b/.test(box), "Haken darf nicht vorbelegt sein");
  assert.ok(/autocomplete="off"/.test(box), "Browser soll den Haken nicht wiederherstellen");
  assert.ok(html.includes("Alle Anwesenden wissen von der Aufnahme und sind einverstanden."));
});

test("Einwilligung blockiert den Start: Knopf gesperrt und Abbruch im Handler", () => {
  assert.ok(html.includes('$("btnRec").disabled = t || !$("fConsent").checked'));
  assert.match(html, /\$\("btnRec"\)\.onclick = async \(\) => \{\n\s+if \(!\$\("fConsent"\)\.checked/);
});

test("Einwilligung wird nie gespeichert und bei Neustart zurückgesetzt", () => {
  const storageKeys = [...html.matchAll(/localStorage\.(?:setItem|getItem|removeItem)\(([^,)]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(storageKeys)], ["REPL_KEY"], "nur die Ersatzliste in localStorage");
  assert.ok(!/fConsent[^\n]*localStorage|localStorage[^\n]*fConsent/.test(html));
  const reset = html.slice(html.indexOf("function resetAll()"), html.indexOf("// ---------- Weitere Optionen"));
  assert.ok(reset.includes('$("fConsent").checked = false;'));
});

test("Export-Hinweis nach jedem Download", () => {
  assert.ok(html.includes('const EXPORT_HINT = "Datei liegt im Downloads-Ordner. Nach der Freigabe löschen; Audio zuerst.";'));
  const dl = html.slice(html.indexOf("function download("), html.indexOf("function metaInfo("));
  assert.ok(dl.includes('$("exportStatus").textContent'));
  // Word, Text und Audio laufen alle über download()
  for (const [btn, name] of [["btnDocx", "Transkript_intern_"], ["btnTxt", "Transkript_intern_"], ["btnAudio", "Aufnahme_"]]) {
    const h = html.slice(html.indexOf(`$("${btn}").onclick`));
    assert.ok(h.slice(0, 1200).includes(`download(`) && h.slice(0, 1200).includes(name), btn);
  }
});

test("Datenschutz-Box unter „Weitere Optionen“ mit allen Punkten", () => {
  const opt = html.slice(html.indexOf("<summary>Weitere Optionen</summary>"));
  const box = opt.slice(opt.indexOf('<details id="privacyBox"'), opt.indexOf("</details>"));
  for (const t of ["Bleibt auf diesem Gerät", "Geht nach draußen", "Wird gespeichert", "GitHub", "Hugging Face", "IP-Adresse", "nie gesendet", "nur die Ersatzliste"]) {
    assert.ok(box.includes(t), t);
  }
  assert.ok(!/jsdelivr/i.test(box), "jsDelivr wird von dieser Seite nicht mehr genutzt");
});
