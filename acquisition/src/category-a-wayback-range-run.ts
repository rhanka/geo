/**
 * Runner cluster des PDF Wayback tronqués. Chaque plage passe par
 * capturedFetch et est déposée en CAS avant que la suivante ne soit demandée.
 */
import { fileURLToPath } from "node:url";

import {
  capturedFetch,
  type CaptureRequestInit,
} from "../../packages/qc-sources/src/capture/index.js";
import { RobotsCache } from "../../packages/qc-sources/src/sources/robots-txt.js";
import { capturedRobotsFetch } from "./capture-worklist-run.js";
import {
  WAYBACK_RANGE_BYTES,
  categoryAWaybackRangeRequests,
  parseCategoryAWaybackRangeWorklist,
} from "./lib/category-a-wayback-range.js";
import { CAPTURE_USER_AGENT, openCaptureRun } from "./lib/capture-s3.js";
import { getBytes, s3Client } from "./lib/s3.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} est requis`);
  return value;
}

function index(): number {
  const value = Number(required("TARGET_INDEX"));
  if (!Number.isInteger(value) || value < 0) throw new Error("TARGET_INDEX invalide");
  return value;
}

async function main(): Promise<void> {
  const worklistKey = required("WORKLIST");
  const targetIndex = index();
  const runStamp = required("RUN_STAMP");
  const pod = (process.env["POD_UID"] ?? process.env["HOSTNAME"] ?? "manual")
    .replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const s3 = s3Client();
  const worklist = parseCategoryAWaybackRangeWorklist(
    JSON.parse((await getBytes(s3, worklistKey)).toString("utf8")),
  );
  const target = worklist.targets[targetIndex];
  if (target === undefined) throw new Error(`TARGET_INDEX=${targetIndex} hors worklist`);
  const run = openCaptureRun({
    lane: "normes",
    runId: `normes-${runStamp}-a-wayback-range-${targetIndex}-${pod}`,
    s3,
    userAgent: CAPTURE_USER_AGENT,
    worklist: worklistKey,
    flushEvery: 1,
  });
  const robots = new RobotsCache({
    userAgent: CAPTURE_USER_AGENT,
    fetchImpl: capturedRobotsFetch(run),
    log: (message) => run.log(message),
  });
  let exitCode = 0;
  try {
    const common: CaptureRequestInit = {
      method: "GET",
      headers: {
        "user-agent": run.userAgent,
        accept: "application/pdf,application/octet-stream,*/*",
      },
    };
    const first = await capturedFetch(target.url, common, {
      run,
      source: "normes-density-wayback-document",
      slugs: [target.slug],
      robots,
      retainBody: true,
      maxBytes: WAYBACK_RANGE_BYTES,
      timeoutMs: 120_000,
    });
    if (
      !first.ok
      || first.bytes === null
      || first.bytes.length !== WAYBACK_RANGE_BYTES
      || Buffer.from(first.bytes.subarray(0, 5)).toString("latin1") !== "%PDF-"
    ) throw new Error(`premier MiB Wayback invalide: ${target.url}`);

    const probe = await capturedFetch(target.url, {
      ...common,
      headers: { ...common.headers, range: "bytes=0-0" },
    }, {
      run,
      source: "normes-density-wayback-range-probe",
      slugs: [target.slug],
      robots,
      retainBody: true,
      maxBytes: 2,
      timeoutMs: 120_000,
    });
    const contentRange = probe.response?.headers.get("content-range") ?? null;
    const totalLength = Number(/^bytes\s+0-0\/(\d+)$/i.exec(contentRange ?? "")?.[1]);
    if (
      !probe.ok
      || probe.bytes === null
      || probe.bytes.length !== 1
      || !Number.isInteger(totalLength)
      || totalLength <= WAYBACK_RANGE_BYTES
    ) {
      throw new Error(
        `sonde Content-Range invalide: status=${probe.line.http_status} `
        + `header=${contentRange ?? "null"} bytes=${probe.bytes?.length ?? 0}`,
      );
    }
    const requests = categoryAWaybackRangeRequests(totalLength);
    if (requests.length === 0) {
      throw new Error(`PDF Wayback hors borne de 65 MiB: ${totalLength}`);
    }
    for (const request of requests) {
      const source = [
        "normes-density-wayback-range",
        String(request.start).padStart(9, "0"),
        String(request.end).padStart(9, "0"),
        request.last ? "last" : "more",
      ].join("-");
      const result = await capturedFetch(target.url, {
        ...common,
        headers: {
          ...common.headers,
          range: `bytes=${request.start}-${request.end}`,
        },
      }, {
        run,
        source,
        slugs: [target.slug],
        robots,
        retainBody: true,
        maxBytes: WAYBACK_RANGE_BYTES + 1,
        timeoutMs: 120_000,
      });
      const expected = request.end - request.start + 1;
      if (!result.ok || result.bytes === null || result.bytes.length !== expected) {
        throw new Error(
          `plage Wayback ${request.start}-${request.end}: `
          + `${result.bytes?.length ?? 0}/${expected} octets`,
        );
      }
      if (Buffer.from(result.bytes.subarray(0, 5)).toString("latin1") === "%PDF-") {
        throw new Error(`Wayback a ignoré Range à ${request.start}: ${target.url}`);
      }
    }
    run.log(
      `[category-a-wayback-range] complete slug=${target.slug} total=${totalLength} `
      + `cdx_length=${target.cdxLength ?? "null"} ${target.url}`,
    );
  } catch (error) {
    exitCode = 1;
    run.log(
      `[category-a-wayback-range] fatal ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    await run.finish(exitCode);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
