// Cloud Function (gen2, nodejs20) — the §5 3D-Tiles budget HARD-CAP (layer 2).
// Triggered by the `billing-guardrail` Pub/Sub topic (budget notifications). When the reported
// cost reaches the budget, it DISABLES the billable Map Tiles API (tile.googleapis.com) —
// cutting the billable spend WITHOUT touching the billing account (a GCP "budget cap" alone is
// only an ALERT; detaching billing would need a billing-account-scope grant we refuse — i-infra
// redesign, path B). tile.googleapis.com is the SOLE billable driver of this project, so disabling
// it kills the spend. 0 secret — auth is the deployed service account's ADC (`cap-billing-sa`, a
// PROJECT-scoped custom role: serviceusage.services.disable + .get ONLY — it KILLS but CANNOT
// re-enable; re-enable is a human step after proof, by least-priv design).
const { google } = require("googleapis");

const BILLABLE_SERVICE = "tile.googleapis.com";

exports.capBilling = async (pubsubEvent) => {
  const data = JSON.parse(Buffer.from(pubsubEvent.data, "base64").toString());
  if (!(data.costAmount >= data.budgetAmount)) return;
  const auth = await google.auth.getClient({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const serviceusage = google.serviceusage({ version: "v1", auth });
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  // Idempotent: disabling an already-disabled service is a no-op success (re-fired budget events
  // are safe). The SA has NO enable permission — this is a one-way kill by design.
  await serviceusage.services.disable({
    name: `projects/${projectId}/services/${BILLABLE_SERVICE}`,
  });
  console.log(`cap-billing: ${BILLABLE_SERVICE} désactivé sur ${projectId} (spend billable coupé)`);
};
