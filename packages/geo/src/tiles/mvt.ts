/**
 * Mapbox Vector Tile 2.1 encoder for polygon layers (protobuf via `pbf`).
 * https://github.com/mapbox/vector-tile-spec/tree/master/2.1
 *
 * Winding: exterior rings get a positive shoelace area in tile coordinates
 * (y down, clockwise on screen), holes a negative one, as the spec requires;
 * the encoder fixes the orientation of whatever it is given.
 */

import { PbfWriter } from "pbf";

import { ringArea2 } from "./geometry.js";
import type { TileValue } from "./profiles.js";

export interface MvtPolygonFeature {
  /** Unsigned integer feature id (optional). */
  id?: number;
  properties: Record<string, TileValue>;
  /** Polygons, each `[exterior, ...holes]`, rings open, tile-local integer coordinates. */
  polygons: Int32Array[][];
}

export interface MvtLayer {
  name: string;
  extent: number;
  features: MvtPolygonFeature[];
}

const Cmd = { MoveTo: 1, LineTo: 2, ClosePath: 7 } as const;

function command(id: number, count: number): number {
  return (id & 0x7) | (count << 3);
}

function zigzag(n: number): number {
  return (n << 1) ^ (n >> 31);
}

function encodeGeometry(polygons: Int32Array[][]): number[] {
  const out: number[] = [];
  let cx = 0;
  let cy = 0;
  for (const polygon of polygons) {
    polygon.forEach((ring, ri) => {
      const n = ring.length / 2;
      if (n < 3) return;
      const area = ringArea2(ring);
      const wantPositive = ri === 0;
      const reverse = area > 0 !== wantPositive;
      const at = (i: number): number => (reverse ? n - 1 - i : i);
      for (let i = 0; i < n; i++) {
        const k = at(i);
        const x = ring[2 * k]!;
        const y = ring[2 * k + 1]!;
        if (i === 0) out.push(command(Cmd.MoveTo, 1));
        else if (i === 1) out.push(command(Cmd.LineTo, n - 1));
        out.push(zigzag(x - cx), zigzag(y - cy));
        cx = x;
        cy = y;
      }
      out.push(command(Cmd.ClosePath, 1));
    });
  }
  return out;
}

function writeValue(value: TileValue, pbf: PbfWriter): void {
  if (typeof value === "string") pbf.writeStringField(1, value);
  else if (typeof value === "boolean") pbf.writeBooleanField(7, value);
  else if (Number.isSafeInteger(value)) {
    if (value >= 0) pbf.writeVarintField(5, value);
    else pbf.writeSVarintField(6, value);
  } else pbf.writeDoubleField(3, value);
}

interface EncodedLayer {
  layer: MvtLayer;
  keys: string[];
  values: TileValue[];
  tags: number[][];
}

function prepareLayer(layer: MvtLayer): EncodedLayer {
  const keyIndex = new Map<string, number>();
  const valueIndex = new Map<string, number>();
  const keys: string[] = [];
  const values: TileValue[] = [];
  const tags = layer.features.map((f) => {
    const t: number[] = [];
    for (const [k, v] of Object.entries(f.properties)) {
      let ki = keyIndex.get(k);
      if (ki === undefined) {
        ki = keys.length;
        keys.push(k);
        keyIndex.set(k, ki);
      }
      const vk = `${typeof v}:${String(v)}`;
      let vi = valueIndex.get(vk);
      if (vi === undefined) {
        vi = values.length;
        values.push(v);
        valueIndex.set(vk, vi);
      }
      t.push(ki, vi);
    }
    return t;
  });
  return { layer, keys, values, tags };
}

function writeLayer(enc: EncodedLayer, pbf: PbfWriter): void {
  pbf.writeVarintField(15, 2);
  pbf.writeStringField(1, enc.layer.name);
  enc.layer.features.forEach((f, i) => {
    pbf.writeMessage(
      2,
      (feature: MvtPolygonFeature, w: PbfWriter) => {
        if (feature.id !== undefined) w.writeVarintField(1, feature.id);
        w.writePackedVarint(2, enc.tags[i]!);
        w.writeVarintField(3, 3); // POLYGON
        w.writePackedVarint(4, encodeGeometry(feature.polygons));
      },
      f,
    );
  });
  for (const k of enc.keys) pbf.writeStringField(3, k);
  for (const v of enc.values) pbf.writeMessage(4, writeValue, v);
  pbf.writeVarintField(5, enc.layer.extent);
}

/** Encode layers into one MVT tile (uncompressed protobuf). Empty layers are skipped. */
export function encodeMvt(layers: readonly MvtLayer[]): Uint8Array {
  const pbf = new PbfWriter();
  for (const layer of layers) {
    if (layer.features.length === 0) continue;
    pbf.writeMessage(3, writeLayer, prepareLayer(layer));
  }
  return pbf.finish();
}
