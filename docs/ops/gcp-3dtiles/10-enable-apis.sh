#!/usr/bin/env bash
# Phase 10 / runbook step B — enable the required APIs (no spend).
# Run: bash docs/ops/gcp-3dtiles/10-enable-apis.sh
source "$(dirname "$0")/env.sh"

gcloud config set project "$PROJECT_ID"
# billingbudgets.googleapis.com → `gcloud billing budgets create` (phase 20). eventarc +
# artifactregistry → gen2 Cloud Function deploy (phase 30; without them the deploy hits an eventarc
# PERMISSION_DENIED). apikeys.googleapis.com → le mint §5 (`gcloud services api-keys list/create`,
# basemap-activate.yml step 4) ; sans elle le mint échoue SERVICE_DISABLED (mesuré run GO#2
# 33939062999). tile.googleapis.com = Map Tiles = l'api-target de la clé restreinte ; sans elle la
# clé cible une API désactivée. Without any of these the matching phase fails "API not enabled".
# Measured on the real test-kill (k8s). project-scope enable.
gcloud services enable cloudbilling.googleapis.com billingbudgets.googleapis.com \
  cloudfunctions.googleapis.com pubsub.googleapis.com cloudbuild.googleapis.com \
  run.googleapis.com eventarc.googleapis.com artifactregistry.googleapis.com \
  apikeys.googleapis.com tile.googleapis.com \
  --project "$PROJECT_ID"
