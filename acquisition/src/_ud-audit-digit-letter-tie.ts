#!/usr/bin/env tsx
/**
 * _ud-audit-digit-letter-tie.ts — audit $0 (LOCAL, aucun accès S3) du faux silencieux
 * « clé de BANDE à 1 chiffre ⊕ clé de LETTRE à 1 caractère ».
 *
 * `categoryFor` teste la forme BRUTE puis les formes canonisées et garde le PLUS LONG
 * préfixe, à comparaison STRICTE (`p.length > bestLen`). Sur un code servi `103-P` :
 *   - forme brute « 103-P »   -> la clé « 1 » matche, bestLen = 1
 *   - forme canon « P-103 »   -> la clé « P » matche aussi, mais 1 > 1 est FAUX
 * ⇒ la clé de BANDE gagne et la clé de LETTRE est INOPÉRANTE, en silence.
 * Mesuré sur saint-hugues (MRC des Maskoutains) : `{"1":…,"P":null}` sert `103-P` en
 * residentiel ; la clé qui neutralise est « P- » (longueur 2 sur la forme canonisée).
 *
 * Ce script ne lit QUE les configs : il liste les couples à risque, à re-vérifier ensuite
 * au `fold-usage-dominant.ts --slugs <…> --list-prefixes` (seule autorité sur la FORME
 * réellement servie : le risque n'est réel que si le SIG sert des codes digit-first
 * `<numéro>-<LETTRE>`).
 *
 * usage: npx tsx acquisition/src/_ud-audit-digit-letter-tie.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAP_DIR = resolve(ROOT, "acquisition", "config", "usage-dominant-map");

if (!existsSync(MAP_DIR)) {
  console.error(`introuvable: ${MAP_DIR}`);
  process.exit(1);
}

let scanned = 0;
const risky: { slug: string; digits: string[]; letters: string[] }[] = [];

for (const file of readdirSync(MAP_DIR).sort()) {
  if (!file.endsWith(".json")) continue;
  const slug = file.slice(0, -5);
  let cfg: { prefix_map?: Record<string, unknown> };
  try {
    cfg = JSON.parse(readFileSync(resolve(MAP_DIR, file), "utf8"));
  } catch {
    console.log(`ILLISIBLE ${slug}`);
    continue;
  }
  const keys = Object.keys(cfg.prefix_map ?? {});
  if (keys.length === 0) continue;
  scanned++;
  // Clé de BANDE = un seul chiffre. Clé de LETTRE inopérante = un seul caractère
  // alphabétique (une clé de 2+ caractères, « P- » ou « AF », gagne le départage).
  const digits = keys.filter((k) => /^[0-9]$/.test(k));
  const letters = keys.filter((k) => /^[A-Za-z]$/.test(k));
  if (digits.length > 0 && letters.length > 0) risky.push({ slug, digits, letters });
}

console.log(`# audit départage bande/lettre — ${scanned} configs à prefix_map lues`);
console.log(`# couples à risque (bande 1 chiffre ⊕ lettre 1 caractère): ${risky.length}`);
for (const r of risky) {
  console.log(`${r.slug}  chiffres=[${r.digits.join(",")}]  lettres=[${r.letters.join(",")}]`);
}
if (risky.length > 0) {
  console.log(
    `\n# VÉRIFIER ces slugs au --list-prefixes: le faux n'est RÉEL que si le SIG sert des codes\n` +
      `# digit-first « <numéro>-<LETTRE> ». Si oui, allonger la clé de lettre (« P » -> « P- »).`,
  );
}
