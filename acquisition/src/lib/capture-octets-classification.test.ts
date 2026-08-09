import { describe, expect, it } from "vitest";

import { classifyCapturedOctets, isGeometryCapture } from "./capture-octets-classification.js";

const bytes = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

describe("classifyCapturedOctets", () => {
  it("requires parsed GeoJSON features with coordinates", () => {
    expect(classifyCapturedOctets(bytes({
      type: "FeatureCollection",
      features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[-72.5, 46.1], [-72.4, 46.1], [-72.5, 46.1]]] }, properties: {} }],
    }), "application/geo+json")).toEqual({
      classification: "GEOMETRIE",
      detail: "json-features-with-coordinates",
      coordinate_features: 1,
    });
  });

  it("recognizes ArcGIS JSON rings as feature geometry", () => {
    expect(classifyCapturedOctets(bytes({
      geometryType: "esriGeometryPolygon",
      features: [{ attributes: { zone: "R-1" }, geometry: { rings: [[[-72.5, 46.1], [-72.4, 46.1], [-72.5, 46.1]]] } }],
    }), "application/json")).toMatchObject({ classification: "GEOMETRIE", coordinate_features: 1 });
  });

  it("does not accept JSON metadata or empty geometry features", () => {
    expect(classifyCapturedOctets(bytes({ name: "Zonage", type: "Feature Layer" }), "application/json")).toMatchObject({
      classification: "AUTRE",
      detail: "json-without-features",
    });
    expect(classifyCapturedOctets(bytes({ features: [{ attributes: { zone: "R-1" }, geometry: null }] }), "application/json")).toMatchObject({
      classification: "AUTRE",
      detail: "json-features-without-coordinates",
      coordinate_features: 0,
    });
  });

  it("recognizes HTML from the opened body rather than its storage extension", () => {
    expect(classifyCapturedOctets(Buffer.from("<!doctype html><html><title>Layer</title></html>"), "text/html; charset=utf-8")).toMatchObject({
      classification: "PAGE HTML",
      detail: "html-document",
    });
  });

  it("keeps other binary bodies explicit", () => {
    expect(classifyCapturedOctets(Buffer.from("%PDF-1.7"), "application/pdf")).toMatchObject({
      classification: "AUTRE",
      detail: "pdf-bytes",
    });
  });

  it("permits a proof attestation only for a capture classified as geometry", () => {
    expect(isGeometryCapture(classifyCapturedOctets(bytes({
      features: [{ geometry: { x: -72.5, y: 46.1 } }],
    }), "application/json"))).toBe(true);
    expect(isGeometryCapture(classifyCapturedOctets(Buffer.from("<!doctype html><html></html>"), "text/html"))).toBe(false);
  });
});
