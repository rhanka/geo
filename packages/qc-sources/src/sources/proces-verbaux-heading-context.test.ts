/**
 * Unit tests for `pvHeadingContextUrls` — the DOM heading-context widener that
 * unblocks genuine date-only PVs on pages whose URL carries no PV keyword.
 *
 * The fixtures mirror the real DOM structure of the two municipalities the
 * URL-only gate rejected at fault (captured 2026-07-02):
 *   - albanel `/documents`   — a mixed documents page whose PV list sits under a
 *     Joomla `<div class="document_title">Procès-verbaux</div>` section title,
 *     with date-only labels ("15 janvier 2024") and `…-pvbl.pdf` filenames.
 *   - saint-félix `/pv2024`  — a WordPress page whose PV list sits under an
 *     `<h2>PROCÈS VERBAUX 2024</h2>`, with date-only labels ("09 janvier 2024").
 *
 * ANTI-INVENTION guardrails asserted here: a bare-date PDF under an « ordre du
 * jour » / « avis public » heading is NOT returned, and a bare-date PDF with no
 * PV heading above it is NOT returned.
 */

import { describe, expect, it } from "vitest";
import { pvHeadingContextUrls } from "./proces-verbaux-parser.js";

describe("pvHeadingContextUrls – DOM heading-context widener", () => {
  it("accepts date-only PDFs under a Joomla `document_title` PV section (albanel)", () => {
    const html = `
      <div class="document_title">Finances</div>
      <a href="images/uploads/25-Rapport-financier-2023.pdf">Rapport financier 2023</a>
      <div class="document_title">Procès-verbaux</div>
      <a href="images/uploads/25-2024-01-15-pvbl.pdf">15 janvier 2024</a>
      <a href="images/uploads/25-2024-02-05-pvbl.pdf">5 février 2024</a>
      <div class="document_title">Règlements</div>
      <a href="images/uploads/25-306-piscine.pdf">Règlement 25-306</a>`;
    const urls = pvHeadingContextUrls(html, "https://albanel.ca/documents");
    // The two PV PDFs under « Procès-verbaux » are returned…
    expect(urls.has("https://albanel.ca/images/uploads/25-2024-01-15-pvbl.pdf")).toBe(true);
    expect(urls.has("https://albanel.ca/images/uploads/25-2024-02-05-pvbl.pdf")).toBe(true);
    // …while the finance PDF (under « Finances ») and the règlement PDF (under
    // « Règlements ») are NOT — a neutral heading shadows the PV section.
    expect(urls.has("https://albanel.ca/images/uploads/25-Rapport-financier-2023.pdf")).toBe(false);
    expect(urls.has("https://albanel.ca/images/uploads/25-306-piscine.pdf")).toBe(false);
  });

  it("accepts date-only PDFs under an <h2> PROCÈS VERBAUX heading (saint-félix)", () => {
    const html = `
      <h2>PROCÈS VERBAUX 2024</h2>
      <p>Consultez les procès-verbaux des séances du conseil.</p>
      <a href="https://stfelixdedalquier.ca/wp-content/uploads/2024/09/01-24-09.pdf">09 janvier 2024</a>
      <a href="https://stfelixdedalquier.ca/wp-content/uploads/2024/09/02-24-06.pdf">06 février 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://stfelixdedalquier.ca/pv2024/");
    expect(urls.has("https://stfelixdedalquier.ca/wp-content/uploads/2024/09/01-24-09.pdf")).toBe(true);
    expect(urls.has("https://stfelixdedalquier.ca/wp-content/uploads/2024/09/02-24-06.pdf")).toBe(true);
    expect(urls.size).toBe(2);
  });

  it("also recognises a « Séances du conseil » heading as PV context", () => {
    const html = `
      <h3>Séances du conseil</h3>
      <a href="/docs/2024-01-15.pdf">15 janvier 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://ville.qc.ca/documents");
    expect(urls.has("https://ville.qc.ca/docs/2024-01-15.pdf")).toBe(true);
  });

  it("REJECTS a date-only PDF sitting under an « ordre du jour » heading", () => {
    const html = `
      <div class="document_title">Ordres du jour</div>
      <a href="/docs/2024-01-15-oj.pdf">15 janvier 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://ville.qc.ca/documents");
    expect(urls.has("https://ville.qc.ca/docs/2024-01-15-oj.pdf")).toBe(false);
    expect(urls.size).toBe(0);
  });

  it("REJECTS a date-only PDF under an « avis public » heading", () => {
    const html = `
      <h2>Avis publics</h2>
      <a href="/docs/2024-01-15-avis.pdf">15 janvier 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://ville.qc.ca/documents");
    expect(urls.size).toBe(0);
  });

  it("REJECTS an ordre-du-jour anchor that follows a PV heading (ODJ heading shadows PV)", () => {
    // A PV section, then an ODJ section header: the date PDF beneath the ODJ
    // header is governed by the ODJ heading, not the earlier PV heading.
    const html = `
      <h2>Procès-verbaux</h2>
      <a href="/docs/pv-2024-01-15.pdf">15 janvier 2024</a>
      <h2>Ordre du jour</h2>
      <a href="/docs/oj-2024-02-05.pdf">5 février 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://ville.qc.ca/documents");
    expect(urls.has("https://ville.qc.ca/docs/pv-2024-01-15.pdf")).toBe(true);
    expect(urls.has("https://ville.qc.ca/docs/oj-2024-02-05.pdf")).toBe(false);
  });

  it("REJECTS date-only PDFs when there is NO PV heading on the page", () => {
    const html = `
      <h1>Documents municipaux</h1>
      <a href="/docs/2024-01-15.pdf">15 janvier 2024</a>
      <a href="/docs/2024-02-05.pdf">5 février 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://ville.qc.ca/documents");
    expect(urls.size).toBe(0);
  });

  it("does not attribute a PDF that precedes the PV heading in document order", () => {
    const html = `
      <a href="/docs/before.pdf">1 janvier 2024</a>
      <h2>Procès-verbaux</h2>
      <a href="/docs/after.pdf">2 février 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://ville.qc.ca/documents");
    expect(urls.has("https://ville.qc.ca/docs/before.pdf")).toBe(false);
    expect(urls.has("https://ville.qc.ca/docs/after.pdf")).toBe(true);
  });

  it("drops a PV-headed PDF that is farther than the proximity bound", () => {
    const filler = " ".repeat(7000);
    const html = `<h2>Procès-verbaux</h2>${filler}<a href="/docs/far.pdf">15 janvier 2024</a>`;
    const urls = pvHeadingContextUrls(html, "https://ville.qc.ca/documents");
    expect(urls.has("https://ville.qc.ca/docs/far.pdf")).toBe(false);
  });
});
