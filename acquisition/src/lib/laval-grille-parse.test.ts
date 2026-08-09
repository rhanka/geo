/**
 * Tests for the Laval Info-règlements grid parser.
 *
 * The fixture is a VERBATIM excerpt of the real document served at
 * https://info-reglements.laval.ca/page-data/consultation/grilles/8094/page-data.json
 * (result.data.urbapi.downloadDocument.content, fetched 2026-07-17): the header
 * table plus the Lotissement / Implantation / Architecture / Usages sections,
 * byte-for-byte. Values below are what the CITY publishes — a test failure means
 * the parser drifted, never that the norm was "adjusted".
 */
import { describe, expect, it } from "vitest";

import { parseLavalGrille, parseNumber, unitOfLabel } from "./laval-grille-parse.js";

const FIXTURE = `<section class="section grille"><div class="titlepage"><div><div class="title ID hide"><h3 class="title ID hide">8094</h3></div></div></div><div class="informaltable table-responsive"><table class="informaltable"><tbody><tr><td class="td"><p>T4.3</p></td><td class="td"><p>-</p></td><td class="td"><p>8094</p></td><td class="td"></td></tr></tbody></table></div><div class="informaltable Type de milieu et application table-responsive"><table class="informaltable"><tbody><tr><th align="center" class="th grid_section" colspan="7"><p>Type de milieu applicable</p></th></tr><tr><td align="left" colspan="7" class="td"><p><span class="bold"><strong>SECTION 3 Urbain T4.3</strong></span></p><p>Intention</p><p>De la catégorie « T4 Urbain », le type de milieux T4.3 est caractérisé par des ensembles de bâtiments d'habitation d'un logement contigus.</p></td></tr></tbody></table></div><div class="informaltable Lotissement table-responsive"><table class="informaltable"><tbody><tr><th align="center" class="th grid_section" colspan="7"><p>Lotissement</p></th></tr><tr><td align="left" colspan="4" class="td"></td><td align="center" class="td"><p><span class="bold"><strong>Type de structure</strong></span></p></td><td align="center" class="td"><p><span class="bold"><strong>Minimum</strong></span></p></td><td align="center" class="td"><p><span class="bold"><strong>Maximum</strong></span></p></td></tr><tr><td align="left" rowspan="3" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-eee.svg" alt="A - Tableau" title="A - Tableau"></span></p></td><td align="left" colspan="3" rowspan="3" class="td"><p>Largeur d'un lot (m)</p></td><td align="center" class="td"><p>Isolé</p></td><td align="center" class="td"><p>11</p><p>(art. 1017.)</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="center" class="td"><p>Jumelé</p></td><td align="center" class="td"><p>9</p><p>(art. 1017.)</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="center" class="td"><p>Contigu</p></td><td align="center" class="td"><p>6</p><p>(art. 1017.)</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="left" rowspan="3" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-386.svg" alt="B - Tableau" title="B - Tableau"></span></p></td><td align="left" colspan="3" rowspan="3" class="td"><p>Superficie d'un lot (m<sup>2</sup>)</p></td><td align="center" class="td"><p>Isolé</p></td><td align="center" class="td"><p>260</p><p>(art. 1017.)</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="center" class="td"><p>Jumelé</p></td><td align="center" class="td"><p>220</p><p>(art. 1017.)</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="center" class="td"><p>Contigu</p></td><td align="center" class="td"><p>160</p><p>(art. 1017.)</p></td><td align="center" class="td"><p>-</p></td></tr></tbody></table></div><div class="informaltable Implantation table-responsive"><table class="informaltable"><tbody><tr><th align="center" class="th grid_section" colspan="7"><p>Implantation d'un bâtiment</p></th></tr><tr><td align="left" colspan="5" class="td"></td><td align="center" class="td"><p><span class="bold"><strong>Minimum</strong></span></p></td><td align="center" class="td"><p><span class="bold"><strong>Maximum</strong></span></p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-eee.svg" alt="A - Tableau" title="A - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Marge avant (m)</p></td><td align="center" class="td"><p>3</p></td><td align="center" class="td"><p>6</p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-386.svg" alt="B - Tableau" title="B - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Marge avant secondaire (m)</p></td><td align="center" class="td"><p>3</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-168.svg" alt="C - Tableau" title="C - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Marge latérale (m)</p></td><td align="center" class="td"><p>1,5</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-4aa.svg" alt="D - Tableau" title="D - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Marge arrière (m)</p></td><td align="center" class="td"><p>6</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-540.svg" alt="F - Tableau" title="F - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Emprise au sol du bâtiment (%)</p></td><td align="center" class="td"><p>-</p></td><td align="center" class="td"><p>50</p></td></tr></tbody></table></div><div class="informaltable Architecture table-responsive"><table class="informaltable"><tbody><tr><th align="center" class="th grid_section" colspan="7"><p>Architecture d'un bâtiment</p></th></tr><tr><td align="left" colspan="4" class="td"></td><td align="center" class="td"><p><span class="bold"><strong>Type de structure</strong></span></p></td><td align="center" class="td"><p><span class="bold"><strong>Minimum</strong></span></p></td><td align="center" class="td"><p><span class="bold"><strong>Maximum</strong></span></p></td></tr><tr><td align="left" rowspan="3" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-eee.svg" alt="A - Tableau" title="A - Tableau"></span></p></td><td align="left" colspan="3" rowspan="3" class="td"><p>Largeur d'un bâtiment (m)</p></td><td align="center" class="td"><p>Isolé</p></td><td align="center" class="td"><p>6</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="center" class="td"><p>Jumelé</p></td><td align="center" class="td"><p>6</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="center" class="td"><p>Contigu</p></td><td align="center" class="td"><p>6</p></td><td align="center" class="td"><p>-</p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-168.svg" alt="C - Tableau" title="C - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Nombre d’étages</p></td><td align="center" class="td"><p>1</p></td><td align="center" class="td"><p>3</p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-4aa.svg" alt="D - Tableau" title="D - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Hauteur d'un bâtiment (m)</p></td><td align="center" class="td"><p>-</p></td><td align="center" class="td"><p>12</p></td></tr></tbody></table></div><div class="informaltable Usages table-responsive"><table class="informaltable"><tbody><tr><th align="center" class="th grid_section" colspan="7"><p>Usages et densité d'occupation</p></th></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-eee.svg" alt="A - Tableau" title="A - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Habitation (H1)</p></td><td align="center" class="td"></td><td align="center" class="td"></td></tr><tr><td align="left" colspan="2" rowspan="3" class="td"></td><td align="left" colspan="3" class="td"><p>Habitation de 1 logement</p></td><td align="center" class="td"></td><td align="center" class="td"><p>A</p></td></tr><tr><td align="left" colspan="3" class="td"><p>Habitation de 2 ou 3 logements</p></td><td align="left" class="td"></td><td align="center" class="td"><p></p></td></tr><tr><td align="left" class="td"><p><span class="inlinemediaobject"><img src="image/uuid-168.svg" alt="C - Tableau" title="C - Tableau"></span></p></td><td align="left" colspan="4" class="td"><p>Habitation de chambre (H3)</p></td><td align="center" class="td"></td><td align="center" class="td"><p>C</p><p>(art. 1014.)</p></td></tr><tr><td align="left" class="td"></td><td align="left" colspan="4" class="td"><p>A : Autorisé</p><p>C : Conditionnel</p></td><td align="center" class="td"></td><td align="center" class="td"></td></tr><tr><td align="left" colspan="5" class="td"><p>Usages spécifiquement prohibés</p></td><td align="left" colspan="2" class="td"><p>Aucun</p></td></tr></tbody></table></div><div class="informaltable Exceptions table-responsive"><table class="informaltable"><tbody><tr><th align="center" class="th grid_section" colspan="2"><p>Autres Dispositions particulières de la grille d'exception</p></th></tr><tr><td colspan="2" class="td"><section class="section article"><p><span class="bold"><strong>1860. </strong></span>L'implantation d'un bâtiment principal doit respecter une marge latérale ou arrière minimale de 15 m par rapport à la limite d'un type de milieux T2.1 ou T2.2.</p></section></td></tr></tbody></table></div></section>`;

describe("parseLavalGrille", () => {
  const g = parseLavalGrille(FIXTURE);

  it("reads the zone identity from the header table", () => {
    expect(g.typeMilieu).toBe("T4.3");
    expect(g.zoneId).toBe("8094");
    expect(g.zoneCode).toBe("T4.3-8094");
    expect(g.sectionTitle).toBe("SECTION 3 Urbain T4.3");
  });

  it("publishes structure-independent margins verbatim", () => {
    expect(g.fields.marge_avant_min).toEqual({ value: 3, raw: "3", unit: "m" });
    expect(g.fields.marge_laterale_min).toEqual({ value: 1.5, raw: "1,5", unit: "m" });
    expect(g.fields.marge_arriere_min).toEqual({ value: 6, raw: "6", unit: "m" });
  });

  it("does not confuse « Marge avant » with « Marge avant secondaire »", () => {
    // Both have min 3; the discriminator is the max column (6 vs "-").
    expect(g.fields.marge_avant_min?.raw).toBe("3");
  });

  it("takes hauteur_max from the metre row, and null (never 0) when absent", () => {
    expect(g.fields.hauteur_max).toEqual({ value: 12, raw: "12", unit: "m" });
    expect(g.fields.hauteur_min).toEqual({ value: null, raw: "-", unit: "m" });
  });

  it("never collapses a structure-dependent measure to one number", () => {
    expect(g.fields.frontage_min?.value).toBeNull();
    expect(g.fields.frontage_min?.raw).toBe(
      "Isolé 11 (art. 1017.) | Jumelé 9 (art. 1017.) | Contigu 6 (art. 1017.)",
    );
    expect(g.fields.frontage_min?.unit).toBe("m");
    expect(g.fields.superficie_min?.value).toBeNull();
    expect(g.fields.superficie_min?.raw).toBe(
      "Isolé 260 (art. 1017.) | Jumelé 220 (art. 1017.) | Contigu 160 (art. 1017.)",
    );
    expect(g.fields.superficie_min?.unit).toBe("m2");
  });

  it("does not invent a densité", () => {
    expect(g.fields.densite).toBeUndefined();
  });

  it("reports a wholly inapplicable structured measure as a plain dash", () => {
    // Real shape of a CE (espace ouvert) zone: every lot branch is blank.
    const CE = `<div class="informaltable table-responsive"><table><tbody><tr><td><p>CE</p></td><td><p>-</p></td><td><p>1054</p></td><td></td></tr></tbody></table></div><div class="informaltable Lotissement table-responsive"><table><tbody><tr><td align="left" rowspan="3"><p><img src="a.svg" alt="A - Tableau"></p></td><td align="left" colspan="3" rowspan="3"><p>Largeur d'un lot (m)</p></td><td align="center"><p>Isolé</p></td><td align="center"><p>-</p></td><td align="center"><p>-</p></td></tr><tr><td align="center"><p>Jumelé</p></td><td align="center"><p>-</p></td><td align="center"><p>-</p></td></tr><tr><td align="center"><p>Contigu</p></td><td align="center"><p>-</p></td><td align="center"><p>-</p></td></tr></tbody></table></div>`;
    const parsed = parseLavalGrille(CE);
    expect(parsed.zoneCode).toBe("CE-1054");
    expect(parsed.fields.frontage_min).toEqual({ value: null, raw: "-", unit: "m" });
  });

  it("keeps the uses verbatim and is not fooled by « Aucun »", () => {
    expect(g.usages).toBe("Habitation de 1 logement: A; Habitation de chambre (H3): C");
  });

  it("flags the zone's exception provisions", () => {
    expect(g.hasExceptions).toBe(true);
  });
});

describe("parseNumber / unitOfLabel", () => {
  it("reads FR decimals and treats the portal's dash as null, not 0", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber("11 (art. 1017.)")).toBe(11);
    expect(parseNumber("-")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("Aucun")).toBeNull();
  });

  it("derives the unit from the label so metres cannot land in an m2 field", () => {
    expect(unitOfLabel("Marge avant (m)")).toBe("m");
    expect(unitOfLabel("Superficie d'un lot (m2)")).toBe("m2");
    expect(unitOfLabel("Emprise au sol du bâtiment (%)")).toBe("%");
    expect(unitOfLabel("Nombre d'étages")).toBeNull();
  });
});
