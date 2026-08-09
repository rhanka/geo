/**
 * _reglement-registry-lint.ts — garde-fou du registre curé de provenance règlement.
 *
 * `acquisition/config/reglement-provenance.json` est la VÉRITÉ DURABLE de la lane
 * P0_1 (fold-reglement-to-zonage le préfère à la grille servie). Or JSON.parse
 * accepte SILENCIEUSEMENT une clé dupliquée et garde la DERNIÈRE: deux shards qui
 * appendent en parallèle peuvent donc écraser une entrée curée sans qu'aucun gate
 * ne le voie. Ce lint lit le TEXTE BRUT (pas l'objet parsé) et refuse les doublons.
 *
 * Vérifie aussi la forme: 4 champs attendus, millésime à 4 chiffres, et un `_note`
 * obligatoire quand `reglement_numero` est null (une valeur nulle doit porter SA
 * RAISON verbatim, sinon on ne sait pas distinguer « pas encore lu » de « le doc ne
 * porte aucun numéro »).
 *
 * READ-ONLY: n'écrit rien, sort 1 si le registre est invalide.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglement-registry-lint.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTRY = resolve(ROOT, 'acquisition', 'config', 'reglement-provenance.json');

const FIELDS = ['reglement_numero', 'reglement_millesime', 'reglement_page_source', 'reglement_url'];

function main(): void {
  const raw = readFileSync(REGISTRY, 'utf8');

  // Doublons: on compte les clés dans le TEXTE, au niveau d'indentation des slugs
  // (4 espaces sous "slugs"). L'objet parsé a déjà perdu l'information.
  const seen = new Map<string, number>();
  for (const m of raw.matchAll(/^ {4}"([^"]+)":\s*\{/gm)) {
    const slug = m[1]!;
    seen.set(slug, (seen.get(slug) ?? 0) + 1);
  }
  const dupes = [...seen].filter(([, n]) => n > 1);

  const cfg = JSON.parse(raw) as { slugs: Record<string, Record<string, unknown>> };
  const slugs = Object.entries(cfg.slugs ?? {});

  const shape: string[] = [];
  for (const [slug, e] of slugs) {
    const numero = e['reglement_numero'];
    const mill = e['reglement_millesime'];
    if (numero == null && !e['_note']) {
      shape.push(`${slug}: reglement_numero=null SANS _note (raison verbatim obligatoire)`);
    }
    // millesime null EST légitime même avec un numéro: plusieurs gabarits (MRC de
    // La Matapédia…) ne portent aucune date d'adoption, et l'année lisible DANS le
    // numéro n'est pas l'année d'adoption (réfuté à stoneham: 09-591 adopté 2010).
    // On ne refuse donc qu'un millésime PRÉSENT mais mal formé.
    if (mill != null && !/^\d{4}$/.test(String(mill))) {
      shape.push(`${slug}: millesime='${String(mill)}' présent mais pas une année à 4 chiffres`);
    }
    for (const f of FIELDS) {
      if (!(f in e)) shape.push(`${slug}: champ manquant '${f}'`);
    }
  }

  const cured = slugs.filter(([, e]) => e['reglement_numero'] != null).length;
  console.log(`registre: ${slugs.length} slugs (clés uniques après parse) — ${cured} avec numéro, ${slugs.length - cured} null-motivés`);

  for (const [slug, n] of dupes) console.log(`DUPE  ${slug} apparaît ${n}× (JSON.parse garde la DERNIÈRE — écrasement silencieux)`);
  for (const s of shape) console.log(`SHAPE ${s}`);

  if (dupes.length || shape.length) {
    console.log(`\nINVALIDE: ${dupes.length} doublon(s), ${shape.length} défaut(s) de forme`);
    process.exit(1);
  }
  console.log('OK: aucun doublon, forme conforme');
}

main();
