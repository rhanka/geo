/**
 * _pv-index-sample-probe.ts — QU'EST-CE QUE COMPTE le corpus PV ?
 *
 * Le KPI annonce 65 854 « documents PV » sur 1 106 villes, là où l'ordre de
 * grandeur attendu était ~6 000. L'écart d'un facteur dix se tranche en lisant
 * ce qu'un index contient RÉELLEMENT, pas en raisonnant sur son nom : un
 * `registry/qc-pv/<slug>/index.json` peut lister tous les documents trouvés sur
 * la page des procès-verbaux — ordres du jour, annexes, règlements, avis — et
 * pas seulement les PV.
 *
 * Lecture seule stricte. N'écrit rien, ne classe rien : elle montre les titres et
 * les URL pour qu'on VOIE ce qui est compté.
 *
 * Usage :
 *   NODE_OPTIONS=--dns-result-order=ipv4first AWS_MAX_ATTEMPTS=10 \
 *     npx tsx acquisition/src/_pv-index-sample-probe.ts --slugs sutton,laval
 */
import { getBytes, s3Client } from "./lib/s3.js";

interface Entry { url?: unknown; title?: unknown; publishedAt?: unknown }

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--slugs");
  const slugs = (i >= 0 ? argv[i + 1] ?? "" : "").split(",").map((s) => s.trim()).filter(Boolean);
  if (slugs.length === 0) throw new Error("usage: --slugs a,b,c");
  const s3 = s3Client();

  for (const slug of slugs) {
    const key = `registry/qc-pv/${slug}/index.json`;
    let parsed: unknown;
    try {
      parsed = JSON.parse((await getBytes(s3, key)).toString("utf8"));
    } catch (error) {
      console.log(JSON.stringify({ slug, error: error instanceof Error ? error.message : String(error) }));
      continue;
    }
    const record = parsed as Record<string, unknown>;
    // Le manifeste peut porter ses entrees sous plusieurs cles selon le runner
    // qui l'a depose : on ne suppose pas laquelle, on montre ce qu'on trouve.
    const arrayKey = Object.keys(record).find((k) => Array.isArray(record[k]));
    const entries = (arrayKey ? record[arrayKey] : []) as Entry[];
    console.log(JSON.stringify({
      slug,
      cles_du_manifeste: Object.keys(record),
      cle_du_tableau: arrayKey ?? null,
      nb_entrees: entries.length,
      echantillon: entries.slice(0, 6).map((e) => ({
        titre: str(e.title),
        publie: str(e.publishedAt),
        url: (str(e.url) ?? "").slice(0, 110),
      })),
    }, null, 1));
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
