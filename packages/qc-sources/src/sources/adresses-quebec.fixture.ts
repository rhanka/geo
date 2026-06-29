import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * REAL committed terrAPI / Adresses Québec FeatureCollection fixtures for the
 * adapter tests.
 *
 * NOTHING here is fabricated: both accessors return verbatim first-records
 * excerpts of the live terrAPI `municipalites/<code>/adresses?geometry=0`
 * responses, committed under the spike's `samples/` directory (the SAME bytes
 * the deterministic seed-ontology path reuses). The fixture only re-reads those
 * committed files so the RECUEIL adapter can be unit-tested against REAL bytes
 * with no network call.
 *
 *   - terrapi-adresses-salaberry.json  — Salaberry-de-Valleyfield (70052):
 *     "24 rue Paquette, …", "561 avenue de Grande-Île, …", "310 boulevard Pie-XII, …".
 *   - terrapi-adresses-beauharnois.json — Beauharnois (70022):
 *     "279 chemin Saint-Louis, …", "28 rue Trudeau, …", "568 2 rue Richard, …".
 *
 * The committed sample was fetched with `geometry=0`, so it carries NO geometry
 * coordinates and NO lot numbers (HONEST: the Adresse geom stays null downstream).
 *
 * BOOT-SAFETY: the reads are LAZY (deferred to first access, then memoized).
 * Importing this module — and therefore the @geo/qc-sources barrel and anything
 * that re-exports it — performs NO filesystem access, so the production API can
 * boot without shipping the dev `_spikes/.../samples/` bytes. The read only
 * happens when a fixture value is actually requested (tests, sample-seeding).
 */

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = join(
  here,
  "_spikes",
  "adresses-quebec-igo-geocoder",
  "samples",
);

/** Lazily read + memoize a committed sample file (no read at import time). */
function lazySample(name: string): () => string {
  let cached: string | undefined;
  return () => {
    if (cached === undefined) {
      cached = readFileSync(join(SAMPLES_DIR, name), "utf-8");
    }
    return cached;
  };
}

/** Verbatim Salaberry-de-Valleyfield (70052) terrAPI addresses — committed bytes (lazy). */
export const adressesQuebecValleyfieldJson = lazySample(
  "terrapi-adresses-salaberry.json",
);

/** Verbatim Beauharnois (70022) terrAPI addresses — committed bytes (lazy). */
export const adressesQuebecBeauharnoisJson = lazySample(
  "terrapi-adresses-beauharnois.json",
);
