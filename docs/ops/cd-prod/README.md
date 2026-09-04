# cd-prod — versioned, owner-gated prod deploy

`cd-prod.yml` deploys geo-api to **prod** (ns `geo`, live cluster hlhedx, serves `api.geo.sent-tech.ca`).
It **promotes an existing validated digest** (same-digest, no rebuild — ADR-0028). The prod deploy is
**hard-to-reverse + outward-facing**, so it never runs on push: **one owner GO per deploy** = dispatch the
workflow with the digest, then approve the `geo-prod` Environment.

## The invariant (owner-approved by construction)

The `deploy-prod` job declares `environment: geo-prod`. On GitHub that Environment carries
**required-reviewer=owner**, and the `KUBE_CONFIG_DATA` secret is **env-scoped** to it. So the run PAUSES
until the owner approves, and the prod kubeconfig is only readable in that approved context ⟹ **a prod
deploy ⟹ owner-approved**. (Same load-bearing invariant as §5's `geo-preprod`.)

## One-time setup — SPLIT (owner + poc-k8s)

The prod cluster is OVH (hlhedx) and the owner has **no OVH kubectl** (as at the §5 bootstrap), so the
one-time setup splits into two commands:

1. **Owner (GitHub-admin, once)** — `cd-prod-owner-setup.sh`
   Creates the `geo-prod` Environment with **required-reviewer=owner** (the GO gate). Idempotent, self-verified.

2. **poc-k8s (OVH admin, once)** — `cd-prod-kubeconfig.sh`
   Mints a **bounded** token for a least-priv SA in ns `geo`, assembles a kubeconfig (SA token only, no admin
   cred), and posts it as the **env-scoped** secret `KUBE_CONFIG_DATA`. Atomic (mint+post in one session, no
   token handoff), never prints the token, refuses if the Environment lacks the reviewer (no gate-bypass).
   Prereq: poc-k8s has posed the SA + a least-priv **deploy** RBAC on ns `geo` (get/patch deployments +
   apply the overlay resources), analogous to `geo-ci-rbac.yaml` for §5 preprod. Token is bounded ⇒ re-run
   before expiry to rotate.

After **both** (Environment + `KUBE_CONFIG_DATA`): every prod deploy is a single owner GO.

## Each deploy (owner GO — pure GO, no paste)

1. **Actions → CD Prod → Run workflow** on `main` — leave the inputs **empty**. cd-prod AUTO-RESOLVES the
   digest to promote = the image cd-preprod built for the **last preprod-validated commit** (the `head_sha`
   of the latest *successful* cd-preprod run), decoupled from main HEAD. No digest to paste. (The `digest`
   input is an optional advanced override to pin a specific digest.)
2. Approve the `geo-prod` Environment when prompted (the required-reviewer gate). **This approval is the GO.**
3. The workflow resolves + asserts the digest in-registry, pins it in `overlays/prod`, applies, and waits for
   the rollout.

⚠ cd-prod promotes the **latest preprod-validated image** (the last successful cd-preprod build), **not main
HEAD** — so a workflow/docs-only commit on main HEAD never blocks the deploy (the resolve is decoupled from
what main HEAD touches). The deployed commit is that last cd-preprod-validated commit; i-infra certifies it
post-deploy and pv computes the `design_sha` go-lines for that certified `runner_git_sha`. Fail-loud if no
successful cd-preprod run exists (nothing to promote — no deploy on an empty digest).

**Executor ≠ certifier.** The deploy runs here; i-infra **certifies post-deploy** independently (served
digest == promoted, gate present, served-sha, runner_git). Provenance: images built by CD carry the git
commit as the OCI `org.opencontainers.image.revision` label (baked via `--build-arg GIT_SHA`), so "which
commit runs in prod?" is always answerable from the image.
