/**
 * Accès S3 en LECTURE SEULE pour le générateur de rapport de statut QC.
 *
 * Reprend le pattern éprouvé de `acquisition/src/lib/s3.ts` (Scaleway Object
 * Storage, `forcePathStyle`). Les credentials sont lus AU RUNTIME depuis
 * `/home/antoinefa/src/_acquisition-shared/s3.env` (JAMAIS committé, jamais
 * réécrit). Ce module n'expose AUCUNE opération d'écriture : list / head / get
 * uniquement.
 */
import { readFileSync } from "node:fs";

import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

export const S3ENV = "/home/antoinefa/src/_acquisition-shared/s3.env";
export const BUCKET = "sentropic-geo";

/** Parse un fichier `.env` (ignore commentaires + lignes vides). */
export function loadEnv(path: string = S3ENV): Record<string, string> {
  const env: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const ln = raw.trim();
    if (!ln || ln.startsWith("#") || !ln.includes("=")) continue;
    const i = ln.indexOf("=");
    env[ln.slice(0, i).trim()] = ln.slice(i + 1).trim();
  }
  return env;
}

/** Client Scaleway S3 (forcePathStyle, creds lues de s3.env au runtime). */
export function s3Client(envPath: string = S3ENV): S3Client {
  const env = loadEnv(envPath);
  const access = env["S3_ACCESS_KEY"];
  const secret = env["S3_SECRET_KEY"];
  if (!access || !secret) {
    throw new Error(
      `Credentials S3 absentes dans ${envPath} (S3_ACCESS_KEY / S3_SECRET_KEY).`,
    );
  }
  const endpoint = env["S3_ENDPOINT"];
  return new S3Client({
    ...(endpoint ? { endpoint } : {}),
    region: env["S3_REGION"] || "fr-par",
    forcePathStyle: true,
    credentials: { accessKeyId: access, secretAccessKey: secret },
  });
}

/**
 * Liste toutes les clés sous `prefix` se terminant par `suffix`, en paginant.
 * Retourne la liste des "slugs" (la partie entre `prefix` et `suffix`).
 * `topLevelOnly` ignore les clés dont le reste contient un `/` (exclut les
 * dumps imbriqués type ArcGIS), comme le `list_slugs` de l'acquisition.
 */
export async function listSlugs(
  s3: S3Client,
  prefix: string,
  suffix: string,
  topLevelOnly = false,
  bucket: string = BUCKET,
): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const r = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const o of r.Contents ?? []) {
      const k = o.Key;
      if (!k || !k.endsWith(suffix)) continue;
      const rest = k.slice(prefix.length, k.length - suffix.length);
      if (topLevelOnly && rest.includes("/")) continue;
      out.push(rest);
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/** Compte simple = nb de slugs sous `prefix` finissant par `suffix`. */
export async function countObjects(
  s3: S3Client,
  prefix: string,
  suffix: string,
  topLevelOnly = false,
  bucket: string = BUCKET,
): Promise<number> {
  return (await listSlugs(s3, prefix, suffix, topLevelOnly, bucket)).length;
}

/**
 * Lit un intervalle d'octets (HTTP Range) d'un objet — utilisé pour
 * échantillonner un GeoJSON de zonage sans le télécharger en entier afin de
 * détecter la présence d'un vrai `zone_code` / `code_zone` non-null.
 */
export async function getRange(
  s3: S3Client,
  key: string,
  bytes: number,
  bucket: string = BUCKET,
): Promise<string> {
  const r = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      Range: `bytes=0-${Math.max(0, bytes - 1)}`,
    }),
  );
  const chunks: Buffer[] = [];
  for await (const c of r.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}
