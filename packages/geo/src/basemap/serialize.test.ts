import { describe, it, expect } from "vitest";

import { serializeMint, GOOGLE_2D_TILE_TEMPLATE } from "./serialize.js";
import type { GoogleSession } from "./session-mint.js";

const session: GoogleSession = {
  session: "SESS-abc",
  expirySeconds: 1000,
  tileWidth: 256,
  tileHeight: 256,
  imageFormat: "jpeg",
};
const KEY = "KEY-xyz-789";

describe("serializeMint", () => {
  it("public descriptor uses the template base ({z}/{x}/{y}) and leaks NEITHER token NOR key (§3.3)", () => {
    const r = serializeMint(session, { attribution: { mode: "static", text: "©G" } }, KEY);
    expect(r.source.tileUrlTemplateBase).toBe(GOOGLE_2D_TILE_TEMPLATE);
    expect(r.source.tileUrlTemplateBase).not.toContain("session");
    expect(r.source.tileUrlTemplateBase).not.toContain("key");
    // The whole PUBLIC descriptor must carry NEITHER the session token NOR the key (geo-archi cond 1).
    const src = JSON.stringify(r.source);
    expect(src).not.toContain("SESS-abc");
    expect(src).not.toContain(KEY);
  });

  it("carries tileSize / imageFormat from the Google session and the attribution from config", () => {
    const r = serializeMint(session, { attribution: { mode: "dynamic" } }, KEY);
    expect(r.source.tileSize).toEqual({ width: 256, height: 256 });
    expect(r.source.imageFormat).toBe("jpeg");
    expect(r.source.attribution).toEqual({ mode: "dynamic" });
  });

  it("keeps the session SEPARATE (adapter-internal) with token + expiry + KEY (geo-archi ruling a)", () => {
    const r = serializeMint(session, { attribution: { mode: "static", text: "©G" } }, KEY);
    expect(r.session).toEqual({ session: "SESS-abc", expirySeconds: 1000, key: KEY });
  });

  it("honours a tileUrlTemplateBase override", () => {
    const r = serializeMint(
      session,
      { attribution: { mode: "static", text: "©G" }, tileUrlTemplateBase: "https://x/{z}/{x}/{y}" },
      KEY,
    );
    expect(r.source.tileUrlTemplateBase).toBe("https://x/{z}/{x}/{y}");
  });
});
