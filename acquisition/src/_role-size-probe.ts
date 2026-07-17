/**
 * _role-size-probe.ts -- HEAD the MAMH rôle XML of one or more code_geo and
 * report the payload size against Node's max string length.
 *
 * Diagnostic only (no download, no write): tells whether `parseRole`'s
 * `xmlBytes.toString()` (role-foncier.ts) can represent the file at all, which
 * is the difference between "re-run the enrichment" and "needs a streaming
 * parser".
 *
 * Usage:
 *   tsx src/_role-size-probe.ts 66023 65005 --millesime 2026
 */
export {}; // module scope: the `_*.ts` probes otherwise share one global scope

const MAX_STRING = 0x1fffffe8; // Node's hard cap on a single string (~512 MiB)

function argOf(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? String(process.argv[i + 1] ?? fallback) : fallback;
}

async function probeMain(): Promise<void> {
  const millesime = parseInt(argOf("millesime", "2026"), 10);
  const codes = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  if (codes.length === 0) throw new Error("pass at least one code_geo");

  for (const code of codes) {
    const url = `https://donneesouvertes.affmunqc.net/role/RL${code}_${millesime}.xml`;
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) {
        console.log(`${code}\tHTTP ${res.status}\t${url}`);
        continue;
      }
      const len = Number(res.headers.get("content-length") ?? 0);
      const mib = len / 1024 / 1024;
      const overflows = len > MAX_STRING;
      console.log(
        `${code}\tbytes=${len}\t${mib.toFixed(1)} MiB\t` +
          `max_string=${(MAX_STRING / 1024 / 1024).toFixed(0)} MiB\t` +
          `toString()=${overflows ? "OVERFLOWS -> streaming required" : "ok"}`,
      );
    } catch (e) {
      console.log(`${code}\tERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

probeMain().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
