import { describe, expect, it } from "vitest";

import { verdictDocumentsFromOctets } from "./pv-octets-to-verdict.js";

const lines = [
  { slug: "rimouski", storage_key: "raw/pv-index/cas/a.pdf", classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", owner_verbatim: "VILLE DE RIMOUSKI" },
  { slug: "rimouski", storage_key: "raw/pv-index/cas/b.pdf", classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", owner_verbatim: "VILLE DE RIMOUSKI" },
  // comité exécutif classé non-PV : jamais indexé
  { slug: "laval", storage_key: "raw/pv-index/cas/c.pdf", classification: "DOCUMENT_LISIBLE_NON_PV", owner_verbatim: "VILLE DE LAVAL" },
  // propriétaire non confirmé : exclu
  { slug: "x", storage_key: "raw/pv-index/cas/d.pdf", classification: "PV_LISIBLE_PROPRIETAIRE_NON_CONFIRME", owner_verbatim: null },
  // doublon storage_key : dédupliqué
  { slug: "rimouski", storage_key: "raw/pv-index/cas/a.pdf", classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", owner_verbatim: "VILLE DE RIMOUSKI" },
  // confirmé mais sans octet durable : exclu (anti-invention)
  { slug: "rimouski", storage_key: null, classification: "PV_LISIBLE_PROPRIETAIRE_CONFIRME", owner_verbatim: "VILLE DE RIMOUSKI" },
];

describe("verdictDocumentsFromOctets", () => {
  it("n'indexe que les lignes PV_LISIBLE_PROPRIETAIRE_CONFIRME complètes", () => {
    const documents = verdictDocumentsFromOctets(lines);
    expect(documents).toEqual([
      { storage_key: "raw/pv-index/cas/a.pdf", outcome: "INDEXED", slug: "rimouski", owner_status: "CONFIRMED", printed_owner: "VILLE DE RIMOUSKI" },
      { storage_key: "raw/pv-index/cas/b.pdf", outcome: "INDEXED", slug: "rimouski", owner_status: "CONFIRMED", printed_owner: "VILLE DE RIMOUSKI" },
    ]);
  });

  it("n'invente aucun INDEXED quand rien n'est confirmé", () => {
    expect(verdictDocumentsFromOctets([{ slug: "y", storage_key: "raw/pv-index/cas/e.pdf", classification: "HTTP_403" }])).toEqual([]);
  });
});
