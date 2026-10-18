# vendor/ – eigene Kopien der Programm-Bibliotheken

Diese Dateien werden von `index.html` direkt von GitHub Pages geladen, statt von cdn.jsdelivr.net.
Sie sind **unverändert** aus den npm-Paketen kopiert. Die Prüfsumme jedes Pakets (npm `integrity`, SHA-512)
wurde beim Herunterladen mit der Angabe der npm-Registry verglichen.

Die Erkennungsmodelle selbst kommen weiterhin von huggingface.co (nicht hier).

## Dateien

| Datei | Quelle (npm-Paket → Pfad im Paket) | Bytes | SHA1 | SHA256 |
|---|---|---|---|---|
| `docx-9.11.0/index.iife.js` | `docx@9.11.0` → `dist/index.iife.js` | 1363620 | `0a00eee1e2819236906a2d6887d910b95d1f4d46` | `ef9808e338c174a7224f635ae35e6ff619504efbd51c9db0504607e218ff71b8` |
| `transformers-4.3.1/transformers.min.js` | `@huggingface/transformers@4.3.1` → `dist/transformers.min.js` | 586230 | `2495a47c4aecc2b4e71682550517e87bf4e348df` | `8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743` |
| `transformers-4.3.1/ort-wasm-simd-threaded.asyncify.mjs` | `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` → `dist/ort-wasm-simd-threaded.asyncify.mjs` | 53057 | `aa60791ebe802faf957ed75a84a7bb1ef6ec7e87` | `0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611` |
| `transformers-4.3.1/ort-wasm-simd-threaded.asyncify.wasm` | `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` → `dist/ort-wasm-simd-threaded.asyncify.wasm` | 26861777 | `693a2a3cd9fdb3a106926e6cd811200f1b772471` | `49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082` |
| `transformers-4.3.1/ort-wasm-simd-threaded.mjs` | `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` → `dist/ort-wasm-simd-threaded.mjs` | 24381 | `696bcfe35ca6dd1d613f47cc929312e77efbe64f` | `c57ca56328877353a575e51bbca6f18450027d6c9bf2307a2cb2c41363b4de9f` |
| `transformers-4.3.1/ort-wasm-simd-threaded.wasm` | `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` → `dist/ort-wasm-simd-threaded.wasm` | 14264838 | `10fc68bea22e40f2f598f70cbbde763067493234` | `06ba057753da3847e4c24f02d91ab133455b0817c69a44993a9a53a2146df9e3` |

npm-Pakete (Tarball-SHA1 laut Registry):
- `docx@9.11.0`
- `@huggingface/transformers@4.3.1` – SHA1 `907c4dee112d94ad3ec02e22c55007cf2b72ff8a`
- `onnxruntime-web@1.31.0-dev.20260914-8d85527a0`

## Warum genau diese onnxruntime-Dateien?

transformers.js 4.3.1 setzt die Pfade selbst (`dist/transformers.js`, Z. 13470–13484):
`https://cdn.jsdelivr.net/npm/onnxruntime-web@${versions.web}/dist/ort-wasm-simd-threaded${suffix}.{mjs,wasm}`
mit `versions.web = "1.31.0-dev.20260914-8d85527a0"` (Z. 12465, 12471) und
`suffix = ".asyncify"` – außer bei Safari unter Version 26 ohne WebGPU, dann ohne Suffix.
`index.html` ersetzt nach dem Laden nur den Ordner dieser Pfade durch `./vendor/transformers-4.3.1/`;
die Wahl der Variante trifft weiterhin transformers.js. Die onnxruntime-Dateien liegen im selben
Ordner wie `transformers.min.js`, weil einzelne Stellen Pfade relativ zur eigenen Datei auflösen
(`import.meta.url`, Z. 9289, 12297).

## Prüfen

```sh
cd vendor && sha256sum docx-9.11.0/* transformers-4.3.1/*
```
oder `node --test tests/` (vergleicht automatisch mit dieser Tabelle).

## Aktualisieren

1. Neue Versionen wählen. Für transformers die onnxruntime-Version aus dessen `package.json`
   (`dependencies["onnxruntime-web"]`) bzw. aus `versions.web` in `dist/transformers.js` nehmen.
2. Pakete holen und Integrität prüfen, z. B.
   `npm pack docx@<v> @huggingface/transformers@<v> onnxruntime-web@<v>` und die SHA-512 mit
   `npm view <paket>@<v> dist.integrity` vergleichen.
3. Dateien wie oben in **neue** Ordner kopieren (z. B. `transformers-4.4.0/`), alte Ordner löschen.
4. Pfade in `index.html` (docx-Script, `TF_URL`, `VENDOR_TF_DIR`) und in `sw.js` (`SHELL`) anpassen,
   `VERSION` in `sw.js` erhöhen.
5. Diese Tabelle aktualisieren, `node --test tests/` ausführen.
