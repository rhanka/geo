import { describe, expect, it } from "vitest";

import { schemaIngestArgs } from "./captured-normes-extract.js";

describe("schemaIngestArgs", () => {
  it("invokes only the strict Mistral schema runner, never a GPT-capable batch route", () => {
    const args = schemaIngestArgs(
      { slug: "saint-roch-de-lachigan", url: "https://sra.quebec/grille.pdf" },
      "/geo/work/zonage-norms/saint-roch-de-lachigan/grille.pdf",
      5,
    );
    expect(args[0]).toMatch(/zonage-norms-schema-ingest\.ts$/);
    expect(args).toEqual(expect.arrayContaining(["--engine", "mistral-schema", "--deposit"]));
    expect(args.join(" ")).not.toContain("zonage-norms-run.ts");
    expect(args.join(" ")).not.toMatch(/gpt/i);
  });

  it("does not expose a force option that could overwrite an existing parquet", () => {
    const args = schemaIngestArgs(
      { slug: "saint-roch-de-lachigan", url: "https://sra.quebec/grille.pdf" },
      "/geo/work/zonage-norms/saint-roch-de-lachigan/grille.pdf",
      5,
    );
    expect(args).not.toContain("--force");
  });
});
