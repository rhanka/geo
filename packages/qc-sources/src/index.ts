export * from "./SourceAdapter.js";
export * from "./RawDocument.js";
export * from "./prioritySources.js";
export * from "./sources/avis-publics-parser.js";
export * from "./sources/role-evaluation-parser.js";
export * from "./sources/adresses-quebec-parser.js";
export * from "./sources/reglements-urbanisme-parser.js";
export * from "./sources/grille-specifications-parser.js";
export * from "./sources/grille-vision-extractor.js";
export * from "./sources/avis-publics-valleyfield.js";
export * from "./sources/avis-publics-beauharnois.js";
export * from "./sources/avis-publics-generic.js";
export * from "./sources/role-evaluation-mamh.js";
export * from "./sources/adresses-quebec.js";
export * from "./sources/reglements-urbanisme-valleyfield.js";
export * from "./sources/reglements-zonage-sherbrooke.js";
export { AVIS_PUBLICS_FIXTURE_HTML } from "./sources/avis-publics-valleyfield.fixture.js";
export { AVIS_PUBLICS_BEAUHARNOIS_FIXTURE_HTML } from "./sources/avis-publics-beauharnois.fixture.js";
export {
  roleEvaluationMamhValleyfieldXml,
  roleEvaluationMamhBeauharnoisXml,
} from "./sources/role-evaluation-mamh.fixture.js";
export {
  adressesQuebecValleyfieldJson,
  adressesQuebecBeauharnoisJson,
} from "./sources/adresses-quebec.fixture.js";
export {
  REGLEMENT_450_02_TEXT,
  REGLEMENT_150_51_TEXT,
} from "./sources/reglements-urbanisme-valleyfield.fixture.js";
export {
  GRILLE_SHERBROOKE_H0001,
  GRILLE_SHERBROOKE_P0004,
  GRILLE_SHERBROOKE_H0005,
  NON_GRILLE_SHERBROOKE_TITLE,
  GRILLE_SHERBROOKE_SOURCE_URL,
  GRILLE_SHERBROOKE_SNAPSHOT,
} from "./sources/grille-specifications.fixture.js";
export { QC_MUNICIPALITIES, prioritizedCities } from "./municipalities.js";
export * from "./geo/geo-source-inventory.js";
export * from "./geo/geo-source-inventory.data.js";
export * from "./geo/geo-vertical-priority.js";
export * from "./sources/proces-verbaux-parser.js";
export * from "./sources/proces-verbaux-generic.js";
export {
  PV_SAINT_DAMASE_2025_05_POSITIVE,
  PV_SAINT_DAMASE_2026_03_NEGATIVE,
  PV_SAINT_DAMASE_INDEX_HTML,
} from "./sources/proces-verbaux-saint-damase.fixture.js";
export {
  PV_SAINT_CONSTANT_2026_05_TEXT,
  PV_SAINT_CONSTANT_INDEX_HTML,
} from "./sources/proces-verbaux-saint-constant.fixture.js";
export {
  PV_SAINTE_CATHERINE_2026_05_TEXT,
  PV_SAINTE_CATHERINE_INDEX_HTML,
} from "./sources/proces-verbaux-sainte-catherine.fixture.js";
export {
  PV_LAPRAIRIE_INDEX_HTML,
  PV_LAPRAIRIE_2026_05_TEXT,
} from "./sources/proces-verbaux-laprairie.fixture.js";
export {
  PV_CHATEAUGUAY_INDEX_HTML,
  PV_CHATEAUGUAY_2026_02_TEXT,
} from "./sources/proces-verbaux-chateauguay.fixture.js";
export {
  PV_DELSON_INDEX_HTML,
  PV_DELSON_2026_05_TEXT,
} from "./sources/proces-verbaux-delson.fixture.js";
export {
  PV_VAUDREUIL_DORION_INDEX_HTML,
  PV_VAUDREUIL_DORION_2026_05_TEXT,
} from "./sources/proces-verbaux-vaudreuil-dorion.fixture.js";
export {
  PV_SAINTE_MARTINE_INDEX_HTML,
  PV_SAINTE_MARTINE_2026_04_TEXT,
} from "./sources/proces-verbaux-sainte-martine.fixture.js";
export {
  PV_CANDIAC_INDEX_HTML,
  PV_CANDIAC_SCANNED_NOTE,
} from "./sources/proces-verbaux-candiac.fixture.js";
export {
  PV_SAINT_REMI_INDEX_HTML,
  PV_SAINT_REMI_2026_04_TEXT,
} from "./sources/proces-verbaux-saint-remi.fixture.js";
export {
  PV_MCMASTERVILLE_INDEX_HTML,
  PV_MCMASTERVILLE_2025_11_TEXT,
} from "./sources/proces-verbaux-mcmasterville.fixture.js";
export {
  PV_BELOEIL_INDEX_HTML,
  PV_BELOEIL_2026_02_TEXT,
} from "./sources/proces-verbaux-beloeil.fixture.js";
export {
  PV_SAINTE_JULIE_INDEX_HTML,
  PV_SAINTE_JULIE_2026_03_TEXT,
} from "./sources/proces-verbaux-sainte-julie.fixture.js";
export {
  PV_SAINTE_THERESE_INDEX_HTML,
  PV_SAINTE_THERESE_2026_03_TEXT,
} from "./sources/proces-verbaux-sainte-therese.fixture.js";
export {
  PV_DEUX_MONTAGNES_INDEX_HTML,
  PV_DEUX_MONTAGNES_2026_04_TEXT,
} from "./sources/proces-verbaux-deux-montagnes.fixture.js";
export {
  PV_MIRABEL_INDEX_HTML,
  PV_MIRABEL_2026_04_TEXT,
} from "./sources/proces-verbaux-mirabel.fixture.js";
export {
  PV_SAINT_EUSTACHE_INDEX_HTML,
  PV_SAINT_EUSTACHE_2026_02_TEXT,
} from "./sources/proces-verbaux-saint-eustache.fixture.js";
export {
  PV_MASCOUCHE_INDEX_HTML,
  PV_MASCOUCHE_2026_04_TEXT,
} from "./sources/proces-verbaux-mascouche.fixture.js";
export {
  PV_CHARLEMAGNE_INDEX_HTML,
  PV_CHARLEMAGNE_2026_05_TEXT,
} from "./sources/proces-verbaux-charlemagne.fixture.js";
export {
  PV_LASSOMPTION_INDEX_HTML,
  PV_LASSOMPTION_2026_05_TEXT,
} from "./sources/proces-verbaux-lassomption.fixture.js";
export {
  PV_LAVALTRIE_INDEX_HTML,
  PV_LAVALTRIE_2026_05_TEXT,
} from "./sources/proces-verbaux-lavaltrie.fixture.js";
export {
  PV_LES_CEDRES_INDEX_HTML,
  PV_LES_CEDRES_2026_05_TEXT,
} from "./sources/proces-verbaux-les-cedres.fixture.js";
export {
  PV_PINCOURT_INDEX_HTML,
  PV_PINCOURT_2026_05_TEXT,
} from "./sources/proces-verbaux-pincourt.fixture.js";
export {
  PV_COTEAU_DU_LAC_INDEX_HTML,
  PV_COTEAU_DU_LAC_2026_04_TEXT,
} from "./sources/proces-verbaux-coteau-du-lac.fixture.js";
export {
  PV_LES_COTEAUX_INDEX_HTML,
  PV_LES_COTEAUX_2026_04_TEXT,
} from "./sources/proces-verbaux-les-coteaux.fixture.js";
export {
  PV_MSH_INDEX_HTML,
  PV_MSH_2026_03_TEXT,
} from "./sources/proces-verbaux-mont-saint-hilaire.fixture.js";
export {
  PV_BOUCHERVILLE_INDEX_HTML,
  PV_BOUCHERVILLE_2026_03_TEXT,
} from "./sources/proces-verbaux-boucherville.fixture.js";
export {
  PV_VARENNES_INDEX_HTML,
  PV_VARENNES_2026_04_TEXT,
} from "./sources/proces-verbaux-varennes.fixture.js";
export {
  PV_ROSEMERE_INDEX_HTML,
  PV_ROSEMERE_2026_03_TEXT,
} from "./sources/proces-verbaux-rosemere.fixture.js";
export {
  PV_LORRAINE_INDEX_HTML,
  PV_LORRAINE_2026_04_TEXT,
} from "./sources/proces-verbaux-lorraine.fixture.js";
export {
  PV_BOISBRIAND_INDEX_HTML,
  PV_BOISBRIAND_2026_04_TEXT,
} from "./sources/proces-verbaux-boisbriand.fixture.js";
export {
  PV_SAINT_JACQUES_LE_MINEUR_INDEX_HTML,
  PV_SAINT_JACQUES_LE_MINEUR_2026_02_TEXT,
} from "./sources/proces-verbaux-saint-jacques-le-mineur.fixture.js";
export {
  PV_HEMMINGFORD_INDEX_HTML,
  PV_HEMMINGFORD_2026_04_TEXT,
} from "./sources/proces-verbaux-hemmingford.fixture.js";
export {
  PV_SAINT_ALEXANDRE_INDEX_HTML,
  PV_SAINT_ALEXANDRE_2026_03_TEXT,
} from "./sources/proces-verbaux-saint-alexandre.fixture.js";
export {
  PV_SAINT_VALENTIN_INDEX_HTML,
  PV_SAINT_VALENTIN_2026_01_TEXT,
} from "./sources/proces-verbaux-saint-valentin.fixture.js";
export {
  PV_HENRYVILLE_INDEX_HTML,
  PV_HENRYVILLE_2026_01_TEXT,
} from "./sources/proces-verbaux-henryville.fixture.js";
export * from "./sources/voxtral-transcriber.js";
export * from "./sources/youtube-seances.js";
export {
  SEANCE_VTT_FIXTURE,
  EXPECTED_PLAIN_TRANSCRIPT,
  YOUTUBE_SEARCH_RESPONSE_FIXTURE,
  YOUTUBE_SEARCH_EMPTY_RESPONSE_FIXTURE,
} from "./sources/youtube-seances.fixture.js";
// Adapters d'acquisition géo supprimés (cadastre-allege, arcgis-zonage,
// arcgis-service-registry, ckan-zonage) — remplacés par @sentropic/geo 0.1.1
// et @sentropic/geo-sources-americas 0.1.1 (consommés dans api/populate-geo.ts).
