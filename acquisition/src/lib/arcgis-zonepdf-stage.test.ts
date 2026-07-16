import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ArcgisZonePdfStageError,
  assertAllowedHttpsUrl,
  assertPinnedArcgisPdfRedirect,
  assertStableItemMetadata,
  assertStableSourceFence,
  buildZonePdfContentManifest,
  canonicalZoneCode,
  chunkSortedObjectIds,
  collectZonePdfContentManifest,
  fetchFollowingAllowedRedirects,
  fetchPinnedArcgisPdfDownload,
  readResponseBytesBounded,
  validateArcgisItemMetadata,
  validatePdfBytes,
  validateSourceRecords,
  type ArcgisItemMetadata,
  type PdfEvidence,
  type SourceFence,
} from "./arcgis-zonepdf-stage.js";

const PDF_HOST = "mrcdemdy.maps.arcgis.com";
const PDF_REDIRECT_HOST = "www.arcgis.com";
const PDF_ITEMDATA_PATH_PREFIX = "/itemdata/92d347a7683b26a11dab76ccf9a5cac2";

function pdfUrl(itemId: string): string {
  return `https://${PDF_HOST}/sharing/rest/content/items/${itemId}/data`;
}

function itemId(index: number): string {
  return index.toString(16).padStart(32, "0");
}

function signedRedirectUrl(id: string, code: string, signature: string): string {
  return `https://${PDF_REDIRECT_HOST}${PDF_ITEMDATA_PATH_PREFIX}/${id}/${code}.pdf?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${signature}`;
}

function rawRecord(index: number, rawCode = `H-${index}`): Record<string, unknown> {
  const id = itemId(index);
  const url = pdfUrl(id);
  return {
    id: index,
    zones: rawCode,
    pdf: url,
    hyperlien: `<a href='${url}'target=_blank>Cliquez pour télécharger</a>`,
    groupe: "H   | Résidentielle",
  };
}

function fence(overrides: Partial<SourceFence> = {}): SourceFence {
  return {
    serviceItemId: "8d02d8f25e9648de9972663e930d3b11",
    serviceModified: 1_781_099_351_557,
    layerUrl:
      "https://services3.arcgis.com/D6yGeV5bY0BWDvJi/arcgis/rest/services/Plan_de_zonage_WFL1/FeatureServer/0",
    objectIdField: "id",
    editing: {
      lastEditDate: 1_781_099_351_557,
      schemaLastEditDate: 1_781_099_351_557,
      dataLastEditDate: 1_781_099_351_557,
    },
    count: 2,
    objectIds: [1, 2],
    ...overrides,
  };
}

function metadata(code: string, index: number, overrides: Partial<ArcgisItemMetadata> = {}): ArcgisItemMetadata {
  return {
    id: itemId(index),
    owner: "melement",
    title: code,
    type: "PDF",
    access: "public",
    created: 1_639_411_263_000,
    modified: 1_739_816_947_000,
    size: 92_158,
    ...overrides,
  };
}

function evidence(index: number): PdfEvidence {
  const body = Buffer.from(`%PDF-1.7\n${index} 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n`);
  return {
    finalUrl: pdfUrl(itemId(index)),
    redirectChain: [],
    contentType: "application/pdf",
    contentLength: body.length,
    byteLength: body.length,
    pageCount: 1,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

function captureError(run: () => unknown): ArcgisZonePdfStageError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ArcgisZonePdfStageError);
    return error as ArcgisZonePdfStageError;
  }
  throw new Error("expected ArcgisZonePdfStageError");
}

describe("source record validation", () => {
  it("should preserve raw identity and sort validated records by OID", () => {
    const records = validateSourceRecords([rawRecord(2), rawRecord(1)], {
      expectedCount: 2,
      pdfHosts: [PDF_HOST],
    });

    expect(records.map((record) => record.oid)).toEqual([1, 2]);
    expect(records[0]).toMatchObject({
      rawCode: "H-1",
      code: "H-1",
      itemId: itemId(1),
      group: "H   | Résidentielle",
      groupCode: "H",
    });
  });

  it.each([
    ["duplicate OID", [rawRecord(1), rawRecord(1)], "DUPLICATE_OID"],
    [
      "duplicate code",
      [rawRecord(1), { ...rawRecord(2), zones: "H-1" }],
      "DUPLICATE_CODE",
    ],
    [
      "duplicate PDF",
      [rawRecord(1), { ...rawRecord(2), pdf: pdfUrl(itemId(1)), hyperlien: `<a href='${pdfUrl(itemId(1))}'>PDF</a>` }],
      "DUPLICATE_PDF",
    ],
  ])("should reject %s", (_label, records, code) => {
    const error = captureError(() =>
      validateSourceRecords(records as Array<Record<string, unknown>>, {
        expectedCount: 2,
        pdfHosts: [PDF_HOST],
      }),
    );
    expect(error.code).toBe(code);
  });

  it("should reject distinct raw codes that collide after canonicalization", () => {
    const error = captureError(() =>
      validateSourceRecords([rawRecord(1, "H-59"), rawRecord(2, " h – 59 ")], {
        expectedCount: 2,
        pdfHosts: [PDF_HOST],
      }),
    );
    expect(error.code).toBe("CANONICAL_CODE_COLLISION");
  });

  it("should reject a PDF/hyperlink mismatch", () => {
    const record = rawRecord(1);
    record.hyperlien = `<a href='${pdfUrl(itemId(2))}'>wrong</a>`;
    expect(
      captureError(() =>
        validateSourceRecords([record], { expectedCount: 1, pdfHosts: [PDF_HOST] }),
      ).code,
    ).toBe("PDF_HYPERLINK_MISMATCH");
  });

  it("should reject a group that contradicts the zone prefix", () => {
    const record = rawRecord(1);
    record.groupe = "C | Commerciale";
    expect(
      captureError(() =>
        validateSourceRecords([record], { expectedCount: 1, pdfHosts: [PDF_HOST] }),
      ).code,
    ).toBe("GROUP_CODE_MISMATCH");
  });

  it("should allow only the exact frozen OID 71 A4-106/A3 source exception", () => {
    const record = rawRecord(71, "A4-106");
    record.groupe = "A3 | Agricole - Industrielle";
    const exactException = [{ oid: 71, code: "A4-106", groupCode: "A3" }] as const;

    expect(
      validateSourceRecords([record], {
        expectedCount: 1,
        pdfHosts: [PDF_HOST],
        sourceGroupExceptions: exactException,
      })[0],
    ).toMatchObject({ oid: 71, code: "A4-106", groupCode: "A3" });

    expect(
      captureError(() =>
        validateSourceRecords([record], {
          expectedCount: 1,
          pdfHosts: [PDF_HOST],
          sourceGroupExceptions: [],
        }),
      ).code,
    ).toBe("GROUP_CODE_MISMATCH");

    for (const sourceGroupExceptions of [
      [{ oid: 72, code: "A4-106", groupCode: "A3" }],
      [{ oid: 71, code: "A4-107", groupCode: "A3" }],
      [{ oid: 71, code: "A4-106", groupCode: "A2" }],
    ]) {
      expect(() =>
        validateSourceRecords([record], {
          expectedCount: 1,
          pdfHosts: [PDF_HOST],
          sourceGroupExceptions,
        }),
      ).toThrow(ArcgisZonePdfStageError);
    }

    const upstreamCorrected = { ...record, groupe: "A4 | Agricole - Industrielle" };
    expect(
      captureError(() =>
        validateSourceRecords([upstreamCorrected], {
          expectedCount: 1,
          pdfHosts: [PDF_HOST],
          sourceGroupExceptions: exactException,
        }),
      ).code,
    ).toBe("SOURCE_GROUP_EXCEPTION_NOT_OBSERVED");
  });
});

describe("source fences and OID chunks", () => {
  it("should compare every source fence component", () => {
    expect(() => assertStableSourceFence(fence(), fence())).not.toThrow();
    const error = captureError(() =>
      assertStableSourceFence(fence(), fence({ editing: { ...fence().editing, dataLastEditDate: 2 } })),
    );
    expect(error.code).toBe("SOURCE_FENCE_MOVED");
  });

  it("should sort and chunk OIDs without offset pagination", () => {
    expect(chunkSortedObjectIds([9, 1, 5, 2], 2)).toEqual([
      [1, 2],
      [5, 9],
    ]);
    expect(() => chunkSortedObjectIds([1, 1], 2)).toThrow(/duplicate OID/i);
  });
});

describe("URL and redirect fences", () => {
  it("should allow HTTPS on an exact host only", () => {
    expect(assertAllowedHttpsUrl(pdfUrl(itemId(1)), [PDF_HOST]).hostname).toBe(PDF_HOST);
    expect(() => assertAllowedHttpsUrl("http://mrcdemdy.maps.arcgis.com/file.pdf", [PDF_HOST])).toThrow(
      /HTTPS/i,
    );
    expect(() => assertAllowedHttpsUrl("https://evil.test/file.pdf", [PDF_HOST])).toThrow(
      /host/i,
    );
    expect(() => assertAllowedHttpsUrl(`https://${PDF_HOST}:444/file.pdf`, [PDF_HOST])).toThrow(
      /port/i,
    );
  });

  it("should pin the real ArcGIS redirect host, itemdata path, item id and HTTPS port", () => {
    const id = itemId(1);
    const valid = signedRedirectUrl(id, "H-1", "first");
    expect(
      assertPinnedArcgisPdfRedirect(valid, {
        redirectHost: PDF_REDIRECT_HOST,
        itemDataPathPrefix: PDF_ITEMDATA_PATH_PREFIX,
        expectedItemId: id,
        expectedCode: "H-1",
      }).pathname,
    ).toBe(`${PDF_ITEMDATA_PATH_PREFIX}/${id}/H-1.pdf`);

    const invalidTargets = [
      valid.replace(PDF_REDIRECT_HOST, "evil.test"),
      valid.replace(PDF_ITEMDATA_PATH_PREFIX, "/itemdata/unpinned"),
      valid.replace(id, itemId(2)),
      valid.replace("H-1.pdf", "H-2.pdf"),
      valid.replace(`https://${PDF_REDIRECT_HOST}`, `https://${PDF_REDIRECT_HOST}:444`),
    ];
    for (const target of invalidTargets) {
      expect(() =>
        assertPinnedArcgisPdfRedirect(target, {
          redirectHost: PDF_REDIRECT_HOST,
          itemDataPathPrefix: PDF_ITEMDATA_PATH_PREFIX,
          expectedItemId: id,
          expectedCode: "H-1",
        }),
      ).toThrow(ArcgisZonePdfStageError);
    }
  });

  it("should reject a redirect to an untrusted host before following it", async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      calls.push(String(input));
      expect(init).toMatchObject({ method: "GET", redirect: "manual" });
      return new Response(null, { status: 302, headers: { location: "https://evil.test/file.pdf" } });
    };

    await expect(
      fetchFollowingAllowedRedirects(fakeFetch, pdfUrl(itemId(1)), [PDF_HOST]),
    ).rejects.toMatchObject({ code: "URL_HOST_NOT_ALLOWED" });
    expect(calls).toEqual([pdfUrl(itemId(1))]);
  });

  it("should reject zero or two PDF redirects and never follow a third request", async () => {
    const id = itemId(1);
    const source = { pdfUrl: pdfUrl(id), itemId: id, code: "H-1" };
    const config = {
      pdfHosts: [PDF_HOST],
      pdfRedirectHost: PDF_REDIRECT_HOST,
      pdfItemDataPathPrefix: PDF_ITEMDATA_PATH_PREFIX,
    };

    await expect(
      fetchPinnedArcgisPdfDownload(async () => new Response("direct", { status: 200 }), source, config),
    ).rejects.toMatchObject({ code: "PDF_REDIRECT_CHAIN_MISMATCH" });

    const calls: string[] = [];
    const twoRedirects: typeof fetch = async (input) => {
      calls.push(String(input));
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: signedRedirectUrl(id, source.code, "first") },
        });
      }
      if (calls.length === 2) {
        return new Response(null, {
          status: 302,
          headers: { location: signedRedirectUrl(id, source.code, "second") },
        });
      }
      throw new Error("third request must not be followed");
    };
    await expect(fetchPinnedArcgisPdfDownload(twoRedirects, source, config)).rejects.toMatchObject({
      code: "PDF_REDIRECT_CHAIN_MISMATCH",
    });
    expect(calls).toHaveLength(2);
  });
});

describe("ArcGIS item and PDF evidence", () => {
  it("should validate exact item identity and stable T0/T1 metadata", () => {
    const item = metadata("H-59", 1);
    expect(
      validateArcgisItemMetadata(item, {
        expectedItemId: itemId(1),
        expectedCode: "H-59",
        expectedOwner: "melement",
        maxBytes: 1_000_000,
      }),
    ).toEqual(item);
    expect(() => assertStableItemMetadata(item, { ...item })).not.toThrow();
  });

  it("should reject a title mismatch", () => {
    const error = captureError(() =>
      validateArcgisItemMetadata(metadata("H-60", 1), {
        expectedItemId: itemId(1),
        expectedCode: "H-59",
        expectedOwner: "melement",
        maxBytes: 1_000_000,
      }),
    );
    expect(error.code).toBe("ITEM_TITLE_MISMATCH");
  });

  it("should reject an item mutation after download", () => {
    const t0 = metadata("H-59", 1);
    expect(
      captureError(() => assertStableItemMetadata(t0, { ...t0, modified: t0.modified + 1 })).code,
    ).toBe("ITEM_METADATA_MOVED");
  });

  it("should validate PDF magic, one page, trailer, size and hash", () => {
    const body = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n");
    const result = validatePdfBytes(body, {
      expectedBytes: body.length,
      contentLength: String(body.length),
      contentType: "application/pdf",
      minBytes: 10,
      maxBytes: 1_000,
    });
    expect(result).toMatchObject({ byteLength: body.length, pageCount: 1 });
    expect(result.sha256).toHaveLength(64);
  });

  it("should reject a truncated PDF", () => {
    const truncated = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n");
    expect(
      captureError(() =>
        validatePdfBytes(truncated, {
          expectedBytes: truncated.length,
          contentLength: String(truncated.length),
          contentType: "application/pdf",
          minBytes: 10,
          maxBytes: 1_000,
        }),
      ).code,
    ).toBe("PDF_TRAILER_MISSING");
  });

  it("should enforce Content-Length and a streaming cap before buffering an oversized body", async () => {
    let declaredBodyCancelled = false;
    const declaredTooLarge = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          declaredBodyCancelled = true;
        },
      }),
      { headers: { "content-length": "1001" } },
    );
    await expect(readResponseBytesBounded(declaredTooLarge, 1_000)).rejects.toMatchObject({
      code: "PDF_RESPONSE_SIZE_LIMIT",
    });
    expect(declaredBodyCancelled).toBe(true);

    let cancelled = false;
    const streamedTooLarge = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(600));
          controller.enqueue(new Uint8Array(600));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    await expect(readResponseBytesBounded(streamedTooLarge, 1_000)).rejects.toMatchObject({
      code: "PDF_RESPONSE_SIZE_LIMIT",
    });
    expect(cancelled).toBe(true);

    const cancellationFailure = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(1_001));
        },
        cancel() {
          throw new Error("cancel failed");
        },
      }),
    );
    await expect(readResponseBytesBounded(cancellationFailure, 1_000)).rejects.toMatchObject({
      code: "PDF_RESPONSE_SIZE_LIMIT",
    });
  });
});

describe("deterministic content manifest", () => {
  it("should emit the same SHA for the same 109-record fixture regardless of input order", () => {
    const rawRecords = Array.from({ length: 109 }, (_, index) => rawRecord(index + 1));
    const records = validateSourceRecords(rawRecords, {
      expectedCount: 109,
      pdfHosts: [PDF_HOST],
    });
    const entries = records.map((record) => {
      const item = metadata(record.code, record.oid, { size: evidence(record.oid).byteLength });
      return { source: record, itemT0: item, itemT1: { ...item }, pdf: evidence(record.oid) };
    });
    const sourceFence = fence({
      count: 109,
      objectIds: Array.from({ length: 109 }, (_, index) => index + 1),
    });

    const first = buildZonePdfContentManifest(sourceFence, sourceFence, entries);
    const second = buildZonePdfContentManifest(sourceFence, sourceFence, [...entries].reverse());

    expect(first.records).toHaveLength(109);
    expect(first.records.map((record) => record.oid)).toEqual(sourceFence.objectIds);
    expect(first.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
  });

  it("should purge signed query data and keep the manifest SHA stable across signatures", () => {
    const source = validateSourceRecords([rawRecord(1)], {
      expectedCount: 1,
      pdfHosts: [PDF_HOST],
    })[0]!;
    const item = metadata(source.code, source.oid, { size: evidence(source.oid).byteLength });
    const sourceFence = fence({ count: 1, objectIds: [1] });
    const manifestFor = (signature: string) => {
      const redirectUrl = signedRedirectUrl(source.itemId, source.code, signature);
      return buildZonePdfContentManifest(sourceFence, sourceFence, [
        {
          source,
          itemT0: item,
          itemT1: { ...item },
          pdf: {
            ...evidence(source.oid),
            finalUrl: redirectUrl,
            redirectChain: [redirectUrl],
          },
        },
      ]);
    };

    const first = manifestFor("first-secret-signature");
    const second = manifestFor("second-secret-signature");
    expect(second).toEqual(first);
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(JSON.stringify(first)).not.toContain("X-Amz");
    expect(JSON.stringify(first)).not.toContain("secret-signature");
  });

  it("should collect a fenced manifest through GET-only OID-chunk requests", async () => {
    const sourceItemId = "8d02d8f25e9648de9972663e930d3b11";
    const bodies = new Map(
      [1, 2].map((oid) => [
        oid,
        Buffer.from(`%PDF-1.7\n${oid} 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n`),
      ]),
    );
    const calls: Array<{ url: URL; init?: RequestInit }> = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      calls.push({ url, init });
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      expect(init?.body).toBeUndefined();

      const json = (value: unknown): Response =>
        new Response(JSON.stringify(value), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname.endsWith(`/content/items/${sourceItemId}`)) {
        return json({ id: sourceItemId, modified: 100 });
      }
      if (url.pathname.endsWith("/FeatureServer/0")) {
        return json({
          serviceItemId: sourceItemId,
          objectIdField: "id",
          editingInfo: { lastEditDate: 200, schemaLastEditDate: 200, dataLastEditDate: 200 },
        });
      }
      if (url.pathname.endsWith("/FeatureServer/0/query")) {
        if (url.searchParams.get("returnCountOnly") === "true") return json({ count: 2 });
        if (url.searchParams.get("returnIdsOnly") === "true") {
          return json({ objectIdFieldName: "id", objectIds: [2, 1] });
        }
        expect(url.searchParams.get("objectIds")).toBe("1,2");
        expect(url.searchParams.has("resultOffset")).toBe(false);
        return json({
          features: [
            { attributes: rawRecord(2) },
            { attributes: rawRecord(1) },
          ],
        });
      }
      const itemMatch = url.pathname.match(/\/content\/items\/([a-f0-9]{32})(\/data)?$/);
      if (itemMatch?.[2] === "/data") {
        const oid = Number.parseInt(itemMatch[1]!, 16);
        return new Response(null, {
          status: 302,
          headers: { location: signedRedirectUrl(itemMatch[1]!, `H-${oid}`, `signature-${oid}`) },
        });
      }
      const redirectedPdf = url.pathname.match(
        new RegExp(`^${PDF_ITEMDATA_PATH_PREFIX}/([a-f0-9]{32})/H-(\\d+)\\.pdf$`),
      );
      if (redirectedPdf) {
        const oid = Number.parseInt(redirectedPdf[2]!, 10);
        expect(redirectedPdf[1]).toBe(itemId(oid));
        const body = bodies.get(oid)!;
        return new Response(body, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-length": String(body.length),
          },
        });
      }
      if (itemMatch) {
        const oid = Number.parseInt(itemMatch[1]!, 16);
        return json(metadata(`H-${oid}`, oid, { size: bodies.get(oid)!.length }));
      }
      return new Response("not found", { status: 404 });
    };

    const manifest = await collectZonePdfContentManifest(fakeFetch, {
      layerUrl: "https://services3.arcgis.com/example/FeatureServer/0",
      portalUrl: `https://${PDF_HOST}`,
      serviceItemId: sourceItemId,
      expectedCount: 2,
      expectedItemOwner: "melement",
      sourceHosts: ["services3.arcgis.com"],
      portalHosts: [PDF_HOST],
      pdfHosts: [PDF_HOST],
      pdfRedirectHost: PDF_REDIRECT_HOST,
      pdfItemDataPathPrefix: PDF_ITEMDATA_PATH_PREFIX,
      sourceGroupExceptions: [],
      oidChunkSize: 2,
      minPdfBytes: 10,
      maxPdfBytes: 1_000,
    });

    expect(manifest.records.map((record) => record.code)).toEqual(["H-1", "H-2"]);
    expect(manifest.records.every((record) => record.pdf.pageCount === 1)).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("X-Amz");
    expect(calls).toHaveLength(17);
    expect(calls.every((call) => call.init?.method === "GET" && call.init.body === undefined)).toBe(true);

    bodies.set(
      2,
      Buffer.from(
        "%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n2 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n",
      ),
    );
    let pageCountError: unknown;
    try {
      await collectZonePdfContentManifest(fakeFetch, {
        layerUrl: "https://services3.arcgis.com/example/FeatureServer/0",
        portalUrl: `https://${PDF_HOST}`,
        serviceItemId: sourceItemId,
        expectedCount: 2,
        expectedItemOwner: "melement",
        sourceHosts: ["services3.arcgis.com"],
        portalHosts: [PDF_HOST],
        pdfHosts: [PDF_HOST],
        pdfRedirectHost: PDF_REDIRECT_HOST,
        pdfItemDataPathPrefix: PDF_ITEMDATA_PATH_PREFIX,
        sourceGroupExceptions: [],
        oidChunkSize: 2,
        minPdfBytes: 10,
        maxPdfBytes: 1_000,
      });
    } catch (error) {
      pageCountError = error;
    }
    expect(pageCountError).toMatchObject({
      code: "PDF_PAGE_COUNT_MISMATCH",
      details: {
        pageCount: 2,
        oid: 2,
        zoneCode: "H-2",
        itemId: itemId(2),
      },
      cause: expect.objectContaining({
        code: "PDF_PAGE_COUNT_MISMATCH",
        details: { pageCount: 2 },
      }),
    });
  });
});
