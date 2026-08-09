/**
 * _reglement-served-check.ts — lane P0_1, READ-ONLY.
 *
 * Vérifie la provenance règlement RÉELLEMENT SERVIE sur la collection polygone
 * qc-zonage-<slug> (geo-api). Preuve « côté servi », pas côté intention.
 *
 * Usage: npx tsx acquisition/src/_reglement-served-check.ts slugA slugB ...
 */
const API = 'https://api.geo.sent-tech.ca/collections';

async function main(): Promise<void> {
  const slugs = process.argv.slice(2);
  for (const slug of slugs) {
    try {
      const r = await fetch(`${API}/qc-zonage-${slug}/items?limit=1`);
      if (!r.ok) {
        console.log(`${slug}\tHTTP ${r.status}`);
        continue;
      }
      const j = (await r.json()) as {
        features?: Array<{ properties?: Record<string, unknown> }>;
      };
      const p = j.features?.[0]?.properties ?? {};
      console.log(
        `${slug}\tnum=${p['reglement_numero'] ?? '∅'}\tmill=${p['reglement_millesime'] ?? '∅'}\tp=${p['reglement_page_source'] ?? '∅'}`,
      );
    } catch (e) {
      console.log(`${slug}\tERR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main();

export {};
