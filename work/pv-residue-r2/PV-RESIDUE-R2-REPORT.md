# PV residue R2 — structured-source pass (2026-07-07)

## Net result
- New PV manifest deposited: `saint-robert` (`registry/qc-pv/saint-robert/index.json`).
- Reconcile: `pv=1045/1106 (+1)`; remaining PV coverage is now 61 non-done cells (`59 to-research`, `2 planned`).
- Track sync applied the PV transition plus concurrent coverage transitions from the matrix.

## Deposited evidence
- Source page: `https://www.saintrobert.qc.ca/?page=cons-proc`.
- Live PV link extracted from a real page anchor: `https://www.saintrobert.qc.ca/include/fichier.php?id=2319`.
- Label/context from the page: `PV - 4 MAI 2026` under `Procès-verbaux`.
- Deposit gate: `pv-dom-deposit` retained 1 strict PV candidate and HEAD-live accepted it (`1 vivants / 0 rejetés`).
- Local evidence file: `work/pv-residue-r2/saint-robert.manual-pairs.json`.

## Structured probes / skips in this pass
- `saint-clet`: server-side site probe on `https://www.st-clet.com` found 0 strict PV document links; no deposit.
- `riviere-eternite`: livehost probe on council page found 0 strict PV documents; WP media API also not exploitable; no deposit.
- WordPress media probes with no deposit: `riviere-eternite`, `notre-dame-du-nord`, `les-mechins`, `saint-clet`, `franquelin`, `marsoui`, `mont-saint-pierre`.
- `charette`: server-side probe found no strict PV documents; left as planned/ready residue.

## Commands / artifacts
- Reconcile log: `work/pv-residue-r2/reconcile.log` → `SCOREBOARD /1106 : pv=1045 (+1) | normes=556 (+0) | zones=766 (+3) | cadastre=1106 (+0) | role-foncier=1106 (+0) | tod=39 (+0)`.
- Track sync log: `work/pv-residue-r2/sync-track.log`.
- Probe outputs: `work/pv-residue-r2/*.json`.
