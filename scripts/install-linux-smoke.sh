#!/usr/bin/env bash

set -Eeuo pipefail

GSH_INSTALLER_LIB_ONLY=1
SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
if [[ "${SCRIPT_DIR}" == "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR='.'
fi
source "${SCRIPT_DIR}/install.linux.sh"

# v0.3.5 统一镜像：三键同值（占位 registry 待 resolve_image_registry 替换）
[[ "${GSH_RELEASE_TAG}" == "v0.3.5" ]]
[[ "${PANEL_IMAGE}" == "" ]]
[[ "${GSH_GAME_DST_IMAGE}" == "" ]]
[[ "${GSH_STEAMCMD_IMAGE}" == "" ]]
# 默认镜像池为空（由 init_installer_repo_pool 按代理清单生成）
[[ "${INSTALLER_REPO_MIRRORS}" == "" ]]
init_installer_repo_pool
[[ "${INSTALLER_REPO_MIRRORS}" == *"@v0.3.5"* ]]
[[ "${INSTALLER_REPO_MIRRORS}" == *gh-proxy.com* ]]
[[ "${PANEL_HEALTHCHECK_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]]
[[ "${PANEL_HEALTHCHECK_INTERVAL_SECONDS}" =~ ^[0-9]+$ ]]

# 统一镜像引用直接生成（GHCR 官方源；PANEL_IMAGE 可覆盖）
finalize_image_refs
[[ "${PANEL_IMAGE}" == "ghcr.io/pmat77/game-server-hub:v0.3.5" ]]
[[ "${GSH_GAME_DST_IMAGE}" == "${PANEL_IMAGE}" ]]
[[ "${GSH_STEAMCMD_IMAGE}" == "${PANEL_IMAGE}" ]]

# 安装器校验的是镜像源提供的 git blob 原始字节（LF）；Windows 检出经 core.autocrlf
# 得到的是 CRLF 工作区文件，直接哈希会与 pin 不符。先归一化为 LF 再交给安装器校验。
SMOKE_ASSET_DIR="$(mktemp -d)"
tr -d '\r' < "${SCRIPT_DIR}/../docker-compose.yml" > "${SMOKE_ASSET_DIR}/docker-compose.yml"
tr -d '\r' < "${SCRIPT_DIR}/../docker-compose.bind.yml" > "${SMOKE_ASSET_DIR}/docker-compose.bind.yml"
verify_installer_asset_checksum "docker-compose.yml" "${SMOKE_ASSET_DIR}/docker-compose.yml"
verify_installer_asset_checksum "docker-compose.bind.yml" "${SMOKE_ASSET_DIR}/docker-compose.bind.yml"

INSTALL_MODE=native
resolve_install_mode
[[ "${RESOLVED_INSTALL_MODE}" == "native" ]]
NETWORK_PROFILE=cn
resolve_network_profile
[[ "${RESOLVED_NETWORK_PROFILE}" == "cn" ]]
[[ "${USE_CN_DEBIAN_MIRROR}" == "1" ]]

SMOKE_TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${SMOKE_TMP_DIR}" "${SMOKE_ASSET_DIR}"' EXIT
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
