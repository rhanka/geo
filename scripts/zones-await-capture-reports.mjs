#!/usr/bin/env node
// Watcher NON bloquant (run_in_background) : attend qu'un rapport de capture
// vecteur-natif (batch b1 arcgis / b2 azimut-wfs) atterrisse sous work/coverage/,
// émet une ligne dès qu'un nouveau rapport apparaît, puis sort. Sort aussi au
// plafond de temps (heartbeat de sûreté) pour ne jamais rester armé indéfiniment.
//
// Sortie = signal de reprise pour le conducteur (inbox cassé → on remonte par
// fichier committable). Aucune écriture, lecture seule du répertoire.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL("../work/coverage/", import.meta.url).pathname;
const PATTERNS = [/arcgis-b1.*report.*\.json$/i, /azimut.*b2.*report.*\.json$/i];
const START = Date.now();
const CAP_MS = 25 * 60 * 1000; // plafond 25 min
const POLL_MS = 30 * 1000;

// Baseline : rapports déjà présents au démarrage (on ne signale que le NOUVEAU).
function scan() {
  let names = [];
  try { names = readdirSync(DIR); } catch { return []; }
  return names.filter((n) => PATTERNS.some((p) => p.test(n)));
}
const seen = new Set(scan());

function tick() {
  const now = scan();
  const fresh = now.filter((n) => !seen.has(n));
  for (const n of fresh) {
    seen.add(n);
    let sz = "?";
    try { sz = String(statSync(join(DIR, n)).size); } catch {}
    console.log(`REPORT_READY ${n} bytes=${sz}`);
  }
  if (fresh.length > 0) {
    console.log("EXIT reason=report-landed");
    process.exit(0);
  }
  if (Date.now() - START >= CAP_MS) {
    console.log(`EXIT reason=cap-25min seen=${[...seen].join(",") || "none"}`);
    process.exit(0);
  }
  setTimeout(tick, POLL_MS);
}
tick();
