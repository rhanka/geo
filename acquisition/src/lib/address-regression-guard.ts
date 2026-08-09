export class AddressRegressionGuardError extends Error {
  constructor(slug: string, detail: string, options?: ErrorOptions) {
    super(`ADDRESS_REGRESSION_GUARD ${slug}: ${detail}`, options);
    this.name = "AddressRegressionGuardError";
  }
}

interface ExistingEnrichStats {
  role?: {
    num_with_adresse?: unknown;
  } | null;
}

interface GuardedUploadOptions {
  slug: string;
  candidateAddressCount: number;
  readExistingStats: () => Promise<unknown | null>;
  uploadGeoJson: () => Promise<void>;
  uploadStats: () => Promise<void>;
}

interface ObjectStoreError {
  name?: string;
  Code?: string;
  code?: string;
  $metadata?: { httpStatusCode?: number };
}

function existingAddressCount(stats: unknown): number {
  if (!stats || typeof stats !== "object") return 0;
  const value = (stats as ExistingEnrichStats).role?.num_with_adresse;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/** Return null only for a confirmed missing object; every other read failure
 * stays fail-closed and prevents the guarded uploads. */
export async function readExistingStatsOrNull(
  readStats: () => Promise<unknown>,
): Promise<unknown | null> {
  try {
    return await readStats();
  } catch (error) {
    const err = error as ObjectStoreError;
    const codes = [err.name, err.Code, err.code];
    if (
      codes.includes("NoSuchKey") ||
      codes.includes("NotFound") ||
      err.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Keep the two canonical qc-lots uploads behind the same address-regression
 * guard. Existing stats are read only when the candidate has zero addresses,
 * whether that zero comes from --no-role or a degraded rôle-enabled run.
 */
export async function guardedQcLotsUpload(
  options: GuardedUploadOptions,
): Promise<void> {
  if (options.candidateAddressCount === 0) {
    let existingStats: unknown | null;
    try {
      existingStats = await options.readExistingStats();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new AddressRegressionGuardError(
        options.slug,
        `could not verify existing address stats (${reason}); uploads refused`,
        { cause: error },
      );
    }
    const count = existingAddressCount(existingStats);
    if (count > 0) {
      throw new AddressRegressionGuardError(
        options.slug,
        `candidate output has 0 addresses and would replace ` +
          `${count} existing addresses; uploads refused`,
      );
    }
  }

  await options.uploadGeoJson();
  await options.uploadStats();
}
