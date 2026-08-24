/**
 * Shared in-cluster Kubernetes REST transport (node:https + the projected SA
 * token/CA). One small client behind the Jobs / ResourceQuota / Lease adapters, so
 * the transport lives in ONE place. Credentials/host are read lazily so importing
 * a module that builds a client never touches the filesystem (keeps callers unit-
 * testable — tests inject a fake {@link K8sRest} instead of constructing this).
 */

import { readFileSync } from "node:fs";
import { request as httpsRequest } from "node:https";

const TOKEN_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/token";
const CA_PATH = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";

/** Minimal REST surface: a single JSON call with a numeric HTTP status on error. */
export interface K8sRest {
  json<T>(method: string, path: string, body?: unknown, contentType?: string): Promise<T>;
}

/** HTTP status carried on a rejected {@link K8sRest.json}, or null if not an API error. */
export function httpStatusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: unknown };
  return typeof e.status === "number" ? e.status : null;
}

/** Build the real in-cluster REST client. Throws if not running in a cluster. */
export function inClusterRest(): K8sRest {
  const host = process.env["KUBERNETES_SERVICE_HOST"];
  const port = Number(process.env["KUBERNETES_SERVICE_PORT_HTTPS"] ?? process.env["KUBERNETES_SERVICE_PORT"] ?? "443");
  if (!host) throw new Error("KUBERNETES_SERVICE_HOST is required (must run in-cluster)");
  const token = readFileSync(TOKEN_PATH, "utf8").trim();
  const ca = readFileSync(CA_PATH);

  return {
    json<T>(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<T> {
      const serialized = body === undefined ? undefined : JSON.stringify(body);
      return new Promise<T>((resolve, reject) => {
        const req = httpsRequest(
          {
            hostname: host,
            port,
            path,
            method,
            ca,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              ...(serialized === undefined ? {} : { "Content-Type": contentType, "Content-Length": Buffer.byteLength(serialized) }),
            },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
            res.on("error", reject);
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              const code = res.statusCode ?? 0;
              if (code < 200 || code >= 300) {
                const error = new Error(`k8s ${method} ${path}: HTTP ${code} ${text.slice(0, 600)}`) as Error & { status?: number };
                error.status = code;
                reject(error);
                return;
              }
              resolve(text ? (JSON.parse(text) as T) : ({} as T));
            });
          },
        );
        req.on("error", reject);
        if (serialized !== undefined) req.write(serialized);
        req.end();
      });
    },
  };
}
