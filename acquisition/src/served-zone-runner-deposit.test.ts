import { describe, expect, it } from "vitest";

import { depositT1OcrServedZoneGeojson } from "./t1-ocr-build.js";
import { depositT1ServedZoneGeojson } from "./t1-build.js";
import { depositT2ServedZoneGeojson } from "./t2-build.js";

const KEY = "normalized/ca-qc-zonage/qc-zonage-alpha.geojson";
const PDF_URL = "https://zonage.example.org/reglement/plan-zonage.pdf";
const RETRIEVED_AT = "2026-07-26T12:00:00Z";

type Deposit = (
  s3: any,
  key: string,
  served: any,
  pdfUrl: string,
  pdfBytes: Buffer,
  retrievedAt: string,
) => Promise<void>;

const writers: ReadonlyArray<{ name: string; deposit: Deposit }> = [
  { name: "t1-build", deposit: depositT1ServedZoneGeojson },
  { name: "t1-ocr-build", deposit: depositT1OcrServedZoneGeojson },
  { name: "t2-build", deposit: depositT2ServedZoneGeojson },
];

function fakeS3(current: unknown) {
  const sent: Array<{ name: string; input: unknown }> = [];
  const s3 = {
    send: async (command: any) => {
      sent.push({ name: command.constructor.name, input: command.input });
      if (command.constructor.name === "HeadObjectCommand") return {};
      if (command.constructor.name === "GetObjectCommand") {
        return { Body: [Buffer.from(JSON.stringify(current))] };
      }
      return {};
    },
  };
  return { s3, sent };
}

for (const writer of writers) {
  describe(`${writer.name} served-zone deposit`, () => {
    it("should refuse an impoverishing replacement before its S3 write", async () => {
      const current = {
        type: "FeatureCollection",
        features: [{
          geometry: { type: "Point", coordinates: [-72, 45] },
          properties: {
            zone_code: "R-1",
            reglement_numero: "123",
            hauteur_max_value: 12,
          },
        }],
      };
      const replacement = {
        type: "FeatureCollection",
        features: [{
          geometry: { type: "Point", coordinates: [-72.01, 45.01] },
          properties: { zone_code: "R-1" },
        }],
      };
      const { s3, sent } = fakeS3(current);

      await expect(
        writer.deposit(s3, KEY, replacement, PDF_URL, Buffer.from("received PDF bytes"), RETRIEVED_AT),
      ).rejects.toThrow(/would remove served property key\(s\): hauteur_max_value, reglement_numero/);
      expect(sent.some((command) => command.name === "PutObjectCommand")).toBe(false);
    });
  });
}
