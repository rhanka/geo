/**
 * _reglprov-verify-api.ts — vérifie la provenance règlement SERVIE (collection
 * polygone `qc-zonage-<slug>`) via l'API OGC publique. Preuve côté servi (pas
 * l'intention). Réutilisable pour l'avant/après de la lane provenance.
 *
 * Usage (depuis acquisition/):
 *   npx tsx src/_reglprov-verify-api.ts --slugs a,b,c
 */
const API = "https://api.geo.sent-tech.ca/collections";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("pass --slugs a,b,c"); process.exit(2); }
  for (const slug of slugs) {
    try {
      const r = await fetch(`${API}/qc-zonage-${slug}/items?limit=1`);
      if (!r.ok) { console.log(`${slug}\tHTTP-${r.status}`); continue; }
      const j = (await r.json()) as { features?: Array<{ properties?: Record<string, unknown> }> };
      const p = j.features?.[0]?.properties ?? {};
      const num = p["reglement_numero"] ?? "NULL";
      const mill = p["reglement_millesime"] ?? "-";
      console.log(`${slug}\tnum=${num}\tmill=${mill}`);
    } catch (e) {
      console.log(`${slug}\tERR:${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });

export {};
