/**
 * _reglprov-cms-flux-probe.ts — sonde READ-ONLY, $0, lane P0_1 (provenance règlement).
 *
 * POURQUOI: [[cms-flux-natif-vs-page-muette]] — « la muni ne diffuse pas » est
 * presque toujours un ANGLE MORT D'OUTIL. `_html-links-dump` ne lit que les
 * ancres `<a href>`; or plusieurs CMS ne mettent AUCUNE ancre PDF dans la page:
 *   - WP Download Manager  -> lien dans `data-downloadurl` d'un `<a href="#">`
 *   - WebLex               -> aucun lien, seulement un `listid` (flux .ashx)
 *   - VPlus/Modellium      -> coquille SPA, tout est dans /structure/tree
 *   - csp20                -> PublicHandler.aspx
 *   - ColdFusion (Radium)  -> handlers `index.cfm?DocumentID=`, `file.cfm`
 * ⇒ conclure « non-diffusion » depuis les seules ancres est un FAUX NÉGATIF.
 *
 * Cette sonde ne décide RIEN et n'extrait AUCUN numéro. Elle mesure trois faits:
 *   1. la requête réelle (URL effective après redirections, statut, octets) —
 *      démasque le piège « 302 vers www. non suivi » (183 o = fausse coquille);
 *   2. les SIGNATURES de flux natif présentes dans le HTML BRUT;
 *   3. TOUTES les chaînes d'URL du HTML brut (href, src, data-*, JS, onclick),
 *      pas seulement les ancres — c'est là que vivent les PDF cachés.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-cms-flux-probe.ts --url <url> [--match <regex>] [--all]
 */
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

/** Signatures de flux natif de CMS: le nom -> motif à chercher dans le HTML brut. */
const FLUX_SIGNATURES: Array<[string, RegExp]> = [
  ["WPDM data-downloadurl", /data-downloadurl\s*=\s*["']([^"']+)/gi],
  ["WebLex listid", /listid["'\s:=]+([0-9a-f-]{4,})/gi],
  ["WP REST (wp-json)", /\/wp-json\/[\w/]+/gi],
  ["VPlus structure/tree", /structure\/(?:tree|detail)[^"'\s]*/gi],
  ["csp20 PublicHandler", /PublicHandler\.aspx[^"'\s]*/gi],
  ["ColdFusion DocumentID", /[?&](?:DocumentID|DocID|FileID)=\d+/gi],
  ["centre-doc /file-N", /\/file-\d+/gi],
  ["download/getfile handler", /\/(?:download|getfile|viewdoc|telecharger)[^"'\s]{0,60}/gi],
];

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

async function main(): Promise<void> {
  const url = arg("url");
  if (!url) {
    console.error("usage: --url <url> [--match <regex>] [--all]");
    process.exit(2);
  }
  const match = arg("match");
  const showAll = process.argv.includes("--all");

  let html = "";
  let finalUrl = url;
  let status = 0;
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
    });
    status = r.status;
    finalUrl = r.url;
    html = await r.text();
  } catch (e) {
    console.log(`FETCH-ERROR ${(e as Error).message}`);
    console.log("⇒ erreur OPAQUE possible (undici strict): re-tester _diag-fetch-lenient.ts");
    process.exit(1);
  }

  console.log(`# demandé : ${url}`);
  console.log(`# effectif: ${finalUrl}${finalUrl !== url ? "   <-- REDIRIGÉ (piège 302)" : ""}`);
  console.log(`# HTTP ${status}, ${html.length} octets`);
  if (html.length < 4000) {
    console.log("# ⚠ page très courte: coquille SPA / soft-404 probable — le flux natif est ailleurs");
  }

  console.log("\n## signatures de flux natif");
  let anyFlux = false;
  for (const [name, re] of FLUX_SIGNATURES) {
    const hits = [...new Set([...html.matchAll(re)].map((m) => decode(m[0])))];
    if (hits.length) {
      anyFlux = true;
      console.log(`  ${name}: ${hits.length} occurrence(s)`);
      for (const h of hits.slice(0, 8)) console.log(`      ${h.slice(0, 160)}`);
    }
  }
  if (!anyFlux) console.log("  (aucune) — le HTML rendu porte vraisemblablement ses liens en clair");

  // TOUTES les URL du HTML brut, d'où qu'elles viennent (href, src, data-*, JS).
  const urls = [
    ...new Set(
      [...html.matchAll(/(?:https?:\/\/|\/)[^"'\s<>()]{3,200}/gi)].map((m) => decode(m[0])),
    ),
  ];
  const pdfs = urls.filter((u) => /\.pdf(\?|$)/i.test(u));
  console.log(`\n## URL brutes: ${urls.length}   dont .pdf: ${pdfs.length}`);
  const re = match ? new RegExp(match, "i") : null;
  const shown = (showAll ? urls : pdfs).filter((u) => !re || re.test(u));
  for (const u of shown) console.log(`  ${u}`);
  if (re) console.log(`# (filtre /${match}/i appliqué)`);
}

void main();
