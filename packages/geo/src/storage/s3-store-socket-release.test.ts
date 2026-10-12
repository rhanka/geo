/**
 * Regression for the 2026-10-12 geo-api outage: `/collections/:id/items` hung
 * for every city while `/collections` (served from the in-memory index) and the
 * static probes stayed green. Each `getStream` body pins one of the SDK pool's
 * 50 sockets until it is drained or destroyed, and nothing bounded the body
 * phase — so streams abandoned by clients leaked sockets until the pool was
 * exhausted. These tests pin that a {@link S3Store.getStream} body is always
 * released: on early stop, and after an idle bound even if never iterated.
 */

import { createServer, type AddressInfo, type Socket } from "node:net";
import { PassThrough } from "node:stream";

import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { S3Store } from "./s3-store.js";

/** A client whose GetObject body is a real Node stream (as the SDK returns). */
function streamingClient(): { client: S3Client; bodies: PassThrough[] } {
  const bodies: PassThrough[] = [];
  const send = async () => {
    const body = new PassThrough();
    body.write(new TextEncoder().encode('{"type":"FeatureCollection",'));
    bodies.push(body);
    return { Body: body };
  };
  return { client: { send } as unknown as S3Client, bodies };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("S3Store.getStream releases its pooled socket", () => {
  it("destroys a body that is never iterated once the idle bound elapses", async () => {
    const { client, bodies } = streamingClient();
    const store = new S3Store({ bucket: "b", client, bodyIdleTimeoutMs: 30 });

    const stream = await store.getStream("k");
    expect(stream).toBeDefined();
    expect(bodies[0]!.destroyed).toBe(false);

    await sleep(80);
    expect(bodies[0]!.destroyed).toBe(true);
  });

  it("destroys a body when S3 stalls while a chunk is awaited, and the read fails instead of hanging", async () => {
    const { client, bodies } = streamingClient();
    const store = new S3Store({ bucket: "b", client, bodyIdleTimeoutMs: 30 });

    const iterator = (await store.getStream("k"))![Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    // S3 sends nothing more: the pending next() must not hang.
    await expect(iterator.next()).rejects.toThrow();
    expect(bodies[0]!.destroyed).toBe(true);
  });

  it("destroys the body when the consumer holds one chunk past the hold bound (stopped reading, still connected)", async () => {
    const { client, bodies } = streamingClient();
    const store = new S3Store({ bucket: "b", client, bodyIdleTimeoutMs: 60_000, bodyHoldTimeoutMs: 30 });

    const iterator = (await store.getStream("k"))![Symbol.asyncIterator]();
    await iterator.next();
    await sleep(80);
    expect(bodies[0]!.destroyed).toBe(true);
  });

  it("keeps the body while a slow consumer holds a chunk (downstream backpressure)", async () => {
    const { client, bodies } = streamingClient();
    const store = new S3Store({ bucket: "b", client, bodyIdleTimeoutMs: 30 });

    const iterator = (await store.getStream("k"))![Symbol.asyncIterator]();
    await iterator.next();
    await sleep(80); // consumer paused for longer than the idle bound
    expect(bodies[0]!.destroyed).toBe(false);

    bodies[0]!.end('"end":0}');
    const rest: string[] = [];
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) {
      rest.push(new TextDecoder().decode(next.value));
    }
    expect(rest.join("")).toContain('"end":0}');
  });

  it("get(): a body that stalls after its headers is destroyed and the read fails instead of hanging", async () => {
    const { client, bodies } = streamingClient();
    const store = new S3Store({ bucket: "b", client, bodyIdleTimeoutMs: 30 });

    await expect(store.get("k")).rejects.toThrow();
    expect(bodies[0]!.destroyed).toBe(true);
  });

  it("destroys the body as soon as the consumer stops early", async () => {
    const { client, bodies } = streamingClient();
    const store = new S3Store({ bucket: "b", client, bodyIdleTimeoutMs: 60_000 });

    const iterator = (await store.getStream("k"))![Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(bodies[0]!.destroyed).toBe(true);
  });

  it("with httpTimeouts, a request to an endpoint that never answers fails instead of hanging (real SDK)", async () => {
    const sockets: Socket[] = [];
    const server = createServer((socket) => sockets.push(socket)); // accepts, never responds
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const store = new S3Store({
        bucket: "b",
        endpoint: `http://127.0.0.1:${port}`,
        region: "us-east-1",
        accessKeyId: "test",
        secretAccessKey: "test",
        forcePathStyle: true,
        httpTimeouts: { connectionTimeoutMs: 1_000, requestTimeoutMs: 300 },
      });
      const started = Date.now();
      await expect(store.has("k")).rejects.toThrow(/requestTimeout|timed out|TimeoutError/i);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps an actively read body alive past the idle bound", async () => {
    const { client, bodies } = streamingClient();
    const store = new S3Store({ bucket: "b", client, bodyIdleTimeoutMs: 40 });

    const chunks: string[] = [];
    const reading = (async () => {
      for await (const chunk of (await store.getStream("k"))!) chunks.push(new TextDecoder().decode(chunk));
    })();
    // Chunks keep flowing every 20 ms for 100 ms: never idle for 40 ms.
    for (let i = 0; i < 5; i++) {
      await sleep(20);
      bodies[0]!.write(new TextEncoder().encode(`"c${i}":0,`));
    }
    bodies[0]!.end('"end":0}');
    await reading;

    expect(chunks.join("")).toContain('"end":0}');
  });
});
