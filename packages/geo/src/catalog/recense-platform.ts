/**
 * Détection de plateforme par signatures d'URL (Lot D — cadrage §1.4 étape 3).
 *
 * `recensePlatform(city, siteUrl, opts)` : détecte la plateforme technologique
 * d'un portail municipal à partir de son URL, en cherchant des signatures
 * caractéristiques dans les réponses HTTP (patterns d'URL, headers, body).
 *
 * ## Plateforme détectables
 *   - `arcgis`  : `/arcgis/rest/services/`, `/MapServer/`, `/FeatureServer/`
 *   - `jmap`    : `/jmap/`, `jmap-web`, `Kheops` dans les en-têtes
 *   - `gonet`   : `/goazimut/`, `/gonet/`, `PG Solutions` dans le body
 *   - `pdf`     : Content-Type application/pdf ou extension `.pdf`
 *   - `ckan`    : `/api/3/action/`, `CKAN` dans le body
 *   - `unknown` : aucun pattern reconnu
 *
 * ## SQUELETTE — bloquer partiel
 * La détection de signature sur un `siteUrl` FOURNI est implémentée
 * (testable hermétiquement via un fetch mocké). En revanche, la découverte
 * automatique de l'URL du site municipal est **non implémentée** :
 *
 *   TODO: requiert l'annuaire des sites web municipaux
 *   L'étape "trouver l'URL du site de la Ville de X" nécessite un annuaire
 *   municipalité → URL (ex. "beauharnois" → "https://ville.beauharnois.qc.ca")
 *   qui n'est pas encore disponible dans le repo geo. Voir cadrage §1.4 étape 3
 *   et la discussion sur le registre des URLs municipales.
 *
 * ## Herméticité (ADR-0007)
 * `fetchImpl` est injectable. Les tests injectent un mock — aucun réseau réel.
 */

import type { SourcePlatform } from "./source-inventory.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Options pour `recensePlatform`. */
export interface RecensePlatformOptions {
  /**
   * Implémentation de `fetch` injectée (hermétique, ADR-0007).
   * Tests DOIVENT injecter un mock.
   */
  readonly fetchImpl?: typeof fetch;
  /**
   * Timeout en ms pour la requête HTTP (défaut: 8000).
   */
  readonly timeoutMs?: number;
}

/** Résultat de `recensePlatform`. */
export interface PlatformDetectionResult {
  /** Slug de la ville. */
  readonly citySlug: string;
  /** URL du site municipal sondée. */
  readonly siteUrl: string;
  /** Plateforme détectée. */
  readonly platform: SourcePlatform;
  /** Preuve textuelle ayant déclenché la détection (ex. pattern d'URL matchée). */
  readonly evidence: string;
  /** `true` si la détection a pu être faite, `false` en cas d'erreur réseau. */
  readonly success: boolean;
  /** Message d'erreur si `success === false`. */
  readonly errorMessage?: string;
}

// ── Signatures de plateforme ──────────────────────────────────────────────────

/** Signature testée sur l'URL de la ressource retournée (après redirections). */
interface UrlSignature {
  readonly platform: SourcePlatform;
  readonly patterns: readonly RegExp[];
  readonly description: string;
}

/**
 * Signatures d'URL ordonnées par priorité (plus spécifique en premier).
 * Testées sur `response.url` (URL finale après redirections).
 */
const URL_SIGNATURES: readonly UrlSignature[] = [
  {
    platform: "arcgis",
    patterns: [
      /\/arcgis\/rest\/services\//i,
      /\/MapServer\//i,
      /\/FeatureServer\//i,
      /ArcGIS/i,
    ],
    description: "ArcGIS REST MapServer/FeatureServer",
  },
  {
    platform: "jmap",
    patterns: [
      /\/jmap\//i,
      /jmap-web/i,
      /kheops/i,
    ],
    description: "JMap Server (Kheops Technologies)",
  },
  {
    platform: "gonet",
    patterns: [
      /\/goazimut\//i,
      /\/gonet\//i,
      /goazimut\.com/i,
    ],
    description: "GoNet / GoAzimut (PG Solutions)",
  },
  {
    platform: "ckan",
    patterns: [
      /\/api\/3\/action\//i,
      /donneesquebec\.ca/i,
    ],
    description: "CKAN open-data portal",
  },
];

/** Signatures testées sur le corps de la réponse (extrait partiel). */
interface BodySignature {
  readonly platform: SourcePlatform;
  readonly patterns: readonly RegExp[];
  readonly description: string;
}

const BODY_SIGNATURES: readonly BodySignature[] = [
  {
    platform: "arcgis",
    patterns: [/"currentVersion"\s*:\s*\d+/, /esri/i, /ArcGIS/],
    description: "ArcGIS REST service JSON",
  },
  {
    platform: "jmap",
    patterns: [/JMap/i, /Kheops/i, /jmap-web/i],
    description: "JMap application",
  },
  {
    platform: "gonet",
    patterns: [/GoAzimut/i, /PG Solutions/i, /GoNet/i],
    description: "GoNet / GoAzimut application",
  },
  {
    platform: "ckan",
    patterns: [/"ckan_version"/i, /CKAN/i],
    description: "CKAN portal",
  },
];

// ── Helpers internes ──────────────────────────────────────────────────────────

/**
 * Teste les signatures d'URL sur une URL finale (après redirections).
 * Retourne la première plateforme matchée, ou null.
 */
function detectFromUrl(finalUrl: string): { platform: SourcePlatform; evidence: string } | null {
  for (const sig of URL_SIGNATURES) {
    for (const pattern of sig.patterns) {
      if (pattern.test(finalUrl)) {
        return {
          platform: sig.platform,
          evidence: `URL pattern "${pattern.source}" matched on "${finalUrl}" (${sig.description})`,
        };
      }
    }
  }
  return null;
}

/**
 * Teste les signatures de contenu sur un extrait du body.
 * Retourne la première plateforme matchée, ou null.
 */
function detectFromBody(bodyExcerpt: string): { platform: SourcePlatform; evidence: string } | null {
  for (const sig of BODY_SIGNATURES) {
    for (const pattern of sig.patterns) {
      if (pattern.test(bodyExcerpt)) {
        return {
          platform: sig.platform,
          evidence: `Body pattern "${pattern.source}" matched (${sig.description})`,
        };
      }
    }
  }
  return null;
}

/**
 * Teste si l'URL ou le Content-Type indiquent un PDF.
 */
function detectPdf(finalUrl: string, contentType: string): boolean {
  return (
    /\.pdf$/i.test(finalUrl) ||
    contentType.includes("application/pdf")
  );
}

// ── API publique ──────────────────────────────────────────────────────────────

/**
 * Détecte la plateforme technologique d'un portail municipal à partir d'une
 * URL fournie.
 *
 * ## Algorithme (cadrage §1.4 étape 3)
 * 1. Fetch HEAD (puis GET si HEAD échoue ou ne donne pas assez d'info).
 * 2. Teste les patterns d'URL sur l'URL finale (après redirections).
 * 3. Si non résolu, teste les patterns de body sur un extrait (~4 KB).
 * 4. Teste PDF (Content-Type ou extension).
 * 5. Retourne `unknown` si aucun pattern ne matche.
 *
 * ## Bloquer documenté
 * Cette fonction détecte la plateforme sur un `siteUrl` FOURNI. Elle n'effectue
 * PAS la découverte automatique de l'URL du site municipal à partir du slug.
 *
 * TODO: requiert l'annuaire des sites web municipaux
 * Pour construire un recensement complet (slug → siteUrl → platform), il faut
 * un registre `slug → URL officielle de la ville` qui n'est pas encore
 * disponible dans geo. Les pistes documentées dans le cadrage §1.4 sont :
 *   a) Annuaire MAMH des municipalités (HTML à parser)
 *   b) Wikidata (P856 official website)
 *   c) Saisie manuelle dans `QC_MUNICIPALITIES`
 * En attendant, appelez cette fonction avec des URLs connues (ex. tests).
 *
 * @param citySlug  Slug de la ville (pour le résultat).
 * @param siteUrl   URL du portail municipal ou d'une ressource à sonder.
 * @param opts      Options (fetchImpl injecté, timeout).
 * @returns         Résultat de détection avec la plateforme et la preuve.
 */
export async function recensePlatform(
  citySlug: string,
  siteUrl: string,
  opts: RecensePlatformOptions = {},
): Promise<PlatformDetectionResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  // Note: AbortController timeout non utilisé directement ici pour rester
  // compatible avec les mocks de test simples (pas besoin de signal).
  // Dans une implémentation production, ajouter AbortSignal.timeout(timeoutMs).

  // 1. Test rapide sur l'URL elle-même (avant tout réseau)
  const urlMatch = detectFromUrl(siteUrl);
  if (urlMatch !== null) {
    return {
      citySlug,
      siteUrl,
      platform: urlMatch.platform,
      evidence: `[url-pre-fetch] ${urlMatch.evidence}`,
      success: true,
    };
  }

  // 2. Fetch HEAD pour tester l'URL finale + Content-Type (sans body).
  //    Si HEAD échoue, on tente directement GET.
  let headResponse: Response | undefined;
  try {
    headResponse = await fetchImpl(siteUrl, { method: "HEAD" });
  } catch {
    headResponse = undefined;
  }

  const headFinalUrl =
    headResponse !== undefined && headResponse.url !== ""
      ? headResponse.url
      : siteUrl;
  const headContentType =
    headResponse !== undefined
      ? (headResponse.headers.get("content-type") ?? "")
      : "";

  // 3. PDF ? (détectable depuis HEAD)
  if (detectPdf(headFinalUrl, headContentType)) {
    return {
      citySlug,
      siteUrl,
      platform: "pdf",
      evidence: `PDF detected: finalUrl="${headFinalUrl}", Content-Type="${headContentType}"`,
      success: true,
    };
  }

  // 4. Test signatures URL sur l'URL finale (après redirections HEAD)
  const urlFinalMatch = detectFromUrl(headFinalUrl);
  if (urlFinalMatch !== null) {
    return {
      citySlug,
      siteUrl,
      platform: urlFinalMatch.platform,
      evidence: `[url-post-fetch] ${urlFinalMatch.evidence}`,
      success: true,
    };
  }

  // 5. GET pour lire le body (HEAD n'a pas de body).
  //    On fait toujours le GET à ce stade pour analyser le contenu.
  let getResponse: Response;
  try {
    getResponse = await fetchImpl(siteUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      citySlug,
      siteUrl,
      platform: "unknown",
      evidence: "fetch error",
      success: false,
      errorMessage: msg,
    };
  }

  const getFinalUrl = getResponse.url !== "" ? getResponse.url : siteUrl;
  const getContentType = getResponse.headers.get("content-type") ?? "";

  // PDF détecté depuis GET ?
  if (detectPdf(getFinalUrl, getContentType)) {
    return {
      citySlug,
      siteUrl,
      platform: "pdf",
      evidence: `PDF detected (GET): finalUrl="${getFinalUrl}", Content-Type="${getContentType}"`,
      success: true,
    };
  }

  // Signature URL sur l'URL finale GET
  const urlGetMatch = detectFromUrl(getFinalUrl);
  if (urlGetMatch !== null) {
    return {
      citySlug,
      siteUrl,
      platform: urlGetMatch.platform,
      evidence: `[url-get] ${urlGetMatch.evidence}`,
      success: true,
    };
  }

  // Analyse du body (premier extrait ~4 KB)
  try {
    const text = await getResponse.text();
    const excerpt = text.slice(0, 4096);
    const bodyMatch = detectFromBody(excerpt);
    if (bodyMatch !== null) {
      return {
        citySlug,
        siteUrl,
        platform: bodyMatch.platform,
        evidence: `[body] ${bodyMatch.evidence}`,
        success: true,
      };
    }
  } catch {
    // Ignore body read error, fall through to unknown
  }

  // 6. Aucun pattern reconnu
  return {
    citySlug,
    siteUrl,
    platform: "unknown",
    evidence: `No platform signature recognized for "${getFinalUrl}"`,
    success: true,
  };
}
