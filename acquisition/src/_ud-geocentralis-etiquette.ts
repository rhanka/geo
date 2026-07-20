/**
 * _ud-geocentralis-etiquette — $0 (lane usage_dominant). GISEMENT: la couche
 * geocentralis `evb:siadmin_pzon_99_s` (celle-là même qui sert beaucoup de
 * qc-zonage-*, tag obscura-wfs-geoserver) porte la VOCATION ÉCRITE par entité:
 *   etiquette_1 = code complet (« Fc.3 »), etiquette_3 = préfixe, etiquette_2 = vocation.
 * Quand etiquette_2 est rempli, IL EST la légende « Abréviation / Fonction dominante »
 * — aucun PDF à lire, aucune dépense. Gate propriétaire = le filtre id_municipalite
 * (code MAMH, cf. packages/qc-sources/src/geo/qc-municipal-directory.json).
 *
 *   npx tsx acquisition/src/_ud-geocentralis-etiquette.ts --muni 17020
 *   npx tsx acquisition/src/_ud-geocentralis-etiquette.ts --muni 17020,17045,28070
 *
 * Sortie: une ligne par valeur distincte de etiquette_2, avec les codes qui la portent.
 * « (null) » partout ⇒ pas ce gisement pour cette muni, retomber sur le corps PDF.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WFS = "https://geoserver.geocentralis.com/geoserver/ows";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRECTORY = resolve(ROOT, "packages", "qc-sources", "src", "geo", "qc-municipal-directory.json");

/** Nom officiel porté par le code MAMH — c'est LUI le gate propriétaire du dump. */
function muniName(code: string): string {
  try {
    const raw = JSON.parse(readFileSync(DIRECTORY, "utf8")) as {
      entries: Record<string, { name?: string; mamhName?: string; mamhCode?: string; designation?: string }>;
    };
    for (const e of Object.values(raw.entries ?? {})) {
      if (e.mamhCode === code) return `${e.mamhName ?? e.name ?? "?"} (${e.designation ?? "?"})`;
    }
  } catch {
    return "(directory illisible)";
  }
  return "(code absent du directory)";
}

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Feature {
  properties: Record<string, unknown>;
}

async function dumpOne(muni: string): Promise<void> {
  const url =
    `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=evb:siadmin_pzon_99_s` +
    `&outputFormat=application/json` +
    `&propertyName=etiquette_1,etiquette_2,etiquette_3,id_municipalite` +
    `&CQL_FILTER=${encodeURIComponent(`id_municipalite='${muni}'`)}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) {
    console.log(`### ${muni} — HTTP ${res.status}`);
    return;
  }
  const json = (await res.json()) as { features?: Feature[] };
  const feats = json.features ?? [];
  console.log(`### ${muni} = ${muniName(muni)} — features=${feats.length}`);
  const byVoc = new Map<string, string[]>();
  for (const f of feats) {
    const p = f.properties ?? {};
    const code = String(p.etiquette_1 ?? "");
    const voc = p.etiquette_2 === null || p.etiquette_2 === undefined ? "(null)" : String(p.etiquette_2);
    if (!byVoc.has(voc)) byVoc.set(voc, []);
    byVoc.get(voc)!.push(code);
  }
  for (const [voc, codes] of [...byVoc.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${JSON.stringify(voc)}  n=${codes.length}  codes: ${codes.sort().join(", ")}`);
  }
}

/** Code MAMH d'un slug (le répertoire committé est indexé PAR slug). */
function codeOfSlug(slug: string): string | null {
  const raw = JSON.parse(readFileSync(DIRECTORY, "utf8")) as {
    entries: Record<string, { mamhCode?: string }>;
  };
  return raw.entries?.[slug]?.mamhCode ?? null;
}

async function main(): Promise<void> {
  const munis = (arg("muni") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const slug of (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const code = codeOfSlug(slug);
    if (!code) console.log(`### ${slug} — slug absent du répertoire MAMH committé`);
    else munis.push(code);
  }
  if (!munis.length) throw new Error("usage: --muni <codeMAMH>[,…] | --slugs <slug>[,…]");
  for (const m of munis) await dumpOne(m);
}

await main();
