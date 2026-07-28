import { describe, expect, it } from "vitest";
import { validateExtraction } from "@sentropic/graphify";

import { extractPvSemantic } from "./pv-graphify-semantic.js";

const municipalities = [
  { slug: "albertville", name: "Albertville" },
  { slug: "compton", name: "Compton" },
  { slug: "arundel", name: "Arundel" },
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

  it("does not emit a municipality-scoped resolution without a printed owner", () => {
    const result = extract("Résolution numéro 2026-05-024 : adoption du règlement 227-2026.");
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });

  it("accepts an exact English municipality owner but not an address after the name", () => {
    const owner = extractPvSemantic({
      source_file: "input/arundel.txt",
      municipality_slug: "arundel",
      text: "Minutes of the council of the Municipality of the Township of Arundel.",
    }, municipalities);
    const addressOnly = extractPvSemantic({
      source_file: "input/arundel.txt",
      municipality_slug: "arundel",
      text: "Arundel held a meeting at the municipal office on 5 April 2022.",
    }, municipalities);

    expect(owner.nodes.map((node) => node.node_type)).toEqual(["Municipality", "Document"]);
    expect(addressOnly.nodes).toEqual([]);
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

  it("uses the PV header session rather than a later reference to an earlier meeting", () => {
    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Procès-verbal de la séance ordinaire du conseil tenue le 10NOVEMBRE 2025.",
      "Adoption du procès-verbal de la séance du conseil tenue le 2 octobre 2025.",
    ].join("\n"));

    expect(result.nodes.filter((node) => node.node_type === "MeetingDate").map((node) => node.label))
      .toEqual(["10NOVEMBRE 2025"]);
  });

  it("recognizes a municipal session header that says municipalité rather than conseil", () => {
    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Procès-verbal de la séance ordinaire de la Municipalité d’Albertville, tenue le 11 mai 2026.",
    ].join("\n"));

    expect(result.nodes.filter((node) => node.node_type === "CouncilSession")).toHaveLength(1);
    expect(result.nodes.find((node) => node.node_type === "MeetingDate")?.label).toBe("11 mai 2026");
  });

  it("does not create regulation identifiers from plural words, broken codes, or dates", () => {
    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Séance du conseil tenue le 1er mai 2023.",
      "Adoption du règlement 222-2026 (2e projet).",
      "Le deuxième projet de règlement 223-2026 est présenté.",
      "Le deuxième projet du règlement 224-2026 est présenté.",
      "Le règlement 225-2026 est adopté.",
      "Les règlements 177-2019 et 190-2021 sont abrogés.",
      "Le règlement 612-",
      "Dépôt du règlement 30 avril 2026.",
    ].join("\n"));

    expect(result.nodes.filter((node) => node.node_type === "Regulation").map((node) => [
      node.regulation_number,
      node.legal_quality,
    ])).toEqual([
      ["222-2026", "SECOND_PROJET"],
      ["223-2026", "SECOND_PROJET"],
      ["224-2026", "SECOND_PROJET"],
      ["225-2026", "ADOPTE"],
    ]);
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
