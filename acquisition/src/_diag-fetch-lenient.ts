/**
 * _diag-fetch-lenient — $0. Récupère une URL avec le parseur HTTP PERMISSIF de Node.
 *
 * MOTIF : certains hôtes muni renvoient des en-têtes non conformes RFC (retour
 * chariot manquant, en-tête dupliqué…). Le `fetch` global (undici) rend alors un
 * « fetch failed » OPAQUE, et WebFetch un « Parse Error: Missing expected CR after
 * header value » — deux FAUX NÉGATIFS D'OUTIL sur un site parfaitement VIVANT.
 * `NODE_OPTIONS=--insecure-http-parser` ne corrige RIEN car undici embarque son
 * propre llhttp ; il faut passer par `node:https` avec `insecureHTTPParser: true`.
 *
 *   npx tsx acquisition/src/_diag-fetch-lenient.ts --url "<url>" [--grep <regex>] [--max 200] [--links]
 */
import https from "node:https";
import http from "node:http";

function arg(k: string): string | undefined {
  const i = process.argv.indexOf(`--${k}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function get(url: string, depth = 0): Promise<{ status: number; type: string; body: string; url: string }> {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error("trop de redirections"));
    const mod = url.startsWith("http://") ? http : https;
    const req = mod.request(
      url,
      { insecureHTTPParser: true, headers: { "User-Agent": UA, Accept: "*/*" } },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && loc) {
          res.resume();
          return resolve(get(new URL(loc, url).toString(), depth + 1));
        }
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            type: String(res.headers["content-type"] ?? "-"),
            body: Buffer.concat(chunks).toString("utf8"),
            url,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const url = arg("url");
if (!url) throw new Error("--url requis");
const res = await get(url);
console.log(`# HTTP ${res.status} ${res.type} ${res.body.length} chars ${res.url}`);

// --links : imprime texte + href de chaque <a> (équivalent _html-links-dump)
if (process.argv.includes("--links")) {
  const re = arg("match") ? new RegExp(arg("match")!, "i") : null;
  let n = 0;
  for (const m of res.body.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const text = m[2].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    if (re && !re.test(`${text} ${href}`)) continue;
    console.log(`${text}\t${href}`);
    n++;
  }
  console.log(`# ${n} ancres affichées`);
  process.exit(0);
}

const grep = arg("grep");
const max = parseInt(arg("max") ?? "300", 10);
const re = grep ? new RegExp(grep, "i") : null;
let n = 0;
for (const l of res.body.split("\n")) {
  if (re && !re.test(l)) continue;
  console.log(l);
  if (++n >= max) { console.log("# …tronqué"); break; }
}
console.log(`# ${n} lignes imprimées`);
