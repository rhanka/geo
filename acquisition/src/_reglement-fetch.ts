/**
 * _reglement-fetch.ts — télécharge les PDF de règlement (lane PROVENANCE P0_1)
 * listés dans _reglement-shard<N>-actionable.json vers un dossier local, pour
 * lecture VERBATIM par pdftotext. Ne garde que les URL .pdf directes (les pages
 * de portail / non-disponible sont ignorées: pas de découverte à l'aveugle).
 *
 * ⛔ ANGLE MORT CORRIGÉ: le filtre `.pdf` écartait SILENCIEUSEMENT les gabarits
 * «centre documentaire» à URL opaque (saint-casimir.com/file-23022,
 * saint-lucien.ca/file-19067, cdn.gestionweblex.ca/files/<id>) qui répondent
 * pourtant `200 application/pdf`. Désormais les écartés sont TOUJOURS listés
 * (SKIP), et `--allow-non-pdf` les télécharge — la signature `%PDF-` reste le
 * juge (les soft-404 HTML ressortent en `NOT-PDF!`).
 *
 * Usage: npx tsx src/_reglement-fetch.ts --in <actionable.json> --out <dir> [--slugs a,b,c] [--allow-non-pdf]
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

function arg(argv: string[], k: string): string | undefined {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const inPath = arg(argv, "in")!;
  const outDir = arg(argv, "out")!;
  const only = (arg(argv, "slugs") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  mkdirSync(outDir, { recursive: true });
  const items = JSON.parse(readFileSync(inPath, "utf8")) as Array<{ slug: string; url: string }>;
  const allowNonPdf = argv.includes("--allow-non-pdf");
  const scoped = items.filter((it) => !only.length || only.includes(it.slug));
  const targets = scoped.filter((it) => allowNonPdf || it.url.split("?")[0].toLowerCase().endsWith(".pdf"));
  for (const it of scoped) {
    if (!targets.includes(it)) console.log(`SKIP ${it.slug} (URL sans .pdf) ${it.url} — relancer avec --allow-non-pdf`);
  }
  console.log(`fetch ${targets.length} PDF -> ${outDir}`);
  for (const { slug, url } of targets) {
    const dest = resolve(outDir, `${slug}.pdf`);
    try {
      const r = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          Accept: "application/pdf,*/*",
        },
      });
      if (!r.ok) { console.log(`FAIL ${slug} HTTP ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const head = buf.subarray(0, 5).toString("latin1");
      writeFileSync(dest, buf);
      console.log(`OK   ${slug} bytes=${buf.length} head=${head} ${head === "%PDF-" ? "" : "(NOT-PDF!)"}`);
    } catch (e) {
      console.log(`ERR  ${slug} ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
