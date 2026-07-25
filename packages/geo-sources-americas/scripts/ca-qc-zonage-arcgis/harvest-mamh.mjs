#!/usr/bin/env node
/**
 * Harvester voie 2 — annuaire MAMH.
 *
 * Consomme /home/antoinefa/src/_acquisition-shared/qc-municipal-directory.json
 * (produit par l'agent A4 : slug → website officiel, 1076 villes). Pour chaque
 * ville, dérive des hôtes ArcGIS candidats à partir du domaine officiel
 * (domaine + sous-domaines gis./carte./geo./sig./map.), sonde
 * /arcgis/rest/services et /server/rest/services, descend 1 niveau de dossier,
 * filtre les services de zonage, et VÉRIFIE live via lib.mjs (même filtre QC
 * géométrique + champ code de zone que la voie AGOL).
 *
 * Politesse : 1-2 hôtes sondés par ville, 2 suffixes, pas de force-browse,
 * timeout 8 s, UA honnête, pas de retry sur 403/404, délai inter-requête.
 *
 * Idempotence : fusionne dans le même registre partagé (par serviceUrl). Saute
 * les villes dont le slug est déjà couvert (sauf --force).
 *
 * Usage :
 *   node scripts/ca-qc-zonage-arcgis/harvest-mamh.mjs [--limit N] [--force]
 */

import { readFile } from "node:fs/promises";
import {
  politeFetchJson, probeCatalog, verifyService, writeSharedRegistry,
  readJsonArray, ZONAGE_NAME_OK, ZONAGE_NAME_EXCLUDE, ARCGIS_SERVER_SUFFIXES,
  SHARED_OUT,
} from "./lib.mjs";

const DIRECTORY =
  "/home/antoinefa/src/_acquisition-shared/qc-municipal-directory.json";

/** Dérive des hôtes ArcGIS candidats depuis un website officiel. */
function candidateHosts(website) {
  let host;
  try {
    host = new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return [];
  }
  const subs = ["gis", "carte", "cartes", "geo", "sig", "map", "maps", "geomatique"];
  const hosts = [host, ...subs.map((s) => `${s}.${host}`)];
  // dédup en gardant l'ordre
  return [...new Set(hosts)].map((h) => `https://${h}`);
}

/** Sonde une ville → URL de service zonage candidate vérifiée, ou null. */
async function probeCity(entry) {
  const hosts = candidateHosts(entry.website);
  for (const origin of hosts) {
    for (const suffix of ARCGIS_SERVER_SUFFIXES) {
      const catalogUrl = `${origin}${suffix}`;
      let cat;
      try {
        cat = await probeCatalog(catalogUrl);
      } catch {
        cat = null;
      }
      if (!cat) continue;

      // services racine + 1 niveau de dossier
      const serviceRefs = [];
      for (const s of cat.services) {
        const hay = s.name;
        if (ZONAGE_NAME_OK.test(hay) && !ZONAGE_NAME_EXCLUDE.test(hay)) {
          serviceRefs.push({ name: s.name, type: s.type, base: cat.base });
        }
      }
      // descendre dans les dossiers dont le nom évoque zonage/urbanisme,
      // sinon 1-2 dossiers max pour rester poli
      const zonageFolders = cat.folders.filter((f) => ZONAGE_NAME_OK.test(f));
      const foldersToProbe = zonageFolders.length > 0 ? zonageFolders : cat.folders.slice(0, 2);
      for (const folder of foldersToProbe) {
        let sub;
        try {
          sub = await probeCatalog(`${catalogUrl}/${folder}`);
        } catch {
          sub = null;
        }
        if (!sub) continue;
        for (const s of sub.services) {
          const hay = s.name;
          if (ZONAGE_NAME_OK.test(hay) && !ZONAGE_NAME_EXCLUDE.test(hay)) {
            serviceRefs.push({ name: s.name, type: s.type, base: catalogUrl });
          }
        }
      }

      for (const ref of serviceRefs) {
        // name peut déjà inclure le dossier (ex. "urba/zonage")
        const serviceUrl = `${ref.base.replace(/\/+$/, "")}/${ref.name}/${ref.type}`;
        let res = null;
        try {
          res = await verifyService(serviceUrl, {
            title: ref.name,
            owner: entry.name,
          });
        } catch {
          res = null;
        }
        if (res) return res;
      }
    }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const limit = Number(
    (args.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1] ?? Infinity,
  );
  const force = args.includes("--force");

  const dir = JSON.parse(await readFile(DIRECTORY, "utf8"));
  const entries = Object.values(dir.entries ?? {}).filter(
    (e) => e && typeof e === "object" && e.website,
  );
  console.error(`[mamh] ${entries.length} villes avec website officiel`);

  // slugs déjà couverts (idempotence vs registre partagé)
  const existing = await readJsonArray(SHARED_OUT);
  const coveredSlugs = new Set(existing.map((e) => e.citySlug));
  console.error(`[mamh] ${coveredSlugs.size} slugs déjà couverts (skip sauf --force)`);

  const verifiedByUrl = new Map();
  let probed = 0;
  let foundThisRun = 0;

  for (const entry of entries) {
    if (probed >= limit) break;
    if (!force && coveredSlugs.has(entry.slug)) continue;
    probed++;
    let res = null;
    try {
      res = await probeCity(entry);
    } catch {
      res = null;
    }
    if (res) {
      const ep = {
        citySlug: entry.slug,
        serviceUrl: res.serviceUrl,
        zoneCodeField: res.zoneCodeField,
        verifiedAt: new Date().toISOString(),
        source: "mamh-domain-probe",
        meta: {
          title: res.title,
          owner: res.owner,
          layerName: res.layerName,
          geometryType: res.geometryType,
          website: entry.website,
        },
      };
      verifiedByUrl.set(ep.serviceUrl, ep);
      foundThisRun++;
      console.error(`[mamh]   ✓ ${entry.slug} — ${res.serviceUrl} (champ: ${res.zoneCodeField})`);
      if (verifiedByUrl.size % 5 === 0) {
        const total = await writeSharedRegistry([...verifiedByUrl.values()]);
        console.error(`[mamh]   …flush : ${total} endpoints au total`);
      }
    }
    if (probed % 50 === 0) {
      console.error(`[mamh] progress: ${probed} villes sondées, ${foundThisRun} trouvées`);
    }
  }

  const total = await writeSharedRegistry([...verifiedByUrl.values()]);
  console.error(
    `\n[mamh] TERMINÉ — ${foundThisRun} endpoints vérifiés ce lot (${probed} villes sondées) ; ` +
      `${total} au total dans ${SHARED_OUT}`,
  );
  console.log(
    JSON.stringify({
      probed,
      verifiedThisRun: foundThisRun,
      totalInRegistry: total,
    }),
  );
}

main().catch((e) => {
  console.error("[mamh] FATAL", e);
  process.exit(1);
});
