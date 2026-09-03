import { describe, it, expect, vi } from "vitest";
import { readTileKey, createSession, SessionMinter } from "./session-mint.js";

const OK_BODY = { session: "SESS-1", expiry: "1000", tileWidth: 256, tileHeight: 256, imageFormat: "png" };

/** Minimal Response-like stub cast to fetch — enough for the module's `.ok/.json/.text`. */
function fetchReturning(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  })) as unknown as typeof fetch;
}

describe("readTileKey (fail-closed)", () => {
  it("throws when the key is absent or blank", () => {
    expect(() => readTileKey({})).toThrow(/GOOGLE_TILE_KEY absent/);
    expect(() => readTileKey({ GOOGLE_TILE_KEY: "   " })).toThrow(/GOOGLE_TILE_KEY absent/);
  });
  it("returns the trimmed key when set", () => {
    expect(readTileKey({ GOOGLE_TILE_KEY: " k123 " })).toBe("k123");
  });
});

describe("createSession", () => {
  it("POSTs to createSession with the key and parses the session", async () => {
    const spy = vi.fn(fetchReturning(OK_BODY));
    const s = await createSession("K", { mapType: "satellite" }, spy as unknown as typeof fetch);
    expect(s.session).toBe("SESS-1");
    expect(s.expirySeconds).toBe(1000);
    expect(String(spy.mock.calls[0]![0])).toContain("createSession?key=K");
  });
  it("throws fail-loud on non-2xx", async () => {
    await expect(createSession("K", { mapType: "satellite" }, fetchReturning("denied", false, 403)))
      .rejects.toThrow(/HTTP 403/);
  });
  it("throws when session/expiry are missing", async () => {
    await expect(createSession("K", { mapType: "satellite" }, fetchReturning({ session: "s" })))
      .rejects.toThrow(/sans session\/expiry/);
  });
});

describe("SessionMinter (cache + refresh + single-flight)", () => {
  it("mints once, serves cached within validity, refreshes within the skew", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n += 1;
      return {
        ok: true, status: 200,
        json: async () => ({ ...OK_BODY, session: `SESS-${n}`, expiry: String(1000 + n) }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;
    const m = new SessionMinter({ mapType: "satellite" }, { key: "K", fetchFn, skewSeconds: 300 });
    const a = await m.get(600);        // empty → mint (expiry 1001, refresh-at 701)
    const b = await m.get(650);        // 701 > 650 → cached, no new fetch
    expect(b.session).toBe(a.session);
    expect(n).toBe(1);
    const c = await m.get(800);        // 701 <= 800 → refresh
    expect(c.session).not.toBe(a.session);
    expect(n).toBe(2);
  });

  it("single-flights concurrent refreshes into one createSession", async () => {
    let n = 0;
    const fetchFn = (async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, 5));
      return {
        ok: true, status: 200,
        json: async () => ({ ...OK_BODY, session: `SESS-${n}`, expiry: "9999" }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;
    const m = new SessionMinter({ mapType: "satellite" }, { key: "K", fetchFn });
    const [x, y] = await Promise.all([m.get(0), m.get(0)]);
    expect(x.session).toBe(y.session);
    expect(n).toBe(1);
  });
});
