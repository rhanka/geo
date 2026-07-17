/**
 * _reglement-verify.ts — lane P0_1 provenance règlement (Steve/immo).
 *
 * Vérifie la provenance SUR LA COLLECTION SERVIE (geo-api), pas sur l'intention:
 * interroge `qc-zonage-<slug>/items?limit=1` et imprime les 4 champs tels que
 * l'API les rend. C'est le seul verdict qui compte pour la fiche lot immo.
 *
 * Usage (npx tsx, from repo root):
 *   npx tsx acquisition/src/_reglement-verify.ts --slugs audet,bearn,bury
 */
import { pathToFileURL } from "node:url";

const API = process.env["GEO_API"] ?? "https://api.geo.sent-tech.ca";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const slugs = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) { console.error("pass --slugs <a,b>"); process.exit(2); }

  let served = 0;
  for (const slug of slugs) {
    const url = `${API}/collections/qc-zonage-${slug}/items?limit=1`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) { console.log(`${slug.padEnd(34)} HTTP ${r.status}`); continue; }
      const j = (await r.json()) as { features?: Array<{ properties?: Record<string, unknown> }> };
      const p = j.features?.[0]?.properties ?? {};
      const numero = p["reglement_numero"] ?? null;
      if (numero) served++;
      console.log(
        `${slug.padEnd(34)} numero=${String(numero)} millesime=${String(p["reglement_millesime"] ?? null)} ` +
          `page=${String(p["reglement_page_source"] ?? null)} url=${p["reglement_url"] ? "oui" : "null"}`,
      );
    } catch (e) {
      console.log(`${slug.padEnd(34)} FETCH FAIL ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`SERVIS ${served}/${slugs.length} portent reglement_numero`);
}

const invokedDirectly = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
