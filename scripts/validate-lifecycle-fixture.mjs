#!/usr/bin/env node
// Validate a reglement-lifecycle scaling fixture against the FROZEN émission
// contract (zoning-events-emit.ts) WITHOUT importing the emitter — it replicates
// the buildReglementEvent/validateZoningEvent gates the runner will enforce, so a
// fixture can be proven contract-clean before geo-archi's runner consumes it.
//
// Usage: node scripts/validate-lifecycle-fixture.mjs <fixture.json>
// Exit 0 = every `inputs[]` record passes; exit 1 = ≥1 violation (listed).
//
// Checked (mirrors validateZoningEvent + buildReglementEvent, contract §1/§6/§10):
//  - JSON well-formed; `inputs` present.
//  - provenance.doc_sha256 ET retrieved_at présents et NON vides (seam-fix #287 §6).
//  - document_type ∈ DOCUMENT_TYPE_KNOWN | null (string tolérée §9, mais on WARN si hors set).
//  - cible_reglement_numero RÉSERVÉ à avis_motion (rejet sinon, §1 table / §4).
//  - reglement_number = liste (verbatim-or-null par item) ; [] attendu pour avis_motion.
//  - type_instrument_declared string non vide | 'unknown' | null (jamais deviné, §10).
//  - source_url (url_pdf) sans placeholder 'non-disponible' (§6 source vivante).
//  - detection_anchor + extrait_brut + date_iso (YYYY-MM-DD) présents.
import { readFileSync } from "node:fs";

const DOCUMENT_TYPE_KNOWN = new Set(["avis_motion", "projet_reglement", "adoption", "entree_en_vigueur", "abrogation"]);
const DECISION_STATE_KNOWN = new Set(["planned", "decided"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const path = process.argv[2];
if (!path) { console.error("usage: node scripts/validate-lifecycle-fixture.mjs <fixture.json>"); process.exit(2); }

let doc;
try { doc = JSON.parse(readFileSync(path, "utf8")); }
catch (e) { console.error(`JSON malformé: ${e.message}`); process.exit(1); }

const inputs = Array.isArray(doc.inputs) ? doc.inputs : null;
if (!inputs) { console.error("`inputs[]` absent ou non-liste"); process.exit(1); }

const errors = [];
const warns = [];
inputs.forEach((r, i) => {
  const id = `inputs[${i}] ${r.muni ?? "?"}/${(r.reglement_number && r.reglement_number[0]) ?? r.cible_reglement_numero ?? r.type ?? "?"}`;
  const p = r.provenance;
  if (!p || !p.doc_sha256) errors.push(`${id}: provenance.doc_sha256 manquant (§6)`);
  if (!p || !p.retrieved_at) errors.push(`${id}: provenance.retrieved_at manquant (§6, valeur réelle jamais fabriquée)`);
  const dt = r.document_type;
  if (dt !== null && dt !== undefined && typeof dt !== "string") errors.push(`${id}: document_type non-string (${dt})`);
  if (typeof dt === "string" && !DOCUMENT_TYPE_KNOWN.has(dt)) warns.push(`${id}: document_type '${dt}' hors DOCUMENT_TYPE_KNOWN (toléré §9 mais vérifie)`);
  if (r.cible_reglement_numero != null && dt !== "avis_motion" && typeof dt === "string" && DOCUMENT_TYPE_KNOWN.has(dt))
    errors.push(`${id}: cible_reglement_numero='${r.cible_reglement_numero}' sur document_type='${dt}' — cible RÉSERVÉ à avis_motion (§1/§4) ; le n° de base va dans libelles_relation`);
  if (r.reglement_number !== undefined && !Array.isArray(r.reglement_number)) errors.push(`${id}: reglement_number doit être une liste`);
  if (dt === "avis_motion" && Array.isArray(r.reglement_number) && r.reglement_number.length > 0) warns.push(`${id}: avis_motion avec reglement_number non-vide (attendu [] ; le n° annoncé va dans cible)`);
  const ti = r.type_instrument_declared;
  if (ti !== null && ti !== undefined && (typeof ti !== "string" || ti.trim() === "")) errors.push(`${id}: type_instrument_declared vide/non-string (verbatim | 'unknown' | null)`);
  if (typeof r.url_pdf === "string" && r.url_pdf.includes("non-disponible")) errors.push(`${id}: url_pdf placeholder 'non-disponible' (§6 stage fantôme interdit)`);
  if (!r.detection_anchor) errors.push(`${id}: detection_anchor manquant (A1)`);
  if (!r.extrait_brut) errors.push(`${id}: extrait_brut manquant (preuve verbatim)`);
  if (!DATE_RE.test(r.date_iso ?? "")) errors.push(`${id}: date_iso invalide (YYYY-MM-DD): ${r.date_iso}`);
  const ds = r.decision_state;
  if (ds !== null && ds !== undefined && !DECISION_STATE_KNOWN.has(ds)) errors.push(`${id}: decision_state invalide (${String(ds)}) — 'planned'|'decided'|null|absent (§11 ; planned jamais assumé décidé)`);
});

const pending = Array.isArray(doc.pending_backfill) ? doc.pending_backfill.length : 0;
console.log(`fixture: ${path}`);
console.log(`inputs (runner-ready): ${inputs.length} | pending_backfill: ${pending} | total: ${inputs.length + pending}`);
if (warns.length) { console.log(`\nWARN (${warns.length}):`); warns.forEach((w) => console.log(`  ⚠ ${w}`)); }
if (errors.length) { console.log(`\nERREURS (${errors.length}):`); errors.forEach((e) => console.log(`  ✗ ${e}`)); process.exit(1); }
console.log(`\n✓ ${inputs.length}/${inputs.length} inputs conformes au contrat (buildReglementEvent + validateZoningEvent §1/§6/§10).`);
