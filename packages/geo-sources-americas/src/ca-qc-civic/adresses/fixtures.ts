/**
 * terrAPI / Adresses Québec FeatureCollection fixtures for the adapter tests.
 *
 * These mirror the SHAPE of immo's REAL committed terrAPI samples
 * (`_spikes/adresses-quebec-igo-geocoder/samples/terrapi-adresses-*.json`,
 * fetched with `geometry=0`): per `Feature`, only `properties.code` /
 * `properties.nom` / `properties.nbUnite`, NO geometry, NO lot. The address
 * labels reproduced here are the same first records immo documents.
 *
 * Anti-PII: civic addresses are public; there is no owner field in this product.
 */

/** Salaberry-de-Valleyfield (70052) — first records (geometry=0, attributes only). */
export const TERRAPI_ADRESSES_VALLEYFIELD_JSON = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        code: "000464c34bfd4f25862f208af2e3dbf5J6S6A5",
        nom: "24 rue Paquette, Salaberry-de-Valleyfield J6S6A5",
        nbUnite: "1",
      },
    },
    {
      type: "Feature",
      properties: {
        code: "0004bec16a0f45f5bf723bce6d37d063J6S3N5",
        nom: "561 avenue de Grande-Île, Salaberry-de-Valleyfield J6S3N5",
        nbUnite: "1",
      },
    },
    {
      type: "Feature",
      properties: {
        code: "000772440802487d9f9972a7259dc7caJ6S6P7",
        nom: "310 boulevard Pie-XII, Salaberry-de-Valleyfield J6S6P7",
        nbUnite: "1",
      },
    },
  ],
});

/** Beauharnois (70022) — first records (geometry=0, attributes only). */
export const TERRAPI_ADRESSES_BEAUHARNOIS_JSON = JSON.stringify({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {
        code: "0002bd87474842c68253f14f49c39f05J6N2J3",
        nom: "279 chemin Saint-Louis, Beauharnois J6N2J3",
        nbUnite: "1",
      },
    },
    {
      type: "Feature",
      properties: {
        code: "000a986585ae4a12b54866c10f0140a9J6N2L4",
        nom: "28 rue Trudeau, Beauharnois J6N2L4",
        nbUnite: "1",
      },
    },
  ],
});
