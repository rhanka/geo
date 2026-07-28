import { describe, expect, it } from "vitest";
import { validateExtraction } from "@sentropic/graphify";

import { extractPvSemantic } from "./pv-graphify-semantic.js";

const municipalities = [
  { slug: "albertville", name: "Albertville" },
  { slug: "compton", name: "Compton" },
] as const;

function extract(text: string) {
  return extractPvSemantic({
    source_file: "input/albertville-2023-05-01.txt",
    source_id: "raw/pv-index/cas/immutable.pdf",
    source_url: "https://example.test/albertville.pdf",
    municipality_slug: "albertville",
    text,
  }, municipalities);
}

describe("PV deterministic Graphify semantic extraction", () => {
  it("grounds the municipal owner, session and verbatim meeting date by source line", () => {
    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Procès-verbal de la séance ordinaire du conseil tenue le 1er mai 2023 à 20 h.",
    ].join("\n"));

    expect(result.nodes.map((node) => node.node_type)).toEqual([
      "Municipality", "Document", "CouncilSession", "MeetingDate",
    ]);
    const municipality = result.nodes.find((node) => node.node_type === "Municipality");
    const meetingDate = result.nodes.find((node) => node.node_type === "MeetingDate");
    expect(municipality?.citations[0]).toMatchObject({
      source_file: "input/albertville-2023-05-01.txt",
      source_location: "input/albertville-2023-05-01.txt:line:1",
      quote: "MUNICIPALITÉ D’ALBERTVILLE",
      confidence: "EXTRACTED",
    });
    expect(meetingDate?.label).toBe("1er mai 2023");
    expect(meetingDate?.citations[0]?.source_location).toBe("input/albertville-2023-05-01.txt:line:2");
    expect(result.edges.map((edge) => edge.relation)).toEqual([
      "document_refers_municipality", "document_describes_council_session", "session_held_on",
    ]);
    expect(validateExtraction(result)).toEqual([]);
  });

  it("does not turn the capture scope into an owner: the name must be printed in municipal context", () => {
    const result = extract("La facture a été transmise à Albertville le 1er mai 2023.");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("extracts resolution and regulation references with a non-silent legal quality", () => {
    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Séance du conseil tenue le 1er mai 2023.",
      "Résolution numéro 304.12.2025 : adoption du règlement 606-25 modifiant le règlement 599-25.",
      "Premier projet de règlement 607-25.",
      "Avis d’approbation référendaire du règlement 608-25.",
    ].join("\n"));

    const regulations = result.nodes.filter((node) => node.node_type === "Regulation");
    expect(regulations.map((node) => [node.regulation_number, node.legal_quality])).toEqual([
      ["606-25", "ADOPTE"],
      ["599-25", "INCONNUE"],
      ["607-25", "PREMIER_PROJET"],
      ["608-25", "AVIS_APPROBATION_REFERENDAIRE"],
    ]);
    expect(regulations.every((node) => node.citations[0]?.quote && node.citations[0]?.source_location)).toBe(true);
    expect(result.edges.some((edge) => edge.relation === "resolution_mentions_regulation")).toBe(true);
  });

  it("resolves zones only against the document municipality's closed served set", () => {
    const text = [
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Séance du conseil tenue le 1er mai 2023.",
      "Les zones HC - 14 et C-15 sont visées.",
    ].join("\n");
    const result = extractPvSemantic({
      source_file: "input/albertville.txt",
      municipality_slug: "albertville",
      text,
    }, municipalities, { municipality_slug: "albertville", codes: ["HC-14"] });
    expect(result.nodes.filter((node) => node.node_type === "Zone").map((node) => node.zone_code)).toEqual(["HC-14"]);
    expect(result.edges.filter((edge) => edge.relation === "document_refers_zone")).toHaveLength(1);
  });

  it("rejects a zone registry from another municipality rather than mixing codes", () => {
    expect(() => extractPvSemantic({
      source_file: "input/albertville.txt",
      municipality_slug: "albertville",
      text: "MUNICIPALITÉ D’ALBERTVILLE",
    }, municipalities, { municipality_slug: "compton", codes: ["C-15"] })).toThrow("hors scope");
  });

  it("emits a lot only if the exact cadastral value belongs to the scoped closed set", () => {
    const result = extractPvSemantic({
      source_file: "input/albertville.txt",
      municipality_slug: "albertville",
      text: "MUNICIPALITÉ D’ALBERTVILLE\nSéance du conseil tenue le 1er mai 2023.\nSur le lot 5 247 514.",
    }, municipalities, undefined, { municipality_slug: "albertville", lot_numbers: ["5247514"] });
    const lot = result.nodes.find((node) => node.node_type === "LotCadastre");
    expect(lot).toMatchObject({ lot_number: "5247514" });
    expect(lot?.citations[0]?.source_location).toBe("input/albertville.txt:line:3");
  });
});
