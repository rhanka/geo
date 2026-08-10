import { describe, expect, it, vi } from "vitest";

import { abort, runWithCaptureFinalization } from "./zones-arcgis-replace.js";

describe("zones-arcgis-replace capture finalization", () => {
  it("closes a failed capture before surfacing an abort", async () => {
    const finish = vi.fn(async (_exitCode: number) => undefined);

    await expect(runWithCaptureFinalization(async () => abort("ABORT gate"), finish)).rejects.toThrow("ABORT gate");

    expect(finish).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(1);
  });

  it("closes a successful capture with exit code zero", async () => {
    const finish = vi.fn(async (_exitCode: number) => undefined);

    await expect(runWithCaptureFinalization(async () => "deposited", finish)).resolves.toBe("deposited");

    expect(finish).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith(0);
  });
});
