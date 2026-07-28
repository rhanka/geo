/**
 * Classification des entrées d'index PV à partir des seuls champs observables.
 *
 * Ce module ne lit jamais les documents. La confirmation d'un PV reste la
 * lecture de ses octets capturés dans `capture-octets-classification.ts`.
 */

export const PV_OBSERVABLE_CLASSES = [
  "pv_probable",
  "ordre_du_jour",
  "autre_document",
  "non_document",
  "indetermine",
] as const;

export type PvObservableClass = (typeof PV_OBSERVABLE_CLASSES)[number];

export interface PvObservableDocument {
  readonly url: string;
  readonly titles: ReadonlySet<string>;
  readonly selfReference: boolean;
}

export interface PvObservableClassification {
  readonly class: PvObservableClass;
  readonly marker: string;
}

const MEDIA_EXTENSIONS = new Set(["mp3", "m4a", "mp4", "wav", "wma", "mov", "avi", "wmv", "webm", "flv"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "tif", "tiff", "bmp", "svg"]);
const PAGE_LIKE_EXTENSIONS = new Set(["sans_extension", "php", "asp", "aspx", "html", "htm"]);

function decodeLoose(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function fold(value: string): string {
  return decodeLoose(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function tokenText(value: string): string {
  return fold(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function urlObservable(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function extensionOf(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return "url_invalide";
  }
  const match = /\.([a-z0-9]{1,5})$/i.exec(path);
  return match ? match[1]!.toLowerCase() : "sans_extension";
}

function hasSpecificDate(text: string): boolean {
  const raw = fold(text);
  const spaced = tokenText(text);
  const months = "janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre";
  return (
    /\b(?:19|20)\d{2}[-_/ ](?:0?[1-9]|1[0-2])[-_/ ](?:0?[1-9]|[12]\d|3[01])\b/.test(raw) ||
    /\b(?:0?[1-9]|[12]\d|3[01])[-_/ ](?:0?[1-9]|1[0-2])[-_/ ](?:19|20)\d{2}\b/.test(raw) ||
    new RegExp(`\\b(?:0?[1-9]|[12]\\d|3[01])\\s+(?:${months})\\s+(?:19|20)\\d{2}\\b`).test(spaced) ||
    /\b(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\b/.test(spaced) ||
    /\b(?:0[1-9]|[12]\d|3[01])(?:0[1-9]|1[0-2])(?:19|20)\d{2}\b/.test(spaced)
  );
}

function firstMarker(text: string, markers: readonly [string, RegExp][]): string | null {
  for (const [marker, regex] of markers) {
    if (regex.test(text)) return marker;
  }
  return null;
}

function indexPageMarker(urlText: string, titleText: string, extension: string, textHasSpecificDate: boolean): string | null {
  if (!PAGE_LIKE_EXTENSIONS.has(extension)) return null;
  if (/\bf pv (?:19|20)\d{2}\b/.test(urlText)) return "index_page:f-pv-year";
  if (textHasSpecificDate) return null;
  if (/\b(proces verbaux|seances du conseil|conseil municipal)\b/.test(titleText)) return "index_page:title";
  if (/\b(proces verbaux|seances du conseil)\b/.test(urlText) && !/\b(pdf|docx?|ashx)\b/.test(urlText)) {
    return "index_page:url";
  }
  return null;
}

/** Strictly marker-based: no URL extension or content type is a confirmation. */
export function classifyPvObservableDocument(doc: PvObservableDocument): PvObservableClassification {
  const extension = extensionOf(doc.url);
  const urlText = tokenText(urlObservable(doc.url));
  const titleText = [...doc.titles].map((title) => tokenText(title)).join(" ");
  const text = `${urlText} ${titleText}`.trim();
  const textHasSpecificDate = hasSpecificDate(`${urlObservable(doc.url)} ${[...doc.titles].join(" ")}`);

  if (MEDIA_EXTENSIONS.has(extension)) return { class: "non_document", marker: `media_extension:${extension}` };
  if (IMAGE_EXTENSIONS.has(extension)) return { class: "non_document", marker: `image_extension:${extension}` };
  if (doc.selfReference) return { class: "non_document", marker: "index_url_self_reference" };
  const indexMarker = indexPageMarker(urlText, titleText, extension, textHasSpecificDate);
  if (indexMarker !== null) return { class: "non_document", marker: indexMarker };

  const odj = firstMarker(text, [
    ["ordre_du_jour", /\bordre du jour\b/], ["odj", /\bodj\b/], ["avis_de_convocation", /\bavis de convocation\b/],
    ["convocation", /\bconvocation\b/], ["agenda", /\bagendas?\b/],
  ]);
  if (odj !== null) return { class: "ordre_du_jour", marker: odj };

  const other = firstMarker(text, [
    ["reglement", /\breglements?\b/], ["avis_public", /\bavis publics?\b/], ["budget", /\bbudgets?\b|\bbudgetaire\b/],
    ["rapport", /\brapports?\b/], ["annexe", /\bannexes?\b/], ["politique", /\bpolitiques?\b/],
    ["formulaire", /\bformulaires?\b/], ["communique", /\bcommuniques?\b/], ["calendrier", /\bcalendriers?\b/],
    ["taxation", /\btaxation\b|\btaxes?\b/], ["permis", /\bpermis\b/],
    ["appel_offres", /\bappel d offres?\b|\bsoumission\b/], ["contrat", /\bcontrats?\b/],
    ["certificat", /\bcertificats?\b/],
  ]);
  if (other !== null) return { class: "autre_document", marker: other };

  const pv = firstMarker(text, [
    ["proces_verbal", /\bproces verbaux?\b|\bproces verbal\b/], ["pv", /\bpv\b/],
    ["seance_ordinaire", /\bseances? ordinaires?\b/], ["seance_extraordinaire", /\bseances? extraordinaires?\b/],
    ["minutes", /\b(meeting )?minutes\b/],
  ]);
  if (pv !== null) return { class: "pv_probable", marker: pv };
  if (textHasSpecificDate && /\b(so|se)\b/.test(text)) return { class: "pv_probable", marker: "so_se_with_date" };
  if (textHasSpecificDate && /\b(conseil|council)\b/.test(text)) return { class: "pv_probable", marker: "conseil_with_date" };
  return { class: "indetermine", marker: "no_observable_document_type_marker" };
}
