#!/usr/bin/env bash

set -Eeuo pipefail

GSH_INSTALLER_LIB_ONLY=1
SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
if [[ "${SCRIPT_DIR}" == "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR='.'
fi
source "${SCRIPT_DIR}/install.linux.sh"

[[ "${GSH_RELEASE_TAG}" == "v0.1.3" ]]
[[ "${PANEL_IMAGE}" == "ghcr.io/gameserverhub/game-server-hub:v0.1.3" ]]
[[ "${GSH_GAME_DST_IMAGE}" == "ghcr.io/gameserverhub/game-server-hub-dst:v0.1.3" ]]
[[ "${GSH_STEAMCMD_IMAGE}" == "ghcr.io/gameserverhub/steamcmd-base:v0.1.3" ]]
[[ "${INSTALLER_REPO_MIRRORS}" == *"@v0.1.3"* ]]
[[ "${PANEL_HEALTHCHECK_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]]
[[ "${PANEL_HEALTHCHECK_INTERVAL_SECONDS}" =~ ^[0-9]+$ ]]
uses_ghcr_image

SMOKE_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${SMOKE_TMP_DIR}"' EXIT
PANEL_LOG_DIR="${SMOKE_TMP_DIR}"
STATUS_FILE="${PANEL_LOG_DIR}/install.status"
DIAGNOSTICS_FILE="${PANEL_LOG_DIR}/install.diagnostics.log"
CURRENT_STAGE='smoke-test'
LAST_ERROR_MESSAGE='expected smoke failure'
LAST_ERROR_LINE='42'
GSH_DIAGNOSTICS_SKIP_DOCKER=1
GSH_DIAGNOSTICS_UNPRIVILEGED=1
(handle_install_exit 23) 2>/dev/null
grep -Fq '[smoke-test] [error]' "${STATUS_FILE}"
grep -Fq 'stage=smoke-test' "${DIAGNOSTICS_FILE}"
grep -Fq 'exit_code=23' "${DIAGNOSTICS_FILE}"
if grep -Fq 'ADMIN_PASSWORD' "${DIAGNOSTICS_FILE}"; then
  printf 'diagnostics unexpectedly contain ADMIN_PASSWORD\n' >&2
  exit 1
fi

printf 'install-linux-smoke-ok\n'
