/**
 * _zonage-reglement-url — $0 read-only. Dump les couples distincts
 * `reglement_numero` / `reglement_url` stampés sur le polygone servi, LU DEPUIS
 * S3 (jamais via l'API).
 *
 * Pourquoi depuis S3: geo-api met une collection en cache mémoire dès le PREMIER
 * GET et ne revalide pas. Découvrir l'URL du règlement via
 * `curl .../collections/qc-zonage-<slug>/items` empoisonne donc le cache, et la
 * vérification qui suit le fold renvoie `null` partout — un FAUX NÉGATIF. Ce
 * script donne la même information sans toucher l'API.
 *
 *   npx tsx acquisition/src/_zonage-reglement-url.ts --slugs cap-sante,neuville
 */
import { s3Client, getBytes, exists } from "./lib/s3.js";

const ZONAGE_PREFIX = "normalized/ca-qc-zonage/";

type S3 = ReturnType<typeof s3Client>;

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Même résolution que fold-usage-dominant.ts (layout plat OU sous-dossier). */
async function zonageKey(s3: S3, slug: string): Promise<string | null> {
  const flat = `${ZONAGE_PREFIX}qc-zonage-${slug}.geojson`;
  if (await exists(s3, flat)) return flat;
  const sub = `${ZONAGE_PREFIX}qc-zonage-${slug}/qc-zonage-${slug}.geojson`;
  if (await exists(s3, sub)) return sub;
  return null;
}

async function main(): Promise<void> {
  const slugs = (arg("slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("required: --slugs <a,b>");
  const s3 = s3Client();
  for (const slug of slugs) {
    const key = await zonageKey(s3, slug);
    if (!key) {
      console.log(`${slug} — polygone qc-zonage NON servi`);
      continue;
    }
    const fc = JSON.parse((await getBytes(s3, key)).toString("utf8")) as {
      features?: { properties?: Record<string, unknown> }[];
    };
    const feats = fc.features ?? [];
    const pairs = new Map<string, number>();
    for (const f of feats) {
      const p = f.properties ?? {};
      const k = `${String(p["reglement_numero"] ?? "null")}\t${String(p["reglement_url"] ?? "null")}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
    console.log(`${slug} — features=${feats.length}`);
    for (const [k, n] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) {
      const [num, url] = k.split("\t");
      console.log(`  n=${String(n).padStart(4)} num=${num}`);
      console.log(`        url=${url}`);
    }
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e));
  process.exit(1);
});
