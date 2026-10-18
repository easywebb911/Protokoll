// Niederschrift ohne KI: Kopfdaten, Tagesordnung, TOP-Marker, Stichwort-Kandidaten, Word-Export.
// Alles bleibt im Arbeitsspeicher dieser Seite. Nichts wird gespeichert oder gesendet.
import { findCandidates, assignTops, decisionSentence, dutySentence, buildMinutesDoc, fmtTime, timeStamp } from "./helpers.js";

const KIND_ORDER = ["Beschluss", "Zuständigkeit", "Termin"];

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k);
  return e;
}
const field = (id, label, input) => el("div", {}, el("label", { for: id }, label), input);
const lines = (t) => String(t || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
const deDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso.split("-").reverse().join(".") : String(iso || ""));
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// api: { root, getLines():[{seg,start,text}], getRepl(), getPrefill():{datum,titel,anwesende,start,ende}, getDocx(), download(blob,name), exportHint }
export function initMinutes(api) {
  let m;
  const fresh = () => ({ tops: [], nextTopId: 1, markers: new Map(), cands: [], dropped: 0, searched: false, candState: new Map(), summaries: new Map() });

  // ---------- Grundgerüst ----------
  const inp = (id, type = "text", ph = "") => el("input", { type, id, placeholder: ph, autocomplete: "off" });
  const ta = (id, rows, ph = "") => el("textarea", { id, rows, placeholder: ph });
  const H = {
    gremium: inp("mGremium", "text", "z. B. Fachschaft"), titel: inp("mTitel", "text", "z. B. Sitzung der Fachschaft"),
    datum: inp("mDatum", "date"), beginn: inp("mBeginn", "time"), ende: inp("mEnde", "time"), ort: inp("mOrt"),
    vorsitz: inp("mVorsitz", "text", "z. B. Frau Lisa Meier"), schriftfuehrer: inp("mSchrift", "text", "z. B. Herr Tom Maier"),
    anwesende: ta("mAnw", 4, "je Zeile ein Name"), entschuldigt: ta("mEnt", 2, "je Zeile ein Name (optional)"),
  };
  const topList = el("div", { id: "mTops" });
  const markerBox = el("div", { id: "mMarkers" });
  const candStatus = el("div", { class: "status", id: "mCandStatus" });
  const candBox = el("div", { id: "mCands" });
  const sectBox = el("div", { id: "mSections" });
  const approve = el("input", { type: "checkbox", id: "mApproved", autocomplete: "off" });
  const exportStatus = el("div", { class: "status", id: "mExportStatus", role: "status" });
  const nameList = el("datalist", { id: "mNames" });

  api.root.append(
    el("div", { class: "status" }, "Die Niederschrift enthält nur, was du hier eingibst oder ausdrücklich übernimmst. Nichts wird gespeichert oder gesendet. „Löschen / Neu starten“ leert auch diesen Bereich."),
    el("h3", {}, "1 · Kopfdaten"),
    el("div", { class: "btns" }, el("button", { id: "mPrefill", onclick: prefill }, "Aus Aufnahme übernehmen")),
    el("div", { class: "row" }, field("mGremium", "Gremium", H.gremium), field("mTitel", "Titel", H.titel)),
    el("div", { class: "row" }, field("mDatum", "Datum", H.datum), field("mBeginn", "Beginn", H.beginn), field("mEnde", "Ende", H.ende)),
    el("div", { class: "row" }, field("mOrt", "Ort", H.ort), field("mVorsitz", "Vorsitz", H.vorsitz), field("mSchrift", "Schriftführer", H.schriftfuehrer)),
    el("div", { class: "row" }, field("mAnw", "Anwesende", H.anwesende), field("mEnt", "Entschuldigt", H.entschuldigt)),
    nameList,
    el("h3", {}, "2 · Tagesordnung"),
    topList,
    el("div", { class: "btns" }, el("button", { id: "mAddTop", onclick: () => { addTop(""); } }, "TOP hinzufügen")),
    el("h3", {}, "3 · TOP-Beginn im Transkript markieren"),
    el("div", { class: "status" }, "Wähle bei der Zeile, mit der ein TOP beginnt, den TOP aus. Alles bis zum nächsten Marker gehört zu diesem TOP."),
    el("div", { class: "btns" }, el("button", { id: "mShowLines", onclick: renderMarkers }, "Transkript-Zeilen anzeigen / aktualisieren")),
    markerBox,
    el("h3", {}, "4 · Stellen im Transkript: Beschlüsse, Zuständigkeiten, Termine"),
    el("div", { class: "hint" }, "Die Suche findet nur Stichwörter und kann Stellen übersehen. Bitte das Transkript selbst gegenlesen."),
    el("div", { class: "btns" }, el("button", { id: "mSearch", onclick: search }, "Stellen suchen")),
    candStatus, candBox,
    el("h3", {}, "5 · Verlauf je TOP"),
    el("div", { class: "status" }, "Den Verlauf schreibst du selbst. Daneben steht der Transkript-Ausschnitt des TOPs."),
    sectBox,
    el("h3", {}, "6 · Freigabe und Export"),
    el("label", { class: "check" }, approve, el("span", {}, "Vom Schriftführer geprüft und freigegeben")),
    el("div", { class: "status" }, "Ohne diesen Haken steht im Dokument „ENTWURF – nicht freigegeben“. Nicht übernommene Stellen kommen nie ins Dokument."),
    el("div", { class: "btns" }, el("button", { class: "primary", id: "mExport", onclick: exportDoc }, "Niederschrift als Word")),
    exportStatus,
  );
  H.anwesende.addEventListener("input", updateNames);

  // ---------- Kopfdaten ----------
  function prefill() {
    const p = api.getPrefill();
    if (p.datum) H.datum.value = p.datum;
    if (p.titel && !H.titel.value) H.titel.value = p.titel;
    if (p.start) H.beginn.value = hhmm(p.start);
    if (p.ende) H.ende.value = hhmm(p.ende);
    if (p.anwesende && !H.anwesende.value) H.anwesende.value = p.anwesende.join("\n");
    updateNames();
  }
  function updateNames() {
    nameList.replaceChildren(...lines(H.anwesende.value).map((n) => el("option", { value: n })));
  }

  // ---------- Tagesordnung ----------
  function addTop(title) {
    const id = "t" + m.nextTopId++;
    m.tops.push({ id, title });
    renderAll();
    const inputs = topList.querySelectorAll("input");
    inputs[inputs.length - 1]?.focus();
    return id;
  }
  function moveTop(i, d) {
    const j = i + d;
    if (j < 0 || j >= m.tops.length) return;
    [m.tops[i], m.tops[j]] = [m.tops[j], m.tops[i]];
    renderAll();
  }
  function removeTop(i) {
    const [t] = m.tops.splice(i, 1);
    for (const [seg, id] of m.markers) if (id === t.id) m.markers.delete(seg);
    for (const st of m.candState.values()) if (st.topManual && st.topId === t.id) { st.topManual = false; st.topId = null; }
    m.summaries.delete(t.id);
    renderAll();
  }
  const topLabel = (id) => { const i = m.tops.findIndex((t) => t.id === id); return i < 0 ? "" : `TOP ${i + 1}: ${m.tops[i].title || "(ohne Titel)"}`; };
  function renderTops() {
    topList.replaceChildren(...m.tops.map((t, i) => el("div", { class: "mrow" },
      el("span", { class: "mnum" }, `TOP ${i + 1}`),
      el("input", { type: "text", value: t.title, placeholder: "Titel des TOPs", "aria-label": `Titel TOP ${i + 1}`, oninput: (e) => { t.title = e.target.value; renderDependents(); } }),
      el("button", { class: "small", title: "nach oben", disabled: i === 0, onclick: () => moveTop(i, -1) }, "↑"),
      el("button", { class: "small", title: "nach unten", disabled: i === m.tops.length - 1, onclick: () => moveTop(i, 1) }, "↓"),
      el("button", { class: "small", title: "TOP entfernen", onclick: () => removeTop(i) }, "✕"),
    )));
    if (!m.tops.length) topList.replaceChildren(el("small", {}, "Noch keine Tagesordnungspunkte."));
  }

  // ---------- Zuordnung ----------
  function currentAssignment() {
    const ls = api.getLines();
    const markers = [];
    ls.forEach((l, i) => { if (m.markers.has(l.seg)) markers.push({ lineIndex: i, topId: m.markers.get(l.seg) }); });
    const asg = assignTops(ls.length, markers);
    const bySeg = new Map(ls.map((l, i) => [l.seg, asg[i]]));
    return { ls, asg, bySeg };
  }
  const topOptions = (selected, emptyLabel) => [el("option", { value: "" }, emptyLabel), ...m.tops.map((t) => el("option", { value: t.id, selected: t.id === selected }, topLabel(t.id)))];
  function renderMarkers() {
    const { ls } = currentAssignment();
    if (!ls.length) { markerBox.replaceChildren(el("small", {}, "Noch kein Transkript.")); return; }
    markerBox.replaceChildren(el("div", { class: "mlines" }, ...ls.map((l) => {
      const sel = el("select", { "aria-label": `TOP-Beginn bei ${fmtTime(l.start)}`, onchange: (e) => { if (e.target.value) m.markers.set(l.seg, e.target.value); else m.markers.delete(l.seg); renderDependents(false); } },
        ...topOptions(m.markers.get(l.seg) || "", "–"));
      return el("div", { class: "mline" + (m.markers.has(l.seg) ? " marked" : "") }, el("span", { class: "t" }, fmtTime(l.start)), el("span", { class: "x" }, l.text), sel);
    })));
    if (!m.tops.length) markerBox.prepend(el("div", { class: "status warn" }, "Erst unter „2 · Tagesordnung“ TOPs anlegen."));
  }

  // ---------- Kandidaten ----------
  function search() {
    const ls = api.getLines();
    const { candidates, dropped } = findCandidates(ls);
    m.cands = candidates.map((c) => ({ ...c, seg: ls[c.lineIndex].seg }))
      .sort((a, b) => a.start - b.start || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    m.dropped = dropped; m.searched = true;
    renderCands();
  }
  const stOf = (c) => {
    if (!m.candState.has(c.id)) m.candState.set(c.id, { status: "offen", text: "", autoText: "", anrede: "Herr", name: "", topId: null, topManual: false });
    return m.candState.get(c.id);
  };
  const effTop = (c, bySeg) => { const st = stOf(c); return st.topManual ? st.topId : (bySeg.get(c.seg) ?? null); };
  const template = (c, st) => c.kind === "Beschluss" ? decisionSentence(H.gremium.value) : c.kind === "Zuständigkeit" ? dutySentence(st.anrede, st.name) : "";
  function adopt(c, focus) {
    const st = stOf(c);
    st.status = "übernommen";
    if (!st.text) { st.text = st.autoText = template(c, st); }
    renderCands();
    if (focus) document.getElementById("mText-" + cssId(c.id))?.focus();
  }
  const cssId = (id) => id.replace(/[^A-Za-z0-9]/g, (ch) => "_" + ch.charCodeAt(0));
  function renderCands() {
    const { bySeg } = currentAssignment();
    const n = { offen: 0, übernommen: 0, verworfen: 0 };
    for (const c of m.cands) n[stOf(c).status]++;
    candStatus.textContent = !m.searched ? "Noch nicht gesucht."
      : `${m.cands.length} Stellen gefunden: ${n.übernommen} übernommen, ${n.verworfen} verworfen, ${n.offen} offen.` + (m.dropped ? ` ${m.dropped} verworfen, weil das Zitat nicht wörtlich im Transkript stand.` : "");
    candBox.replaceChildren(...m.cands.map((c) => {
      const st = stOf(c);
      const top = effTop(c, bySeg);
      const topSel = el("select", { "aria-label": "TOP-Zuordnung", onchange: (e) => { st.topManual = true; st.topId = e.target.value || null; renderDependents(false); } }, ...topOptions(top || "", "ohne TOP"));
      const box = el("div", { class: `cand ${st.status}`, "data-id": c.id, "data-kind": c.kind },
        el("div", { class: "chead" }, el("b", {}, c.kind), ` · ${fmtTime(c.start)} · `, el("span", { class: "cstate" }, st.status), " · ", topSel),
        el("blockquote", {}, c.quote));
      if (st.status === "offen") {
        box.append(el("div", { class: "btns" },
          el("button", { class: "small", onclick: () => adopt(c, false) }, "Übernehmen"),
          el("button", { class: "small", onclick: () => adopt(c, true) }, "Bearbeiten"),
          el("button", { class: "small", onclick: () => { st.status = "verworfen"; renderCands(); } }, "Verwerfen")));
      } else if (st.status === "verworfen") {
        box.append(el("div", { class: "btns" }, el("span", { class: "status" }, "Verworfen – kommt nicht ins Dokument."), el("button", { class: "small", onclick: () => { st.status = "offen"; renderCands(); } }, "Rückgängig")));
      } else {
        const text = el("textarea", { id: "mText-" + cssId(c.id), rows: 2, value: st.text, placeholder: c.kind === "Termin" ? "Termin in eigenen Worten" : "", oninput: (e) => { st.text = e.target.value; } });
        if (c.kind === "Zuständigkeit") {
          const regen = () => { if (st.text === st.autoText) { st.text = st.autoText = template(c, st); text.value = st.text; } };
          box.append(el("div", { class: "row" },
            el("div", {}, el("label", {}, "Anrede"), el("select", { class: "mAnrede", onchange: (e) => { st.anrede = e.target.value; regen(); } }, ...["Herr", "Frau"].map((a) => el("option", { value: a, selected: st.anrede === a }, a)))),
            el("div", {}, el("label", {}, "Name"), el("input", { type: "text", class: "mName", list: "mNames", value: st.name, oninput: (e) => { st.name = e.target.value; regen(); } }))));
        }
        box.append(el("label", {}, "Satz für die Niederschrift (selbst formulieren, „…“ ersetzen)"), text,
          el("div", { class: "btns" }, el("button", { class: "small", onclick: () => { st.status = "offen"; renderCands(); } }, "Doch nicht übernehmen")));
      }
      return box;
    }));
  }

  // ---------- Verlauf je TOP ----------
  function renderSections() {
    const { ls, asg } = currentAssignment();
    sectBox.replaceChildren(...m.tops.map((t) => {
      const excerpt = ls.filter((_, i) => asg[i] === t.id).map((l) => `[${fmtTime(l.start)}] ${l.text}`).join("\n");
      return el("div", { class: "msect" },
        el("b", {}, topLabel(t.id)),
        el("div", { class: "row" },
          el("div", {}, el("label", {}, "Verlauf / Zusammenfassung"), el("textarea", { rows: 5, class: "mSummary", "data-top": t.id, value: m.summaries.get(t.id) || "", oninput: (e) => m.summaries.set(t.id, e.target.value) })),
          el("div", {}, el("label", {}, "Transkript-Ausschnitt"), el("pre", { class: "mexcerpt" }, excerpt || "Kein Ausschnitt – Marker setzen unter „3“."))));
    }));
    if (!m.tops.length) sectBox.replaceChildren(el("small", {}, "Noch keine Tagesordnungspunkte."));
  }

  function renderDependents(withMarkers = true) {
    if (withMarkers && markerBox.childElementCount) renderMarkers();
    renderCands(); renderSections();
  }
  function renderAll() { renderTops(); renderDependents(); }

  // ---------- Export ----------
  function collect() {
    const { bySeg } = currentAssignment();
    const warn = [];
    const pick = (kind, top) => m.cands.filter((c) => c.kind === kind && stOf(c).status === "übernommen" && effTop(c, bySeg) === top).map((c) => stOf(c).text.trim()).filter(Boolean);
    const adopted = m.cands.filter((c) => stOf(c).status === "übernommen");
    const empty = adopted.filter((c) => !stOf(c).text.trim()).length;
    if (empty) warn.push(`${empty} übernommene Stelle(n) ohne Satz – nicht im Dokument.`);
    const dots = adopted.filter((c) => stOf(c).text.includes("…")).length;
    if (dots) warn.push(`${dots} Satz/Sätze enthalten noch „…“.`);
    const known = new Set(m.tops.map((t) => t.id));
    const orphan = (kind) => m.cands.filter((c) => c.kind === kind && stOf(c).status === "übernommen" && !known.has(effTop(c, bySeg))).map((c) => stOf(c).text.trim()).filter(Boolean);
    const unassigned = { decisions: orphan("Beschluss"), duties: orphan("Zuständigkeit"), dates: orphan("Termin") };
    const nUn = unassigned.decisions.length + unassigned.duties.length + unassigned.dates.length;
    if (nUn) warn.push(`${nUn} übernommene Stelle(n) ohne TOP – stehen unter „Ohne Zuordnung zu einem TOP“.`);
    const open = m.cands.filter((c) => stOf(c).status === "offen").length;
    if (open) warn.push(`${open} Stelle(n) noch offen – kommen nicht ins Dokument.`);
    return {
      warn,
      data: {
        approved: approve.checked,
        head: {
          gremium: H.gremium.value.trim(), titel: H.titel.value.trim(), datum: deDate(H.datum.value), beginn: H.beginn.value, ende: H.ende.value,
          ort: H.ort.value.trim(), vorsitz: H.vorsitz.value.trim(), schriftfuehrer: H.schriftfuehrer.value.trim(),
          anwesende: H.anwesende.value, entschuldigt: H.entschuldigt.value,
        },
        tops: m.tops.map((t) => ({ title: t.title.trim(), summary: m.summaries.get(t.id) || "", decisions: pick("Beschluss", t.id), duties: pick("Zuständigkeit", t.id), dates: pick("Termin", t.id) })),
        unassigned,
      },
    };
  }
  async function exportDoc() {
    const docx = api.getDocx();
    if (!docx) { exportStatus.textContent = "✘ Der Word-Baustein ist nicht geladen. Bitte die Seite einmal mit Internet neu laden."; return; }
    const { data, warn } = collect();
    try {
      const blob = await docx.Packer.toBlob(buildMinutesDoc(docx, data, api.getRepl()));
      const name = `Niederschrift_${timeStamp()}.docx`;
      api.download(blob, name);
      exportStatus.textContent = [`✔ ${name}: ${api.exportHint}`, data.approved ? "" : "Achtung: Das Dokument ist als ENTWURF markiert (nicht freigegeben).", ...warn].filter(Boolean).join("\n");
    } catch (e) {
      exportStatus.textContent = `✘ Word-Datei konnte nicht erstellt werden: ${String((e && e.message) || e)}`;
    }
  }

  // ---------- Zurücksetzen ----------
  function reset() {
    m = fresh();
    for (const x of Object.values(H)) x.value = "";
    approve.checked = false;
    exportStatus.textContent = "";
    markerBox.replaceChildren();
    updateNames();
    renderAll();
  }
  reset();
  return { reset };
}
