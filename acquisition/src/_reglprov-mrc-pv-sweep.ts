/**
 * _reglprov-mrc-pv-sweep.ts — sonde READ-ONLY, $0, lane P0_1 (provenance règlement).
 *
 * POURQUOI (gisement neuf): plusieurs HOLD-NULL sont motivés « la MUNICIPALITÉ ne
 * diffuse aucun règlement d'urbanisme » — verdict mesuré et exact sur le site de la
 * MUNI. Mais la muni n'est pas le seul PUBLIEUR de son propre numéro de zonage: la
 * **MRC** doit délivrer un CERTIFICAT DE CONFORMITÉ à tout règlement d'urbanisme de
 * ses municipalités, et la résolution qui l'accorde NOMME le règlement verbatim
 * («... le règlement numéro 2XX de la Municipalité de Y modifiant son règlement de
 * zonage numéro Z ...»). Ce texte vit dans les PROCÈS-VERBAUX du conseil des maires.
 *
 * ⚠ Différence avec `_reglprov-pv-grep.ts`, qui ne le couvre PAS: celui-là balaye le
 * corpus PV de la MUNI, déjà acquis sur disque. Ici la source est un TIERS (la MRC),
 * en ligne, jamais acquis — et un seul balayage sert TOUTES les munis de la MRC.
 *
 * ⚠ Ne pas confondre avec le CENTRE DOCUMENTAIRE d'une MRC, qui ne publie que le
 * régional + les TNO ([[mrc-centre-documentaire-vs-portail-regroupement]]). Le PV du
 * conseil, lui, parle des munis membres.
 *
 * La sonde ne décide RIEN et n'écrit RIEN: elle imprime les lignes VERBATIM avec le
 * fichier et la PAGE, pour que l'opérateur applique lui-même l'owner-gate et écarte
 * les amendements ([[reglement-numero-url-trap]]).
 *
 * ⭐ MODE `--cdx`: une MRC ne LIE souvent que les 2-3 dernières années de PV, alors que
 * les fichiers plus anciens restent SERVIS à leur URL (ils sont juste orphelins de
 * navigation). Le CDX de Wayback rend la LISTE de ces URL; on retente alors le site
 * VIVANT d'abord (non tronqué), et Wayback seulement en repli — l'inverse ferait tomber
 * dans la troncature à 1 MiB ([[wayback-1mib-truncation-range-fix]]).
 *
 * ⛔⭐ MODE `--depth 2` — FAUX NÉGATIF DE FAMILLE, mesuré sur la MRC de Pontiac: sa page
 * « Procès-verbaux du conseil » (plugin WordPress **Events Manager**) ne porte AUCUN lien
 * PDF — elle ne liste que des pages `/events/<slug>/`, et c'est LA PAGE D'ÉVÉNEMENT qui
 * porte le PV. Un `--index` à un seul saut y rapporte « 0 PDF », d'où l'on conclurait
 * « la MRC ne diffuse pas ses PV » alors qu'il y en a 110. `--depth 2` fait le deuxième
 * saut (liens HTML du même hôte), ce qui rattrape toute la famille index → fiche → PDF.
 *
 * Usage:
 *   npx tsx acquisition/src/_reglprov-mrc-pv-sweep.ts --index <url-page-PV> [--index <url2> ...] \
 *       [--munis "Chazel,Roquemaure"] [--re "zonage"] [--max 60] [--ctx 1] \
 *       [--depth 2] [--follow-max 60] [--follow-re "events|seance"]
 *   npx tsx acquisition/src/_reglprov-mrc-pv-sweep.ts --cdx "mrcao.qc.ca/documents/pages/*" \
 *       --cdx-match "minutes" --munis "Chazel" --re "zonage"
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function args(name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === `--${name}`) out.push(process.argv[i + 1]);
  }
  return out;
}
function arg(name: string, def?: string): string | undefined {
  return args(name)[0] ?? def;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.text();
}

/** Toutes les URL .pdf du HTML BRUT (pas seulement les ancres), absolutisées. */
function pdfUrls(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/[^"'\s<>()]+\.pdf\b/gi)) {
    const raw = decode(m[0]);
    try {
      // Les endpoints WP REST rendent des chemins accentués en `è`; sans
      // percent-encoding le GET rate. `new URL` normalise, encodeURI ne suffit pas.
      out.add(new URL(raw, base).href);
    } catch {
      /* ignore */
    }
  }
  return [...out];
}

/** Liens de PAGE du même hôte (pour le 2e saut d'un index sans PDF). */
function pageLinks(html: string, base: string, filter?: RegExp): string[] {
  const host = new URL(base).host;
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)/gi)) {
    const raw = decode(m[1]);
    if (/\.(pdf|jpe?g|png|gif|css|js|zip|docx?|xlsx?)$/i.test(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      continue;
    }
    if (u.host !== host) continue;
    if (filter && !filter.test(u.href)) continue;
    out.add(u.href);
  }
  return [...out];
}

async function tryPdf(url: string, path: string): Promise<boolean> {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA } });
    if (!r.ok) return false;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return false;
    writeFileSync(path, buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le site VIVANT d'abord (non tronqué), Wayback seulement en repli: Wayback coupe à
 * 1 MiB, et un PV tronqué se grep sans erreur — donc silencieusement à faux.
 */
async function download(url: string, dir: string, waybackTs?: string): Promise<string | null> {
  const name = url.split("/").pop()!.replace(/[^\w.-]/g, "_");
  const path = join(dir, name);
  if (existsSync(path)) return path;
  if (await tryPdf(url, path)) return path;
  if (waybackTs) {
    // `id_` = contenu ORIGINAL, sans la barre de navigation réécrite par Wayback.
    const wb = `https://web.archive.org/web/${waybackTs}id_/${url}`;
    if (await tryPdf(wb, path)) return path;
  }
  return null;
}

/** URL + timestamp des captures Wayback correspondant à un motif. */
async function cdxList(
  pattern: string,
  match: string | undefined,
): Promise<Array<{ url: string; ts: string }>> {
  const api =
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pattern)}` +
    `&output=json&collapse=urlkey&fl=original,timestamp&filter=statuscode:200&limit=4000`;
  const r = await fetch(api, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`CDX HTTP ${r.status}`);
  const rows = (await r.json()) as string[][];
  const re = match ? new RegExp(match, "i") : null;
  const out: Array<{ url: string; ts: string }> = [];
  for (const row of rows.slice(1)) {
    const [orig, ts] = row;
    if (!/\.pdf$/i.test(orig)) continue;
    if (re && !re.test(orig)) continue;
    out.push({ url: orig, ts });
  }
  return out;
}

/** Texte natif page par page (pdftotext -layout). Vide => scan sans couche texte. */
function pagesOf(path: string): string[] {
  let txt = "";
  try {
    txt = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", path, "-"], {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch {
    return [];
  }
  return txt.split("\f");
}

async function main(): Promise<void> {
  const indexes = args("index");
  const cdxPatterns = args("cdx");
  const directUrls = args("url");
  if (!indexes.length && !cdxPatterns.length && !directUrls.length) {
    console.error(
      'usage: --index <url> [--index <url2>...] | --cdx "host/path/*" [--cdx-match re]\n' +
        "       | --url <pdf-url> [--url <pdf-url2>...]\n" +
        '       [--munis "A,B"] [--re "zonage"] [--max 60] [--ctx 1]',
    );
    process.exit(2);
  }
  const munis = (arg("munis") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const re = new RegExp(arg("re") ?? "zonage", "i");
  const max = Number(arg("max") ?? "60");
  const ctx = Number(arg("ctx") ?? "1");

  // 1) énumérer les PDF de tous les index (+ des motifs CDX)
  const urls = new Map<string, string | undefined>(); // url -> timestamp Wayback
  // ⭐ `--url`: quand l'index par année N'EXISTE PLUS (les PDF restent servis mais
  // orphelins de navigation) ET que `cdxList` échoue, la liste vient d'ailleurs —
  // typiquement du CDX interrogé en `http://` par `_diag-fetch-lenient.ts`, qui passe
  // là où le `fetch` strict d'ici rend un « fetch failed » OPAQUE (mémoire
  // undici-fetch-failed-parseur-strict-faux-negatif) ou un 504 Wayback transitoire.
  // Sans ce mode, un CDX momentanément indisponible se lit « 0 PDF » = faux négatif.
  for (const u of directUrls) urls.set(u, undefined);
  const depth = Number(arg("depth") ?? "1");
  const followMax = Number(arg("follow-max") ?? "60");
  const followReRaw = arg("follow-re");
  const followRe = followReRaw ? new RegExp(followReRaw, "i") : undefined;
  for (const idx of indexes) {
    try {
      const html = await fetchText(idx);
      const found = pdfUrls(html, idx);
      console.log(`# index ${idx} -> ${found.length} PDF`);
      for (const u of found) if (!urls.has(u)) urls.set(u, undefined);
      if (depth >= 2) {
        const links = pageLinks(html, idx, followRe).slice(0, followMax);
        console.log(`#   depth2: ${links.length} pages suivies`);
        let gained = 0;
        for (const link of links) {
          try {
            const sub = await fetchText(link);
            for (const u of pdfUrls(sub, link)) {
              if (!urls.has(u)) {
                urls.set(u, undefined);
                gained++;
              }
            }
          } catch {
            /* une fiche morte ne condamne pas l'index */
          }
        }
        console.log(`#   depth2: +${gained} PDF que le 1er saut ne voyait PAS`);
      }
    } catch (e) {
      console.log(`# index ${idx} -> ERREUR ${(e as Error).message}`);
    }
  }
  const cdxMatch = arg("cdx-match");
  for (const pat of cdxPatterns) {
    try {
      const found = await cdxList(pat, cdxMatch);
      console.log(`# cdx ${pat} -> ${found.length} PDF archivés`);
      for (const f of found) urls.set(f.url, f.ts);
    } catch (e) {
      console.log(`# cdx ${pat} -> ERREUR ${(e as Error).message}`);
    }
  }
  const list = [...urls.entries()].slice(0, max);
  console.log(`# ${urls.size} PDF distincts, ${list.length} balayés (--max ${max})\n`);

  const dir = join(tmpdir(), "reglprov-mrc-pv");
  mkdirSync(dir, { recursive: true });

  let scanned = 0;
  let noText = 0;
  let hits = 0;
  for (const [url, ts] of list) {
    const path = await download(url, dir, ts);
    if (!path) {
      console.log(`## ${url}  -> NON TÉLÉCHARGEABLE (ou pas un PDF)`);
      continue;
    }
    const pages = pagesOf(path);
    const chars = pages.join("").trim().length;
    if (!chars) {
      // [[plein-texte-aveugle-sur-scan-find0]]: 0 hit sur un scan n'est PAS une absence.
      console.log(`## ${url}  -> NO-TEXT-LAYER (scan) — grep AVEUGLE, ne pas conclure`);
      noText++;
      continue;
    }
    scanned++;
    for (let p = 0; p < pages.length; p++) {
      const lines = pages[p].split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const window = lines.slice(Math.max(0, i - ctx), i + ctx + 1).join(" ");
        if (munis.length && !munis.some((m) => new RegExp(m, "i").test(window))) continue;
        hits++;
        console.log(`\n### ${url.split("/").pop()}  p${p + 1}`);
        for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) {
          console.log(`    ${lines[k].trim()}`);
        }
      }
    }
  }
  console.log(
    `\n# SUMMARY pdf=${list.length} avecTexte=${scanned} sansTexte=${noText} lignes=${hits}`,
  );
  if (noText) console.log(`# ⚠ ${noText} scans NON lus: leur silence ne prouve RIEN`);
}

void main();
