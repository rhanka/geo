import { describe, expect, it } from "vitest";

import { analyzeZoneGazetteerMatchMode, classifyRegulationLegalQuality, extractPvSemantic, printedMunicipalityOwners, validateExtraction } from "./pv-graphify-semantic.js";

const municipalities = [
  { slug: "albertville", name: "Albertville" },
  { slug: "compton", name: "Compton" },
  { slug: "arundel", name: "Arundel" },
  { slug: "armagh", name: "Armagh" },
  { slug: "dunham", name: "Dunham" },
  { slug: "dolbeau-mistassini", name: "Dolbeau-Mistassini" },
  { slug: "dorval", name: "Dorval" },
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

  it("reports only an exact, printed owner when a capture scope is contaminated", () => {
    const owners = printedMunicipalityOwners("VILLE DE COMPTON\nProcès-verbal de séance.", municipalities);
    expect(owners.map((owner) => owner.slug)).toEqual(["compton"]);
    expect(printedMunicipalityOwners("Compton, 3 rue Principale", municipalities)).toEqual([]);
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

  it("recognizes an owner split over adjacent PDF extraction lines without fuzzy matching", () => {
    const result = extractPvSemantic({
      source_file: "input/dolbeau-mistassini.txt",
      municipality_slug: "dolbeau-mistassini",
      text: [
        "PROCÈS-VERBAL DE LA SÉANCE EXTRAORDINAIRE DU CONSEIL MUNICIPAL",
        "DE DOLBEAU-MISTASSINI, TENUE LE 18 JUILLET 2024 À ONZE HEURES.",
      ].join("\n"),
    }, municipalities);

    const municipality = result.nodes.find((node) => node.node_type === "Municipality");
    expect(municipality?.citations[0]).toMatchObject({
      source_location: "input/dolbeau-mistassini.txt:line:1",
      quote: "PROCÈS-VERBAL DE LA SÉANCE EXTRAORDINAIRE DU CONSEIL MUNICIPAL",
    });
  });

  it("recognizes the general French Cité owner prefix", () => {
    const result = extractPvSemantic({
      source_file: "input/dorval.txt",
      municipality_slug: "dorval",
      text: "CITÉ DE DORVAL\nProcès-verbal d’une séance du conseil municipal.",
    }, municipalities);

    expect(result.nodes.map((node) => node.node_type)).toEqual(["Municipality", "Document"]);
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

  it("keeps the named Armagh and Dunham draft regulations non-adopted despite nearby adoption words", () => {
    const armagh = extractPvSemantic({
      source_file: "input/armagh.txt",
      municipality_slug: "armagh",
      text: "MUNICIPALITÉ D’ARMAGH\nCONSIDÉRANT le projet de Règlement no 199-2022 adopté par le conseil",
    }, municipalities);
    const dunham = extractPvSemantic({
      source_file: "input/dunham.txt",
      municipality_slug: "dunham",
      text: "VILLE DE DUNHAM\nprojet de Règlement no 489-24 adoptée lors de la séance",
    }, municipalities);

    expect(armagh.nodes.find((node) => node.regulation_number === "199-2022")?.legal_quality).toBe("PROJET");
    expect(dunham.nodes.find((node) => node.regulation_number === "489-24")?.legal_quality).toBe("PROJET");
    expect(classifyRegulationLegalQuality("CONSIDÉRANT le projet de Règlement no 199-2022 adopté par le conseil", "199 - 2022")).toBe("PROJET");
    expect(classifyRegulationLegalQuality("projet de Règlement no 489-24 adoptée lors de la séance", "489-24")).toBe("PROJET");
    expect(classifyRegulationLegalQuality("Règlement 016-2024 « Règlement numéro 016-2024 relatif au", "016-2024")).toBe("INCONNUE");
  });

  it("prioritizes every non-effective regulation qualifier over a nearby adoption", () => {
    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Premier projet de règlement 101-2024 adopté.",
      "Second projet de règlement 102-2024 adopté.",
      "Avis d’approbation référendaire du règlement 103-2024 adopté.",
      "Version administrative du règlement 104-2024 adopté.",
      "Codification du règlement 105-2024 adopté.",
    ].join("\n"));

    expect(result.nodes.filter((node) => node.node_type === "Regulation").map((node) => [
      node.regulation_number,
      node.legal_quality,
    ])).toEqual([
      ["101-2024", "PREMIER_PROJET"],
      ["102-2024", "SECOND_PROJET"],
      ["103-2024", "AVIS_APPROBATION_REFERENDAIRE"],
      ["104-2024", "VERSION_ADMINISTRATIVE"],
      ["105-2024", "CODIFICATION"],
    ]);
  });

  it("classifies the named adversarial-report clauses without promoting procedural steps to adoption", () => {
    // work/graphify/pv-semantic-20260728T220136Z/dolbeau-mistassini/f08496638483.pdf/input/document.txt:427
    expect(classifyRegulationLegalQuality(
      "AVIS DE MOTION - RÈGLEMENT NUMÉRO 1959-24 CRÉANT UNE RÉSERVE",
      "1959-24",
    )).toBe("AVIS_DE_MOTION");
    // work/graphify/pv-semantic-20260728T220136Z/dolbeau-mistassini/714967e1a29d.pdf/input/document.txt:466
    expect(classifyRegulationLegalQuality(
      "ADOPTION - RÈGLEMENT NUMÉRO 1953-24 DÉCRÉTANT UNE DÉPENSE DE 101",
      "1953-24",
    )).toBe("ADOPTION_MENTIONNEE");
    // work/graphify/pv-semantic-20260728T220314Z/drummondville/e8dcfa1a1f15.pdf/input/document.txt:2509
    expect(classifyRegulationLegalQuality(
      "0277/03/26 Dépôt d'un certificat relatif au règlement no RV26-5821 décrétant des",
      "RV26-5821",
    )).toBe("DEPOT_CERTIFICAT");
    // work/graphify/pv-semantic-20260728T215129Z/acton-vale/cdda0fa62055.pdf/input/document.txt:29,35
    expect(classifyRegulationLegalQuality([
      "      règlement 006-2025 (Domaine du stade).",
      "Projet de règlement 006-2025.",
    ].join("\n"), "006-2025")).toBe("PROJET");
    // work/graphify/pv-semantic-20260728T215541Z/abercorn/6e7440290da2.pdf/input/document.txt:27,144
    expect(classifyRegulationLegalQuality([
      "3.1. Règlement numéro 397-2026 concernant l’imposition de la taxe",
      "D’adopter le Règlement numéro 397-2026 concernant l’imposition de la taxe",
    ].join("\n"), "397-2026")).toBe("ADOPTION_MENTIONNEE");
    expect(classifyRegulationLegalQuality([
      "Règlement numéro 991-2026 concernant la tarification.",
      "Il est adopté après la période de questions.",
    ].join("\n"), "991-2026")).toBe("INCONNUE");
    // work/graphify/pv-semantic-20260728T181500Z/albertville/2750b3b1d90a.pdf/input/document.txt:422-423
    expect(classifyRegulationLegalQuality([
      "Selon les modalités du règlement 2024-05 de la Régie Intermunicipale de traitement",
      "des matières résiduelles de la MRC de la Matapédia et de la Mitis dûment en vigueur.",
    ].join("\n"), "2024-05")).toBe("ENTREE_EN_VIGUEUR");
  });

  it("rejects reported PDF-hyphen fragments rather than manufacturing a regulation identifier", () => {
    // work/graphify/pv-semantic-20260728T215830Z/daveluyville/f29b806370d0.pdf/input/document.txt:274-275
    expect(() => classifyRegulationLegalQuality("Règlement      de    19).", "de 19")).toThrow("absente");
    expect(() => classifyRegulationLegalQuality("Règlement - 2014.", "-2014")).toThrow("absente");
    expect(classifyRegulationLegalQuality("MODIFIANT LE RÈGLEMENT SQ 2021-005", "SQ 2021-005")).toBe("INCONNUE");
    expect(classifyRegulationLegalQuality("Règlement RV-2026 modifiant le règlement précédent", "RV-2026")).toBe("INCONNUE");
    expect(classifyRegulationLegalQuality("règlement r-2026 modifiant le règlement précédent", "R-2026")).toBe("INCONNUE");

    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Règlement 324-",
      "2014.",
    ].join("\n"));
    expect(result.nodes.filter((node) => node.node_type === "Regulation")).toEqual([]);
  });

  it("keeps an adjacent legal-status marker as a relocalizable citation", () => {
    const result = extract([
      "MUNICIPALITÉ D’ALBERTVILLE",
      "Selon les modalités du règlement 2024-05 de la Régie Intermunicipale de traitement",
      "des matières résiduelles de la MRC de la Matapédia et de la Mitis dûment en vigueur.",
    ].join("\n"));
    const regulation = result.nodes.find((node) => node.regulation_number === "2024-05");

    expect(regulation?.legal_quality).toBe("ENTREE_EN_VIGUEUR");
    expect(regulation?.citations.map((item) => [item.source_location, item.quote])).toEqual([
      ["input/albertville-2023-05-01.txt:line:2", "Selon les modalités du règlement 2024-05 de la Régie Intermunicipale de traitement"],
      ["input/albertville-2023-05-01.txt:line:3", "des matières résiduelles de la MRC de la Matapédia et de la Mitis dûment en vigueur."],
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

  it("chooses exact matching when normalized zone codes collide", () => {
    const result = analyzeZoneGazetteerMatchMode(["C-15", "C -15", "HC-14"]);
    expect(result.mode).toBe("exact");
    expect(result.collisions).toEqual(["C-15: C -15|C-15"]);
  });

  it("does not emit a zone in exact mode when the only close form is non-literal", () => {
    const result = extractPvSemantic({
      source_file: "input/albertville.txt",
      municipality_slug: "albertville",
      text: [
        "MUNICIPALITÉ D’ALBERTVILLE",
        "Séance du conseil tenue le 1er mai 2023.",
        "La zone C 15 est visée.",
      ].join("\n"),
    }, municipalities, {
      municipality_slug: "albertville",
      codes: ["C-15"],
      zone_code_matching: "exact",
    });
    expect(result.nodes.filter((node) => node.node_type === "Zone")).toHaveLength(0);
  });

  it("does not match a zone from another municipality when the code is absent from this municipality's scope", () => {
    const result = extractPvSemantic({
      source_file: "input/albertville.txt",
      municipality_slug: "albertville",
      text: "MUNICIPALITÉ D’ALBERTVILLE\nSéance du conseil tenue le 1er mai 2023.\nLa zone C-15 est visée.",
    }, municipalities, { municipality_slug: "albertville", codes: ["HC-14"] });
    expect(result.nodes.find((node) => node.node_type === "Zone")).toBeUndefined();
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
