/**
 * True only for a retrievable HTTP(S) source, never for the legacy
 * `https://non-disponible` sentinel that otherwise looks like an URL.
 */
export function isUsableNormsSourceUrl(value: string | undefined): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:")
      && url.hostname.includes(".")
      && !/^non-disponible$/i.test(url.hostname);
  } catch {
    return false;
  }
}
