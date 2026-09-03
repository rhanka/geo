// Cloud Function (gen2, nodejs20) — the §5 3D-Tiles budget HARD-CAP (layer 2).
// Triggered by the `billing-guardrail` Pub/Sub topic. When the reported cost reaches the budget,
// it sets the CONSUMER QUOTA to 0 on every CHARGED Map Tiles metric of tile.googleapis.com — the
// API then serves 0 requests/min, cutting the billable spend WITHOUT touching the billing account
// or disabling the API. (Path A needed a billing-account-scope grant we refuse; path B — the SA
// cannot disable tile even with serviceUsageAdmin. Empirically proven, k8s probe rc=0: a SA CAN
// set a consumer quota override to 0.)
//
// ⚠ KILL-ONLY at the CODE level, NOT the permission level. `serviceusage.quotas.update` is
// BIDIRECTIONAL (it could also RAISE a quota) — unlike path-B's `services.disable`, where the SA
// simply lacked re-enable. It is the MINIMAL permission for consumer overrides (GCP has no
// decrease-only grain). Kill-only is enforced HERE, in committed code: OVERRIDE_VALUE is a
// hardcoded "0" constant (raising the quota would need a CODE change → PR-gated + re-ratified),
// the SA is invoked ONLY by the budget Pub/Sub trigger (never interactively), and re-raising the
// quota (to restore service after proof) is a HUMAN project-scoped step. 0 secret — ADC of cap-billing-sa.
const { google } = require("googleapis");

// Kill-only, HARDCODED: the Function ONLY ever sets the override to 0. Never a param/env.
const OVERRIDE_VALUE = "0";

// The CHARGED Map Tiles metrics (skip uncharged_bucket — free). Capping the per-project per-minute
// limit of each to 0 kills the billable request rate. The metric + limit id are URL-encoded in the
// Service Usage resource path (measured read-back, k8s: `tile.googleapis.com%2F<metric>`, `%2Fmin%2Fproject`).
const CHARGED_METRICS = [
  "twodtiles",
  "threedtiles_renderer_request",
  "threedtiles_root_tileset",
  "streetviewtiles",
];
const LIMIT_ID = "%2Fmin%2Fproject";

exports.capBilling = async (pubsubEvent) => {
  const data = JSON.parse(Buffer.from(pubsubEvent.data, "base64").toString());
  if (!(data.costAmount >= data.budgetAmount)) return;
  const auth = await google.auth.getClient({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  // consumerQuotaMetrics / consumerOverrides live in the v1beta1 Service Usage API (v1 has only
  // services.enable/disable/list). GOOGLE_CLOUD_PROJECT is the project ID — the API resolves it to
  // the number (measured, k8s), so no resource-manager lookup is needed.
  const serviceusage = google.serviceusage({ version: "v1beta1", auth });
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const overrides = serviceusage.services.consumerQuotaMetrics.limits.consumerOverrides;
  for (const metric of CHARGED_METRICS) {
    const parent =
      `projects/${projectId}/services/tile.googleapis.com` +
      `/consumerQuotaMetrics/tile.googleapis.com%2F${metric}/limits/${LIMIT_ID}`;
    try {
      await overrides.create({ parent, force: true, requestBody: { overrideValue: OVERRIDE_VALUE } });
      console.log(`cap-billing: consumer override=${OVERRIDE_VALUE} créé sur ${metric}`);
    } catch (err) {
      // ONLY ALREADY_EXISTS (a re-fired budget event) is the idempotent case → patch existing to 0.
      // Any OTHER create error (e.g. a role/permission gap) is the REAL failure: log it explicitly
      // and re-throw. A blind list() fallback would fail for the same reason and MASK the true cause
      // — measured: a create-path role gap surfaced only as a "get quota" denial from this catch's
      // list(), hiding the create error. Surface create first so the cause is diagnosable in one line.
      const status = err && (err.code || (err.response && err.response.status));
      const alreadyExists = status === 409 || /already exists/i.test((err && err.message) || "");
      if (!alreadyExists) {
        console.error(`cap-billing: ÉCHEC create override sur ${metric}: ${(err && err.message) || err}`);
        throw err;
      }
      const list = await overrides.list({ parent });
      const existing = list.data.overrides || [];
      if (existing.length === 0) throw err;
      for (const ov of existing) {
        await overrides.patch({
          name: ov.name,
          force: true,
          updateMask: "overrideValue",
          requestBody: { overrideValue: OVERRIDE_VALUE },
        });
      }
      console.log(`cap-billing: consumer override=${OVERRIDE_VALUE} patché sur ${metric}`);
    }
  }
  console.log(`cap-billing: quota tile capé à ${OVERRIDE_VALUE} sur ${CHARGED_METRICS.length} métriques (${projectId})`);
};
