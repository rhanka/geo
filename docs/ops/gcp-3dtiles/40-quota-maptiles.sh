#!/usr/bin/env bash
# Phase 40 / runbook step G — Map Tiles daily quota (~300/day) [couche 3, secondary
# belt]. The gcloud quota CLI (alpha) is unstable → set it via the Service Usage
# console. Non-blocking: the real hard-cap is the cap-billing Function proven by
# phase 50 (J).
source "$(dirname "$0")/env.sh"

echo "[G] Poser le quota jour Map Tiles (~300) sur $PROJECT_ID via la console Service Usage."
echo "    (CLI quota alpha instable → console ; ceinture secondaire, J = le vrai hard-cap.)"
