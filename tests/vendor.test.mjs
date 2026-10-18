// Prüft die eigenen Kopien der Bibliotheken (vendor/) und dass index.html nichts mehr von cdn.jsdelivr.net lädt.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";

const root = new URL("../", import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root));
const readme = read("vendor/README.md").toString("utf8");
const rows = [...readme.matchAll(/^\| `([^`]+)` \| [^|]+ \| (\d+) \| `([0-9a-f]{40})` \| `([0-9a-f]{64})` \|$/gm)]
  .map((m) => ({ file: m[1], bytes: Number(m[2]), sha1: m[3], sha256: m[4] }));

test("vendor/README.md listet alle Dateien in vendor/", () => {
  const onDisk = fs.readdirSync(new URL("vendor/", root), { recursive: true })
    .filter((f) => fs.statSync(new URL("vendor/" + f, root)).isFile() && !f.endsWith("README.md")).sort();
  assert.deepEqual(rows.map((r) => r.file).sort(), onDisk);
  assert.equal(rows.length, 6);
});

test("Prüfsummen und Größen stimmen mit vendor/README.md überein", () => {
  for (const r of rows) {
    const buf = read("vendor/" + r.file);
    assert.equal(buf.length, r.bytes, r.file);
    assert.equal(crypto.createHash("sha1").update(buf).digest("hex"), r.sha1, r.file);
    assert.equal(crypto.createHash("sha256").update(buf).digest("hex"), r.sha256, r.file);
  }
});

test("onnxruntime-Version passt zu dem, was transformers.min.js verlangt", () => {
  const tf = read("vendor/transformers-4.3.1/transformers.min.js").toString("utf8");
  assert.ok(tf.includes('"1.31.0-dev.20260914-8d85527a0"'), "versions.web in transformers.min.js");
  assert.ok(tf.includes("https://cdn.jsdelivr.net/npm/onnxruntime-web@${"), "Standardpfad, den index.html umbiegt");
  assert.ok(readme.includes("onnxruntime-web@1.31.0-dev.20260914-8d85527a0"));
});

test("index.html lädt nichts mehr von cdn.jsdelivr.net (außer Kommentaren)", () => {
  const html = read("index.html").toString("utf8");
  const code = html.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.ok(!/jsdelivr/i.test(code), "kein jsdelivr in Code oder Text");
  assert.ok(code.includes('<script src="./vendor/docx-9.11.0/index.iife.js"'));
  assert.ok(code.includes('const VENDOR_TF_DIR = "./vendor/transformers-4.3.1/";'));
  assert.ok(code.includes("useLocalOnnxRuntime(state.tf.env);"));
});

test("Service Worker: v4, kleine Vendor-Dateien in SHELL, wasm nicht", () => {
  const sw = read("sw.js").toString("utf8");
  assert.ok(sw.includes('const VERSION = "protokoll-v4";'));
  assert.ok(sw.includes('"./niederschrift-ui.js"'), "Niederschrift-Oberfläche offline verfügbar");
  const shell = sw.slice(sw.indexOf("const SHELL"), sw.indexOf("];", sw.indexOf("const SHELL")));
  assert.ok(shell.includes("./vendor/docx-9.11.0/index.iife.js"));
  assert.ok(shell.includes("./vendor/transformers-4.3.1/transformers.min.js"));
  assert.ok(!/\.wasm|\.mjs/.test(shell), "große onnxruntime-Dateien erst beim ersten Gebrauch");
});
