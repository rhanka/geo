#!/usr/bin/env bash
# Phase 10 / runbook step B — enable the required APIs (no spend).
# Run: bash docs/ops/gcp-3dtiles/10-enable-apis.sh
source "$(dirname "$0")/env.sh"

gcloud config set project "$PROJECT_ID"
gcloud services enable cloudbilling.googleapis.com cloudfunctions.googleapis.com \
  pubsub.googleapis.com cloudbuild.googleapis.com run.googleapis.com --project "$PROJECT_ID"
