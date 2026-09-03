// Cloud Function (gen2, nodejs20) — the §5 3D-Tiles budget HARD-CAP (layer 2).
// Triggered by the `billing-guardrail` Pub/Sub topic (budget notifications). When the
// reported cost reaches the budget, it DETACHES billing from the project (the real
// hard-cap; a GCP "budget cap" alone is only an ALERT). 0 secret — auth is the deployed
// service account's ADC (`cap-billing-sa`, role billing.projectManager).
const { google } = require("googleapis");

exports.capBilling = async (pubsubEvent) => {
  const data = JSON.parse(Buffer.from(pubsubEvent.data, "base64").toString());
  if (!(data.costAmount >= data.budgetAmount)) return;
  const auth = await google.auth.getClient({
    scopes: ["https://www.googleapis.com/auth/cloud-billing"],
  });
  const billing = google.cloudbilling({ version: "v1", auth });
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  await billing.projects.updateBillingInfo({
    name: `projects/${projectId}`,
    requestBody: { billingAccountName: "" },
  });
  console.log(`cap-billing: billing détaché de ${projectId}`);
};
