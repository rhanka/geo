import { describe, expect, it } from "vitest";

import { assessPvHtmlResource } from "./pv-html-resource-verdict.js";

describe("assessPvHtmlResource", () => {
  it("refuses a soft-404 even when the URL looks like a PV", () => {
    const result = assessPvHtmlResource(
      Buffer.from("<html><title>404 - Page not found</title><body>Page introuvable</body></html>"),
      "https://example.test/pv.pdf",
      "Municipalité Exemple",
    );
    expect(result.verdict).toBe("HTML_PORTAL_OR_SOFT_404");
    expect(result.reason).toContain("soft-404");
  });

  it("does not mistake an index page for the requested PV body", () => {
    const result = assessPvHtmlResource(
      Buffer.from("<html><title>Procès-verbaux</title><body>Municipalité Exemple — séances du conseil <a href='pv.pdf'>Procès-verbal</a></body></html>"),
      "https://example.test/pv.pdf",
      "Municipalité Exemple",
    );
    expect(result.verdict).toBe("HTML_PORTAL_OR_SOFT_404");
  });

  it("recognises a body with independent owner, date and PV evidence", () => {
    const result = assessPvHtmlResource(
      Buffer.from("<html><body>Municipalité Exemple — Procès-verbal de la séance du 12 mars 2026. Sont présents les élus. Résolution 2026-01.</body></html>"),
      "https://example.test/pv.html",
      "Municipalité Exemple",
    );
    expect(result.verdict).toBe("HTML_PV_BODY");
  });
});
