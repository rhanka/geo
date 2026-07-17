/**
 * _zones-dormant-georef.ts — inventaire des GÉORÉFS DORMANTS.
 *
 * Motif mesuré (2026-07-17, shard 0/1) : le mur de la lane recalage n'est plus
 * le géoréf mais l'ÉTIQUETTE (le dict). Des GcpFile qui PASSENT leurs gates
 * dorment sur le disque sans être servis — ange-gardien a été servi ainsi
 * (18 GCP déjà émis ; seul le dict manquait).
 *
 * Cet outil croise, à $0 :
 *   - les `work/gcp/*.gcp.json` réellement présents (le GCP est la preuve du
 *     recalage : un `.report.json` seul ne suffit pas — il peut annoncer un
 *     pass dont le GcpFile n'a jamais été écrit) ;
 *   - la collection `ca-qc-zonage` réellement servie en S3 (source de vérité —
 *     la matrice `zones.status=done` ment, cf. mémoire projet).
 *
 * Sortie : les slugs à GCP présent MAIS non servis = le gisement actionnable.
 *
 * Usage: npx tsx acquisition/src/_zones-dormant-georef.ts [--json]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ListObjectsV2Command } from "@aws-sdk/client-s3";

import { s3Client, BUCKET } from "./lib/s3.js";

/** Slugs RÉELLEMENT servis. Les DEUX formes de clé (plate et sous-dossier) sont
 * lues : geo-api sert la forme sous-dossier, et n'en lire qu'une donne un faux
 * « non servi » (cf. mémoire projet fold-double-key-s3-serving). */
async function listServedZonageSlugs(): Promise<Set<string>> {
  const s3 = s3Client();
  const prefix = "normalized/ca-qc-zonage/";
  const slugs = new Set<string>();
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }),
    );
    for (const o of r.Contents ?? []) {
      const k = o.Key ?? "";
      const m =
        k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\.geojson$/) ?? k.match(/ca-qc-zonage\/qc-zonage-([^/]+)\/qc-zonage-/);
      if (m) slugs.add(m[1]!);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return slugs;
}

interface Dormant {
  slug: string;
  gcpFiles: string[];
  nGcps: number;
  independent: number;
  pdf?: string;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes("--json");
  const gcpDir = "work/gcp";

  const bySlug = new Map<string, Dormant>();
  for (const f of readdirSync(gcpDir)) {
    if (!f.endsWith(".gcp.json")) continue;
    let j: {
      slug?: string;
      pdf?: string;
      gcps?: { independent?: boolean }[];
    };
    try {
      j = JSON.parse(readFileSync(join(gcpDir, f), "utf8"));
    } catch {
      continue;
    }
    const slug = j.slug;
    if (!slug || !Array.isArray(j.gcps)) continue;
    const prev = bySlug.get(slug);
    const indep = j.gcps.filter((g) => g?.independent === true).length;
    if (!prev || j.gcps.length > prev.nGcps) {
      bySlug.set(slug, {
        slug,
        gcpFiles: [...(prev?.gcpFiles ?? []), f],
        nGcps: j.gcps.length,
        independent: indep,
        pdf: j.pdf,
      });
    } else {
      prev.gcpFiles.push(f);
    }
  }

  const served = await listServedZonageSlugs();

  const dormant: Dormant[] = [];
  for (const d of bySlug.values()) if (!served.has(d.slug)) dormant.push(d);
  dormant.sort((a, b) => b.independent - a.independent || b.nGcps - a.nGcps);

  if (asJson) {
    console.log(JSON.stringify({ n_gcp_slugs: bySlug.size, n_served: served.size, dormant }, null, 2));
    return;
  }

  console.log(`slugs à GcpFile présent : ${bySlug.size} · servis en S3 (ca-qc-zonage) : ${served.size}`);
  console.log(`\n=== GÉORÉFS DORMANTS (GCP présent, NON servi) : ${dormant.length} ===`);
  for (const d of dormant) {
    console.log(
      `  ${d.slug.padEnd(34)} gcps=${String(d.nGcps).padStart(3)} indépendants=${String(d.independent).padStart(3)}  ${d.gcpFiles[0]}`,
    );
    if (d.pdf) console.log(`${" ".repeat(38)}pdf=${d.pdf}`);
  }
  console.log(
    `\nRappel : un GCP dormant n'est PAS un dépôt — il faut encore des ÉTIQUETTES` +
      ` (dict autoritaire) et les gates (cardinal tiers, couverture-lots).`,
  );
}

void main();
