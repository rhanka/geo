import type { SourceKind } from "./domain.js";
import { expect, expectTypeOf, test } from "vitest";

import type {
  ListOptions,
  RawDocument,
  RawDocumentRef,
  SourceAdapter,
} from "./SourceAdapter.js";

test("SourceAdapter describes stateless raw-document collection", async () => {
  const expectedHash =
    "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7c656c83c18398a";

  const adapter: SourceAdapter = {
    kind: "avis-publics",
    city: "salaberry-de-valleyfield",
    version: "0.1.0",
    async *list(opts: ListOptions) {
      expect(opts.city).toBe("salaberry-de-valleyfield");
      yield {
        sourceKind: "avis-publics",
        city: "salaberry-de-valleyfield",
        url: "https://www.ville.valleyfield.qc.ca/avis-publics",
        discoveredAt: "2026-06-06T16:00:00.000Z",
        title: "Avis public",
      };
    },
    async fetch(ref: RawDocumentRef): Promise<RawDocument> {
      return {
        ref,
        sourceKind: ref.sourceKind,
        city: "salaberry-de-valleyfield",
        url: ref.url,
        fetchedAt: "2026-06-06T16:01:00.000Z",
        contentType: "text/html; charset=utf-8",
        body: new TextEncoder().encode("<html>avis</html>"),
        provenance: {
          adapterVersion: "0.1.0",
          userAgent: "radar-immobilier/0.1.0 (+contact@example.invalid)",
          fetchedViaObscura: false,
        },
      };
    },
    hash() {
      return expectedHash;
    },
  };

  const refs: RawDocumentRef[] = [];
  for await (const ref of adapter.list({
    city: "salaberry-de-valleyfield",
    since: "2026-06-01T00:00:00.000Z",
  })) {
    refs.push(ref);
  }

  expect(refs).toHaveLength(1);
  expect(refs[0]?.sourceKind).toBe("avis-publics");

  const raw = await adapter.fetch(refs[0] as RawDocumentRef);

  expect(adapter.hash(raw)).toMatch(/^[a-f0-9]{64}$/);
  expect(raw.provenance.adapterVersion).toBe(adapter.version);
  expectTypeOf(raw.sourceKind).toEqualTypeOf<SourceKind>();
});
