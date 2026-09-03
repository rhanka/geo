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

describe("serializeMint", () => {
  it("public descriptor uses the template base ({z}/{x}/{y}, NO session/key) and leaks no token", () => {
    const r = serializeMint(session, { attribution: { mode: "static", text: "©G" } });
    expect(r.source.tileUrlTemplateBase).toBe(GOOGLE_2D_TILE_TEMPLATE);
    expect(r.source.tileUrlTemplateBase).not.toContain("session");
    expect(r.source.tileUrlTemplateBase).not.toContain("key");
    // The whole PUBLIC descriptor must carry the session token nowhere (§3.3).
    expect(JSON.stringify(r.source)).not.toContain("SESS-abc");
  });

  it("carries tileSize / imageFormat from the Google session and the attribution from config", () => {
    const r = serializeMint(session, { attribution: { mode: "dynamic" } });
    expect(r.source.tileSize).toEqual({ width: 256, height: 256 });
    expect(r.source.imageFormat).toBe("jpeg");
    expect(r.source.attribution).toEqual({ mode: "dynamic" });
  });

  it("keeps the session SEPARATE (adapter-internal) with token + expiry", () => {
    const r = serializeMint(session, { attribution: { mode: "static", text: "©G" } });
    expect(r.session).toEqual({ session: "SESS-abc", expirySeconds: 1000 });
  });

  it("honours a tileUrlTemplateBase override", () => {
    const r = serializeMint(session, {
      attribution: { mode: "static", text: "©G" },
      tileUrlTemplateBase: "https://x/{z}/{x}/{y}",
    });
    expect(r.source.tileUrlTemplateBase).toBe("https://x/{z}/{x}/{y}");
  });
});
