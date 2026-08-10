import { describe, expect, it } from "vitest";

import { parseArgs } from "./k8s-capture-run.js";

describe("parseArgs", () => {
  it("should default to the capture image that accepts derived normes worklists", () => {
    expect(parseArgs([
      "--lane", "normes",
      "--worklist", "acquisition/config/normes-col6-subpages-20260810.json",
      "--kubeconfig", "/tmp/ovh.kubeconfig",
    ]).image).toBe("rg.fr-par.scw.cloud/sentropic-geo/geo-capture:normes-pdf-aa66adf5");
  });
});
