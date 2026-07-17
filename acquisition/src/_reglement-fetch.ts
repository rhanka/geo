/**
 * _reglement-fetch.ts — télécharge les PDF de règlement (lane PROVENANCE P0_1)
 * listés dans _reglement-shard<N>-actionable.json vers un dossier local, pour
 * lecture VERBATIM par pdftotext. Ne garde que les URL .pdf directes (les pages
 * de portail / non-disponible sont ignorées: pas de découverte à l'aveugle).
 *
 * Usage: npx tsx src/_reglement-fetch.ts --in <actionable.json> --out <dir> [--slugs a,b,c]
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
  const targets = items.filter((it) => {
    if (only.length && !only.includes(it.slug)) return false;
    const u = it.url.split("?")[0].toLowerCase();
    return u.endsWith(".pdf");
  });
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
