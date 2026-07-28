/**
 * immo-4a-artefact-verify.ts — l'artefact 4a est-il consommable PAR UN TIERS ?
 *
 * Le contrat servi a son vérificateur, l'artefact 4a n'en avait pas. Or c'est LUI
 * qu'immo ingère pour remplir `effet_densifiant`. Le publier sans jamais le relire
 * depuis les octets stockés reproduirait exactement le défaut qui leur a fait
 * rendre un NO-GO : « ni publiable ni vérifiable ».
 *
 * Relit `latest.json` ET son snapshot depuis S3, comme un tiers le ferait, puis
 * contrôle ce qui rendrait l'artefact inutilisable ou trompeur :
 *
 *   1. `latest` et le snapshot sont identiques octet pour octet ;
 *   2. la clé de jointure {city_slug, zone_ref_canon_v1, reglement_number} —
 *      celle qu'immo a VALIDÉE — est présente et unique sur chaque enregistrement ;
 *   3. tout effet CONNU porte ses deux densités ET ses deux citations : un effet
 *      sans provenance est déclaratif, donc sans valeur pour un tiers ;
 *   4. l'effet est COHÉRENT avec ses compteurs — `densifie` exige après > avant.
 *      C'est le verrou anti-invention : un effet fabriqué ferait qualifier un
 *      signal immobilier réel sur une base fausse, en production, chez un tiers ;
 *   5. le millésime et la provenance sont portés DANS l'artefact, comme demandé.
 *
 * Lecture seule stricte. N'écrit rien, ne republie rien.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/immo-4a-artefact-verify.ts
 */
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import { getBytes, s3Client } from "./lib/s3.js";
import { immo4aContentSha256, type Immo4aArtifact } from "./lib/immo-4a-delta-grille.js";

const LATEST_KEY = "exports/immo/artefact-4a-delta-grille/v1/latest.json";

/**
 * Forme RÉELLE d'un enregistrement, lue dans `lib/immo-4a-delta-grille.ts` :
 * la clé de jointure est IMBRIQUÉE sous `join_key`, et les citations du delta
 * vivent sous `provenance.grid_delta_evidence` — distinctes de la preuve de
 * géométrie, qu'il ne faut jamais présenter à leur place.
 */
interface Record_ {
  join_key?: { city_slug?: unknown; zone_ref_canon_v1?: unknown; reglement_number?: unknown };
  effet_densifiant?: unknown;
  densite_avant?: unknown;
  densite_apres?: unknown;
  provenance?: {
    grid_delta_evidence?: { densite_avant_source?: unknown; densite_apres_source?: unknown } | null;
  };
  [key: string]: unknown;
}

function valueOf(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index < 0 ? undefined : argv[index + 1];
}

function filled(value: unknown): boolean {
  return value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "");
}

function requireS3RunEnvironment(): void {
  const nodeOptions = process.env["NODE_OPTIONS"] ?? "";
  if (!nodeOptions.split(/\s+/).includes("--dns-result-order=ipv4first")) {
    throw new Error("run S3 refusé: préfixer NODE_OPTIONS=--dns-result-order=ipv4first");
  }
  if (process.env["AWS_MAX_ATTEMPTS"] !== "10") throw new Error("run S3 refusé: préfixer AWS_MAX_ATTEMPTS=10");
}

async function main(): Promise<void> {
  requireS3RunEnvironment();
  const s3 = s3Client();
  const failures: string[] = [];

  const latestBytes = await getBytes(s3, LATEST_KEY);
  const latest = JSON.parse(latestBytes.toString("utf8")) as Record<string, unknown>;

  // (1) `latest` doit etre le snapshot, octet pour octet. Un `latest` qui derive
  // de son snapshot rend l'empreinte publiee inverifiable.
  //
  // L'artefact ne PORTE PAS son URI de snapshot : le publieur la retourne, et le
  // nom du snapshot est un identifiant opaque. Un tiers ne peut donc pas
  // remonter de `latest` a son snapshot sans qu'on le lui donne — c'est passable
  // pour un consommateur qui epingle le sha, mais on l'accepte explicitement au
  // lieu de le decouvrir. `--snapshot-key <cle>` permet de verifier l'egalite.
  const snapshotKey = valueOf(process.argv.slice(2), "--snapshot-key") ?? null;
  if (snapshotKey !== null) {
    const snapshotBytes = await getBytes(s3, snapshotKey);
    if (!snapshotBytes.equals(latestBytes)) failures.push(`latest.json diffère de son snapshot (${snapshotKey})`);
  }

  const records = Array.isArray(latest["records"]) ? (latest["records"] as Record_[]) : null;
  if (records === null) {
    failures.push("champ `records` absent ou non tableau");
  } else {
    const seen = new Set<string>();
    for (const [index, record] of records.entries()) {
      const join = record.join_key ?? {};
      const where = `record[${index}] ${String(join.city_slug ?? "?")}/${String(join.zone_ref_canon_v1 ?? "?")}`;
      // (2) la cle de jointure validee par immo.
      for (const field of ["city_slug", "zone_ref_canon_v1", "reglement_number"] as const) {
        if (!filled(join[field])) failures.push(`${where}: clé de jointure incomplète, ${field} vide`);
      }
      const key = `${String(join.city_slug)}|${String(join.zone_ref_canon_v1)}|${String(join.reglement_number)}`;
      if (seen.has(key)) failures.push(`${where}: clé de jointure DUPLIQUÉE (${key})`);
      seen.add(key);

      const effect = record.effet_densifiant;
      if (effect === "inconnu" || effect === undefined) continue;

      // (3) un effet connu sans provenance est declaratif, donc sans valeur.
      // `grid_delta_evidence` est la preuve du DELTA : ne jamais accepter la
      // preuve de geometrie a sa place, ce serait requalifier une preuve.
      const evidence = record.provenance?.grid_delta_evidence ?? null;
      if (evidence === null) {
        failures.push(`${where}: effet ${String(effect)} sans grid_delta_evidence`);
      } else {
        for (const field of ["densite_avant_source", "densite_apres_source"] as const) {
          if (!filled(evidence[field])) failures.push(`${where}: effet ${String(effect)} sans ${field}`);
        }
      }
      // (4) l'effet est DERIVE des compteurs, jamais une entree de confiance.
      const before = record.densite_avant;
      const after = record.densite_apres;
      if (typeof before !== "number" || typeof after !== "number") {
        failures.push(`${where}: effet ${String(effect)} sans deux compteurs numériques`);
        continue;
      }
      const derived = after > before ? "densifie" : after < before ? "reduit" : "stable";
      if (effect !== derived) {
        failures.push(`${where}: effet=${String(effect)} CONTREDIT les compteurs ${before}->${after} (dérivé=${derived})`);
      }
    }
  }

  // (5) millesime et provenance portes DANS l'artefact, comme immo l'a demande.
  for (const field of ["generated_at", "schema_version"]) {
    if (!filled(latest[field])) failures.push(`métadonnée d'artefact absente: ${field}`);
  }

  let contentSha256: string | null = null;
  try {
    const artifact = latest as unknown as Immo4aArtifact;
    contentSha256 = immo4aContentSha256(artifact);
    const freshnessOnly = { ...latest, generated_at: "2000-01-01T00:00:00.000Z", snapshot_id: "freshness-probe" } as unknown as Immo4aArtifact;
    if (immo4aContentSha256(freshnessOnly) !== contentSha256) {
      failures.push("l'empreinte de contenu varie avec une métadonnée de fraîcheur");
    }
  } catch (error) {
    failures.push(`empreinte de contenu impossible à calculer: ${String(error)}`);
  }

  const known = records?.filter((r) => r.effet_densifiant !== "inconnu" && r.effet_densifiant !== undefined) ?? [];
  console.log(JSON.stringify({
    verified: failures.length === 0,
    latest_uri: `s3://sentropic-geo/${LATEST_KEY}`,
    snapshot_key_checked: snapshotKey,
    artifact_sha256: createHash("sha256").update(latestBytes).digest("hex"),
    content_sha256: contentSha256,
    generated_at: latest["generated_at"] ?? null,
    bytes: latestBytes.length,
    records: records?.length ?? 0,
    records_effet_connu: known.length,
    effets: known.reduce<Record<string, number>>((acc, r) => {
      const key = String(r.effet_densifiant);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    failures,
  }, null, 2));
  if (failures.length > 0) process.exit(1);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
