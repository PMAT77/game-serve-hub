#!/usr/bin/env bash

set -Eeuo pipefail

GSH_INSTALLER_LIB_ONLY=1
SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
if [[ "${SCRIPT_DIR}" == "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR='.'
fi
source "${SCRIPT_DIR}/install.linux.sh"

[[ "${GSH_RELEASE_TAG}" == "v0.1.4" ]]
[[ "${PANEL_IMAGE}" == "ghcr.io/pmat77/game-server-hub:v0.1.4" ]]
[[ "${GSH_GAME_DST_IMAGE}" == "ghcr.io/pmat77/game-server-hub-dst:v0.1.4" ]]
[[ "${GSH_STEAMCMD_IMAGE}" == "ghcr.io/pmat77/steamcmd-base:v0.1.4" ]]
[[ "${INSTALLER_REPO_MIRRORS}" == *"@v0.1.4"* ]]
[[ "${PANEL_HEALTHCHECK_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]]
[[ "${PANEL_HEALTHCHECK_INTERVAL_SECONDS}" =~ ^[0-9]+$ ]]
uses_ghcr_image
verify_installer_asset_checksum "docker-compose.yml" "${SCRIPT_DIR}/../docker-compose.yml"
verify_installer_asset_checksum "docker-compose.bind.yml" "${SCRIPT_DIR}/../docker-compose.bind.yml"

INSTALL_MODE=native
resolve_install_mode
[[ "${RESOLVED_INSTALL_MODE}" == "native" ]]
NETWORK_PROFILE=cn
resolve_network_profile
[[ "${RESOLVED_NETWORK_PROFILE}" == "cn" ]]
[[ "${USE_CN_DEBIAN_MIRROR}" == "1" ]]

SMOKE_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${SMOKE_TMP_DIR}"' EXIT
SMOKE_ENV_FILE="${SMOKE_TMP_DIR}/panel.env"
printf '%s\n' \
  'ADMIN_USERNAME=keep-me' \
  'GSH_RUNTIME_MODE=native' \
  'GSH_RELEASE_VERSION=v0.1.4' \
  > "${SMOKE_ENV_FILE}"
upsert_env_values "${SMOKE_ENV_FILE}" \
  'GSH_RUNTIME_MODE=native' \
  'GSH_RELEASE_VERSION=v0.1.5'
[[ "$(read_env_value "${SMOKE_ENV_FILE}" 'ADMIN_USERNAME')" == 'keep-me' ]]
[[ "$(read_env_value "${SMOKE_ENV_FILE}" 'GSH_RELEASE_VERSION')" == 'v0.1.5' ]]
[[ "$(grep -c '^GSH_RELEASE_VERSION=' "${SMOKE_ENV_FILE}")" == '1' ]]

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
