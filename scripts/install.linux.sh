#!/usr/bin/env bash

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# 安装脚本默认参数与运行时路径
# -----------------------------------------------------------------------------
SCRIPT_NAME="$(basename "$0")" # 当前脚本名称（用于日志展示）。
GSH_RELEASE_TAG="${GSH_RELEASE_TAG:-${PANEL_IMAGE_TAG:-v0.3.0}}" # 默认安装的不可变 Release；同时锁定安装资源与镜像版本。
INSTALLER_REPO_RAW="${INSTALLER_REPO_RAW:-}" # 兼容旧变量：指定单一安装资源源（为空时使用 INSTALLER_REPO_MIRRORS）。
# GitHub 资源加速代理（前缀拼接型）：安装资源与 Native 包共用；GSH_GITHUB_PROXY 可强制指定单一节点。
GITHUB_PROXY_SITES="${GITHUB_PROXY_SITES:-https://gh-proxy.com/,https://ghfast.top/,https://ghproxy.com/}"
GSH_GITHUB_PROXY="${GSH_GITHUB_PROXY:-}" # 强制指定 GitHub 加速代理（如 https://gh-proxy.com/）；为空则走镜像池自动回退。
INSTALLER_REPO_MIRRORS="${INSTALLER_REPO_MIRRORS:-}" # 安装资源镜像池；为空时由 init_installer_repo_pool 按代理清单生成。
# 校验对象是镜像源提供的 git blob 原始字节（LF）；改动 compose 后必须同步更新此处。
# 历史 pin eb30aeae... 与 v0.1.4 tag 内 compose blob（a34665e2...）不匹配，导致严格校验必然失败。
INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_YML="${INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_YML:-15ecf89db72730449083773785b77f90929d789fe93ad7daecf8277a449b1fc1}"
INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_BIND_YML="${INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_BIND_YML:-525eaf74e17df33887fe47248f414c0de3e6cd94a8d20e072ab5d66284c760ae}"
INSTALL_MODE="${GSH_INSTALL_MODE:-auto}" # auto | docker | native
NETWORK_PROFILE="${GSH_NETWORK_PROFILE:-auto}" # auto | cn | global
RESOLVED_INSTALL_MODE=""
RESOLVED_NETWORK_PROFILE=""
MIN_FREE_DISK_MB=4096 # 最小可用磁盘空间阈值（MB）。
HOST_MEMORY_WARN_MIN_MB=3800 # 总内存低于此值（约 4GiB）时输出 WARN。
HOST_MEMORY_TIER_SMALL_MAX_MB=5120 # < 此值视为 small 预设。
HOST_MEMORY_TIER_MEDIUM_MAX_MB=8192 # < 此值视为 medium 预设。
GSH_PANEL_ENV_PRESET="${GSH_PANEL_ENV_PRESET:-auto}" # auto | small | medium | large | none
RETRY_MAX=3 # 可重试操作的最大重试次数。
RETRY_DELAY_SECONDS=3 # 每次重试之间的等待秒数。
REPO_DOWNLOAD_MAX_ATTEMPTS="${REPO_DOWNLOAD_MAX_ATTEMPTS:-2}" # 每个安装资源源最大下载重试次数。
REPO_DOWNLOAD_TIMEOUT_SECONDS="${REPO_DOWNLOAD_TIMEOUT_SECONDS:-45}" # 安装资源单次下载超时时间（秒）。
REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS="${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS:-10}" # 安装资源连接超时时间（秒）。
OPEN_PANEL_PORT=0 # 是否在安装时开放面板 TCP 端口。
OPEN_DST_PORTS=0 # 是否在安装时开放 DST 默认 UDP 游戏端口。
GHCR_CHECK_TIMEOUT_SECONDS="${GHCR_CHECK_TIMEOUT_SECONDS:-20}" # ghcr.io 连通性预检查超时时间（秒）。
STRICT_GHCR_CHECK="${STRICT_GHCR_CHECK:-0}" # 是否要求 ghcr.io 预检查必须通过（1=失败即终止，0=失败仅告警）。
DOCKER_REPO_CHECK_TIMEOUT_SECONDS="${DOCKER_REPO_CHECK_TIMEOUT_SECONDS:-8}" # download.docker.com 连通性预检查超时时间（秒）。
STRICT_DOCKER_REPO_CHECK="${STRICT_DOCKER_REPO_CHECK:-0}" # 是否要求 download.docker.com 预检查必须通过（1=失败即终止，0=失败仅告警）。
USE_CN_DEBIAN_MIRROR="${USE_CN_DEBIAN_MIRROR:-0}" # Debian 是否优先尝试国内镜像（1=启用，0=关闭）。
DEBIAN_MIRROR_URL="${DEBIAN_MIRROR_URL:-https://mirrors.tuna.tsinghua.edu.cn/debian}" # Debian 主仓库镜像。
DEBIAN_SECURITY_MIRROR_URL="${DEBIAN_SECURITY_MIRROR_URL:-https://mirrors.tuna.tsinghua.edu.cn/debian-security}" # Debian 安全仓库镜像。
UBUNTU_MIRROR_URL="${UBUNTU_MIRROR_URL:-https://mirrors.tuna.tsinghua.edu.cn/ubuntu}" # Ubuntu 主仓库与安全更新镜像。
APT_SOURCES_BACKUP_DIR="/tmp/gsh-apt-sources-backup"

# DST 默认 UDP 端口（与 cluster.ini / server.ini 默认值一致）
DST_GAME_PORT="${DST_GAME_PORT:-10999}"
DST_AUTH_PORT="${DST_AUTH_PORT:-8766}"
DST_MASTER_PORT="${DST_MASTER_PORT:-12346}"

PANEL_NAME="${PANEL_NAME:-game-server-hub}" # 面板逻辑名称（可被环境变量覆盖）。
PANEL_PORT="${PANEL_PORT:-9527}" # 面板对外暴露端口（默认使用高位端口以降低备案拦截影响）。
PANEL_PROTOCOL="${PANEL_PROTOCOL:-http}" # 访问协议（用于生成访问 URL）。
INSTALL_STEAMCMD_IMAGE="${INSTALL_STEAMCMD_IMAGE:-1}" # 安装阶段是否预拉 SteamCMD 镜像（默认拉取，安装完成后可直接创建实例）。
# v0.2.0 起三镜像合一：面板/DST/SteamCMD 共用同一统一镜像引用（仅 GHCR 官方源；
# 国内拉取失败时优先使用 Release 离线镜像包，或在 panel.env 配置 GSH_IMAGE_MIRRORS 自选镜像代理）。
PANEL_IMAGE_OVERRIDE="${PANEL_IMAGE:-}" # 完整面板镜像引用；设置后直接采用（不再拼接 GHCR 引用）。
PANEL_INSTALL_DIR="${PANEL_INSTALL_DIR:-/opt/game-server-hub}" # 安装目录（放置 env/compose）。
PANEL_DATA_DIR="${PANEL_DATA_DIR:-/var/lib/game-server-hub}" # 面板持久化数据目录。
PANEL_LOG_DIR="${PANEL_LOG_DIR:-/var/log/game-server-hub}" # 面板日志与安装状态目录。
PANEL_INSTANCES_DIR="${PANEL_INSTANCES_DIR:-${PANEL_DATA_DIR}/instances}" # 游戏实例数据目录。
PANEL_BACKUPS_DIR="${PANEL_BACKUPS_DIR:-${PANEL_DATA_DIR}/backups}" # 备份目录。
PANEL_BIND_COMPOSE_FILE="${PANEL_INSTALL_DIR}/docker-compose.bind.yml"
PANEL_IMAGE_TAG="${PANEL_IMAGE_TAG:-${GSH_RELEASE_TAG}}" # 容器镜像标签；默认与安装资源锁定同一个 Release。
# v0.2.0 三键同值（统一镜像）；完整引用由 finalize_image_refs 按 registry 生成，panel.env 保留三个变量以兼容面板配置读取与历史脚本。
PANEL_IMAGE="" # 统一镜像完整引用（由 finalize_image_refs 填充；PANEL_IMAGE_OVERRIDE 设置时直接采用）。
GSH_GAME_DST_IMAGE=""
GSH_STEAMCMD_IMAGE=""
INSTALL_STEAMCMD_PULL_IMAGE=""
PANEL_ENV_FILE="${PANEL_INSTALL_DIR}/panel.env" # 运行时环境变量文件路径。
PANEL_COMPOSE_FILE="${PANEL_INSTALL_DIR}/docker-compose.yml" # Docker Compose 文件路径。
STATUS_FILE="${PANEL_LOG_DIR}/install.status" # 安装状态追踪文件路径。
DIAGNOSTICS_FILE="${PANEL_LOG_DIR}/install.diagnostics.log" # 失败时生成的脱敏诊断报告。
PANEL_HEALTHCHECK_TIMEOUT_SECONDS="${PANEL_HEALTHCHECK_TIMEOUT_SECONDS:-90}" # 启动后健康检查总超时。
PANEL_HEALTHCHECK_INTERVAL_SECONDS="${PANEL_HEALTHCHECK_INTERVAL_SECONDS:-3}" # 健康检查轮询间隔。
NATIVE_SERVICE_USER="${GSH_NATIVE_USER:-gsh}"
NATIVE_SERVICE_GROUP="${GSH_NATIVE_GROUP:-gsh}"
NATIVE_USER_HOME="${GSH_NATIVE_USER_HOME:-${PANEL_DATA_DIR}/home}"
NATIVE_RELEASE_ROOT="${GSH_NATIVE_RELEASE_ROOT:-${PANEL_INSTALL_DIR}/releases}"
NATIVE_CURRENT_LINK="${PANEL_INSTALL_DIR}/current"
NATIVE_RELEASE_NAME="game-server-hub-native-${GSH_RELEASE_TAG}-linux-x64"
NATIVE_RELEASE_ARCHIVE="${GSH_NATIVE_RELEASE_ARCHIVE:-}"
NATIVE_RELEASE_MIRRORS="${GSH_NATIVE_RELEASE_MIRRORS:-}" # 为空时由 init_installer_repo_pool 生成（直连 + 加速代理）。https://github.com/PMAT77/game-serve-hub/releases/download/${GSH_RELEASE_TAG},https://ghproxy.com/https://github.com/PMAT77/game-serve-hub/releases/download/${GSH_RELEASE_TAG}}"
NATIVE_STEAMCMD_DIR="${GSH_NATIVE_STEAMCMD_DIR:-${PANEL_INSTALL_DIR}/runtime/steamcmd}"
NATIVE_STEAMCMD_PATH="${NATIVE_STEAMCMD_DIR}/steamcmd.sh"
NATIVE_STEAMCMD_URL="${GSH_NATIVE_STEAMCMD_URL:-https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz}"
NATIVE_SYSTEMD_UNIT="/etc/systemd/system/game-server-hub.service"
NATIVE_PREVIOUS_RELEASE=""
UPGRADE_STATE_BACKUP_DIR=""
UPGRADE_DATABASE_BACKUP=""

DISTRO_ID="" # 发行版 ID（如 ubuntu/debian）。
DISTRO_CODENAME="" # 发行版代号（如 jammy/bookworm）。
PANEL_HOST="${PANEL_HOST:-}" # 面板访问主机地址（为空时自动探测）。
PANEL_ACCESS_URL="" # 最终拼装出的访问 URL。
ADMIN_USERNAME="${ADMIN_USERNAME:-superadmin}" # 初始管理员用户名。
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" # 初始管理员密码（为空时自动生成随机密码）。
EXPOSE_ADMIN_PASSWORD="${EXPOSE_ADMIN_PASSWORD:-0}" # 是否在安装摘要中明文输出管理员密码（1=输出，0=仅提示凭据文件）。
ROLLBACK_ENABLED=0 # 是否允许回滚（部署开始后置为 1）。
INSTALL_COMPLETED=0
CURRENT_STAGE="bootstrap"
LAST_ERROR_LINE="unknown"
LAST_ERROR_EXIT_CODE=1
LAST_ERROR_MESSAGE="Unexpected installer failure"
INSTALLER_REPO_POOL_INITIALIZED=0
declare -a INSTALLER_REPO_POOL=()
STRICT_INSTALLER_ASSET_CHECKSUM="${STRICT_INSTALLER_ASSET_CHECKSUM:-1}" # 安装资源校验是否强制（1=校验失败即中止，0=仅告警）。

# 基础日志函数，统一输出格式。
log_info() {
  printf '[INFO] %s\n' "$*"
}

# 警告日志输出到标准错误。
log_warn() {
  printf '[WARN] %s\n' "$*" >&2
}

# 错误日志输出到标准错误。
log_error() {
  printf '[ERROR] %s\n' "$*" >&2
}

# 输出错误并立即退出脚本。
abort() {
  LAST_ERROR_MESSAGE="$*"
  LAST_ERROR_LINE="${BASH_LINENO[0]:-unknown}"
  log_error "$*"
  exit 1
}

# 以 root 执行命令；若非 root 则自动走 sudo。
run_as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
    return
  fi

  if ! command -v sudo >/dev/null 2>&1; then
    abort "sudo is required. Please rerun as root or install sudo first."
  fi

  sudo "$@"
}

try_as_root() {
  if [[ "${GSH_DIAGNOSTICS_UNPRIVILEGED:-0}" == "1" ]]; then
    "$@"
  elif [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

# 只读取精确的 KEY=value 行，不 source 用户可编辑的 panel.env。
read_env_value() {
  local file="$1"
  local key="$2"
  local command=(awk -v "target=${key}" '
    index($0, target "=") == 1 {
      value = substr($0, length(target) + 2)
    }
    END {
      sub(/\r$/, "", value)
      printf "%s", value
    }
  ' "${file}")
  if [[ -r "${file}" ]]; then
    "${command[@]}"
  else
    try_as_root "${command[@]}"
  fi
}

# 原子更新指定环境变量，保留未涉及的用户配置、权限和文件 inode。
upsert_env_values() {
  local file="$1"
  shift
  local updater
  updater='
    set -Eeuo pipefail
    file="$1"
    shift
    work="$(mktemp)"
    cp "$file" "$work"
    for pair in "$@"; do
      key="${pair%%=*}"
      value="${pair#*=}"
      next="$(mktemp)"
      awk -v target="$key" -v replacement="$key=$value" "
        BEGIN { replaced = 0 }
        index(\$0, target \"=\") == 1 {
          if (!replaced) {
            print replacement
            replaced = 1
          }
          next
        }
        { print }
        END {
          if (!replaced) {
            print replacement
          }
        }
      " "$work" > "$next"
      mv "$next" "$work"
    done
    cat "$work" > "$file"
    rm -f "$work"
  '
  if [[ -w "${file}" ]]; then
    bash -c "${updater}" _ "${file}" "$@"
  else
    run_as_root bash -c "${updater}" _ "${file}" "$@"
  fi
}

resolve_existing_install_mode() {
  if ! try_as_root test -f "${PANEL_ENV_FILE}"; then
    return 1
  fi
  local existing_mode
  existing_mode="$(read_env_value "${PANEL_ENV_FILE}" "GSH_RUNTIME_MODE")"
  printf '%s' "${existing_mode:-docker}"
}

validate_install_mode_transition() {
  local existing_mode
  if ! existing_mode="$(resolve_existing_install_mode)"; then
    return
  fi
  if [[ "${existing_mode}" != "${RESOLVED_INSTALL_MODE}" ]]; then
    abort "Existing ${existing_mode} installation detected at ${PANEL_INSTALL_DIR}. Automatic cross-mode migration is not supported; back up data and follow docs/INSTALL.md."
  fi
  log_info "Existing ${existing_mode} installation detected; performing an in-place upgrade."
}

backup_existing_install_state() {
  local existing_mode timestamp database_path
  if ! existing_mode="$(resolve_existing_install_mode)" || [[ "${existing_mode}" != "${RESOLVED_INSTALL_MODE}" ]]; then
    return
  fi

  timestamp="$(date +%Y%m%d%H%M%S)"
  UPGRADE_STATE_BACKUP_DIR="${PANEL_BACKUPS_DIR}/panel-upgrades/${timestamp}-${GSH_RELEASE_TAG}"
  UPGRADE_DATABASE_BACKUP="${UPGRADE_STATE_BACKUP_DIR}/game-server-hub.sqlite"
  database_path="${PANEL_DATA_DIR}/game-server-hub.sqlite"
  run_as_root mkdir -p "${UPGRADE_STATE_BACKUP_DIR}"

  if try_as_root test -f "${PANEL_ENV_FILE}"; then
    run_as_root cp -p "${PANEL_ENV_FILE}" "${UPGRADE_STATE_BACKUP_DIR}/panel.env"
  fi
  if try_as_root test -f "${PANEL_COMPOSE_FILE}"; then
    run_as_root cp -p "${PANEL_COMPOSE_FILE}" "${UPGRADE_STATE_BACKUP_DIR}/docker-compose.yml"
  fi
  if try_as_root test -f "${PANEL_BIND_COMPOSE_FILE}"; then
    run_as_root cp -p "${PANEL_BIND_COMPOSE_FILE}" "${UPGRADE_STATE_BACKUP_DIR}/docker-compose.bind.yml"
  fi
  if try_as_root test -f "${database_path}"; then
    run_as_root sqlite3 "${database_path}" ".backup '${UPGRADE_DATABASE_BACKUP}'"
    run_as_root chmod 0600 "${UPGRADE_DATABASE_BACKUP}"
  else
    UPGRADE_DATABASE_BACKUP=""
  fi
  log_info "Upgrade state backed up to ${UPGRADE_STATE_BACKUP_DIR}."
}

restore_existing_install_state() {
  local database_path="${PANEL_DATA_DIR}/game-server-hub.sqlite"
  if [[ -z "${UPGRADE_STATE_BACKUP_DIR}" ]] || ! try_as_root test -d "${UPGRADE_STATE_BACKUP_DIR}"; then
    return
  fi
  if try_as_root test -f "${UPGRADE_STATE_BACKUP_DIR}/panel.env"; then
    run_as_root cp -p "${UPGRADE_STATE_BACKUP_DIR}/panel.env" "${PANEL_ENV_FILE}"
  fi
  if try_as_root test -f "${UPGRADE_STATE_BACKUP_DIR}/docker-compose.yml"; then
    run_as_root cp -p "${UPGRADE_STATE_BACKUP_DIR}/docker-compose.yml" "${PANEL_COMPOSE_FILE}"
  fi
  if try_as_root test -f "${UPGRADE_STATE_BACKUP_DIR}/docker-compose.bind.yml"; then
    run_as_root cp -p "${UPGRADE_STATE_BACKUP_DIR}/docker-compose.bind.yml" "${PANEL_BIND_COMPOSE_FILE}"
  fi
  if [[ -n "${UPGRADE_DATABASE_BACKUP}" ]] && try_as_root test -f "${UPGRADE_DATABASE_BACKUP}"; then
    run_as_root cp "${UPGRADE_DATABASE_BACKUP}" "${database_path}"
    if [[ "${RESOLVED_INSTALL_MODE}" == "native" ]]; then
      run_as_root chown "${NATIVE_SERVICE_USER}:${NATIVE_SERVICE_GROUP}" "${database_path}"
    fi
  fi
  log_warn "Restored configuration and database from ${UPGRADE_STATE_BACKUP_DIR}."
}

# 将安装进度写入状态文件，便于审计和排障。
write_status() {
  local stage status message timestamp
  stage="$1"
  status="$2"
  message="$3"
  timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
  run_as_root mkdir -p "${PANEL_LOG_DIR}"
  printf '%s [%s] [%s] %s\n' "${timestamp}" "${stage}" "${status}" "${message}" | run_as_root tee -a "${STATUS_FILE}" >/dev/null
}

begin_stage() {
  CURRENT_STAGE="$1"
  write_status "$1" "start" "$2"
}

record_install_error() {
  LAST_ERROR_EXIT_CODE="$1"
  LAST_ERROR_LINE="$2"
}

collect_install_diagnostics() {
  local exit_code="$1"
  local line_number="$2"
  local report

  report="$(mktemp)"
  {
    printf 'timestamp=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    printf 'stage=%s\n' "${CURRENT_STAGE}"
    printf 'exit_code=%s\n' "${exit_code}"
    printf 'line=%s\n' "${line_number}"
    printf 'release=%s\n' "${GSH_RELEASE_TAG}"
    printf 'install_mode=%s\n' "${RESOLVED_INSTALL_MODE:-${INSTALL_MODE}}"
    printf 'network_profile=%s\n' "${RESOLVED_NETWORK_PROFILE:-${NETWORK_PROFILE}}"
    printf 'panel_image=%s\n' "${PANEL_IMAGE}"
    printf 'dst_image=%s\n' "${GSH_GAME_DST_IMAGE}"
    printf 'steamcmd_image=%s\n' "${GSH_STEAMCMD_IMAGE}"
    printf 'distro=%s\n' "${DISTRO_ID:-unknown}"
    printf 'architecture=%s\n' "$(uname -m 2>/dev/null || printf unknown)"
    printf '\n[disk]\n'
    df -h "${PANEL_INSTALL_DIR}" 2>&1 || true
    printf '\n[memory]\n'
    free -m 2>&1 || true
    if [[ "${GSH_DIAGNOSTICS_SKIP_DOCKER:-0}" != "1" ]] && command -v docker >/dev/null 2>&1; then
      printf '\n[docker-version]\n'
      docker version 2>&1 || true
      if [[ -f "${PANEL_ENV_FILE}" && -f "${PANEL_COMPOSE_FILE}" && -f "${PANEL_BIND_COMPOSE_FILE}" ]]; then
        printf '\n[compose-ps]\n'
        try_as_root docker compose --env-file "${PANEL_ENV_FILE}" -f "${PANEL_COMPOSE_FILE}" -f "${PANEL_BIND_COMPOSE_FILE}" ps -a 2>&1 || true
      fi
    fi
    if [[ "${RESOLVED_INSTALL_MODE:-}" == "native" ]] && command -v systemctl >/dev/null 2>&1; then
      printf '\n[native-service]\n'
      try_as_root systemctl status game-server-hub.service --no-pager 2>&1 || true
      printf '\n[native-journal]\n'
      try_as_root journalctl -u game-server-hub.service -n 80 --no-pager 2>&1 || true
    fi
  } >"${report}"

  try_as_root mkdir -p "${PANEL_LOG_DIR}" || true
  try_as_root cp "${report}" "${DIAGNOSTICS_FILE}" || true
  try_as_root chmod 600 "${DIAGNOSTICS_FILE}" || true
  rm -f "${report}"
}

handle_install_exit() {
  local exit_code="$1"
  trap - ERR EXIT
  if [[ "${INSTALL_COMPLETED}" -eq 1 || "${exit_code}" -eq 0 ]]; then
    return
  fi

  set +e
  if try_as_root mkdir -p "${PANEL_LOG_DIR}"; then
    printf '%s [%s] [error] %s; exit=%s; line=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "${CURRENT_STAGE}" "${LAST_ERROR_MESSAGE}" "${exit_code}" "${LAST_ERROR_LINE}" | try_as_root tee -a "${STATUS_FILE}" >/dev/null || true
  fi
  collect_install_diagnostics "${exit_code}" "${LAST_ERROR_LINE}" || true
  rollback_install || true
  log_error "Installation failed during stage '${CURRENT_STAGE}' (exit ${exit_code}, line ${LAST_ERROR_LINE})."
  log_error "Diagnostics: ${DIAGNOSTICS_FILE}"
  log_error "Status history: ${STATUS_FILE}"
}

# 为网络/包管理等易受瞬时故障影响的操作提供重试能力。
run_with_retry() {
  local description attempt
  description="$1"
  shift

  attempt=1
  while (( attempt <= RETRY_MAX )); do
    if "$@"; then
      return 0
    fi

    if (( attempt == RETRY_MAX )); then
      log_error "${description} failed after ${RETRY_MAX} attempts."
      return 1
    fi

    log_warn "${description} failed on attempt ${attempt}, retrying in ${RETRY_DELAY_SECONDS}s..."
    sleep "${RETRY_DELAY_SECONDS}"
    attempt=$((attempt + 1))
  done
}

# 将资源源追加到镜像池（自动去重）。
append_installer_repo_source() {
  local source="$1"
  local existing

  source="${source#"${source%%[![:space:]]*}"}"
  source="${source%"${source##*[![:space:]]}"}"
  source="${source%/}"
  if [[ -z "${source}" ]]; then
    return
  fi

  for existing in "${INSTALLER_REPO_POOL[@]}"; do
    if [[ "${existing}" == "${source}" ]]; then
      return
    fi
  done
  INSTALLER_REPO_POOL+=("${source}")
}

# 生成 GitHub 资源候选列表（逗号分隔）：加速代理前缀 → 直连。GSH_GITHUB_PROXY 设置时仅走该代理 + 直连。
build_github_url_variants() {
  local direct_url="$1"
  local proxy site
  local -a parts=()

  if [[ -n "${GSH_GITHUB_PROXY}" ]]; then
    proxy="${GSH_GITHUB_PROXY%/}"
    parts+=("${proxy}/${direct_url}")
  else
    local old_ifs="${IFS}"
    IFS=","
    for site in ${GITHUB_PROXY_SITES}; do
      parts+=("${site%/}/${direct_url}")
    done
    IFS="${old_ifs}"
  fi
  parts+=("${direct_url}")
  local old_ifs2="${IFS}"
  IFS=","
  echo "${parts[*]}"
  IFS="${old_ifs2}"
}

# 初始化安装资源镜像池（INSTALLER_REPO_RAW 优先，其次 INSTALLER_REPO_MIRRORS，为空时按代理清单自动生成）。
init_installer_repo_pool() {
  local item
  local raw_sources

  if [[ "${INSTALLER_REPO_POOL_INITIALIZED}" -eq 1 ]]; then
    return
  fi

  if [[ -z "${INSTALLER_REPO_MIRRORS}" ]]; then
    INSTALLER_REPO_MIRRORS="https://cdn.jsdelivr.net/gh/PMAT77/game-serve-hub@${GSH_RELEASE_TAG},$(build_github_url_variants "https://raw.githubusercontent.com/PMAT77/game-serve-hub/${GSH_RELEASE_TAG}")"
  fi

  if [[ -n "${INSTALLER_REPO_RAW}" ]]; then
    append_installer_repo_source "${INSTALLER_REPO_RAW}"
  fi

  IFS=',' read -r -a raw_sources <<< "${INSTALLER_REPO_MIRRORS}"
  for item in "${raw_sources[@]}"; do
    append_installer_repo_source "${item}"
  done

  if [[ "${#INSTALLER_REPO_POOL[@]}" -eq 0 ]]; then
    abort "Installer mirrors are empty. Please set INSTALLER_REPO_MIRRORS or INSTALLER_REPO_RAW."
  fi

  INSTALLER_REPO_POOL_INITIALIZED=1
  log_info "Installer asset mirrors: ${INSTALLER_REPO_POOL[*]}"
}

# 从安装资源镜像池下载文件到目标路径（自动多源回退 + 重试）。
download_installer_asset() {
  local relative_path="$1"
  local dest_path="$2"
  local source url attempt tmp_file

  init_installer_repo_pool
  for source in "${INSTALLER_REPO_POOL[@]}"; do
    for ((attempt = 1; attempt <= REPO_DOWNLOAD_MAX_ATTEMPTS; attempt++)); do
      url="${source}/${relative_path}"
      tmp_file="$(mktemp)"
      if curl -fL --connect-timeout "${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS}" --max-time "${REPO_DOWNLOAD_TIMEOUT_SECONDS}" -o "${tmp_file}" "${url}" >/dev/null 2>&1; then
        if ! verify_installer_asset_checksum "${relative_path}" "${tmp_file}"; then
          rm -f "${tmp_file}"
          log_warn "Checksum verify failed: ${url} (attempt ${attempt}/${REPO_DOWNLOAD_MAX_ATTEMPTS})"
          if (( attempt < REPO_DOWNLOAD_MAX_ATTEMPTS )); then
            sleep "${RETRY_DELAY_SECONDS}"
          fi
          continue
        fi
        run_as_root install -m 0644 "${tmp_file}" "${dest_path}"
        rm -f "${tmp_file}"
        log_info "Downloaded ${relative_path} from ${source} (attempt ${attempt}/${REPO_DOWNLOAD_MAX_ATTEMPTS})"
        return 0
      fi

      rm -f "${tmp_file}"
      log_warn "Download failed: ${url} (attempt ${attempt}/${REPO_DOWNLOAD_MAX_ATTEMPTS})"
      if (( attempt < REPO_DOWNLOAD_MAX_ATTEMPTS )); then
        sleep "${RETRY_DELAY_SECONDS}"
      fi
    done
  done

  return 1
}

# 返回随安装脚本发布的资源摘要。校验不能再次依赖 GitHub Raw，否则镜像回退仍会在国内网络失败。
resolve_installer_asset_sha256() {
  case "$1" in
    docker-compose.yml)
      printf '%s' "${INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_YML}"
      ;;
    docker-compose.bind.yml)
      printf '%s' "${INSTALLER_ASSET_SHA256_DOCKER_COMPOSE_BIND_YML}"
      ;;
    *)
      return 1
      ;;
  esac
}

# 对镜像源下载的安装资源做完整性校验（摘要固定在当前版本安装脚本中）。
verify_installer_asset_checksum() {
  local relative_path="$1"
  local downloaded_file="$2"
  local expected_sum actual_sum

  if [[ "${STRICT_INSTALLER_ASSET_CHECKSUM}" != "1" ]]; then
    return 0
  fi

  if ! expected_sum="$(resolve_installer_asset_sha256 "${relative_path}")" || [[ -z "${expected_sum}" ]]; then
    log_warn "No embedded checksum for installer asset: ${relative_path}"
    return 1
  fi

  actual_sum="$(sha256sum "${downloaded_file}" | awk '{print $1}')"

  if [[ "${expected_sum}" != "${actual_sum}" ]]; then
    log_warn "Checksum mismatch for ${relative_path}: expected ${expected_sum}, got ${actual_sum}"
    return 1
  fi

  return 0
}

# 写入脚本内置的 panel.env 预设资源，避免弱网环境拉取 preset 失败。
write_builtin_panel_env_preset_asset() {
  local item="$1"
  local dest_path="$2"

  case "${item}" in
    small.env)
      run_as_root bash -c "cat > \"${dest_path}\" <<'EOF'
# GSH 内存预设：small（总内存约 4 GiB，< 5 GiB）
# 合并到 panel.env 后重启 panel。勿与 dev 压力测试用的大上限（如 5120）混用。
GSH_STEAMCMD_CONTAINER_MEMORY_MB=1536
GSH_STEAMCMD_CONTAINER_MEMORY_SWAP_MB=1536
GSH_DST_CONTAINER_MEMORY_MB=768
GSH_HOST_STEAMCMD_PLANNING_MB=1280
GSH_HOST_MEMORY_HEADROOM_MB=384
GSH_HOST_DST_PLANNING_MB=512
EOF"
      ;;
    medium.env)
      run_as_root bash -c "cat > \"${dest_path}\" <<'EOF'
# GSH 内存预设：medium（总内存约 6 GiB，5 GiB–8 GiB）
GSH_STEAMCMD_CONTAINER_MEMORY_MB=2048
GSH_STEAMCMD_CONTAINER_MEMORY_SWAP_MB=2048
GSH_DST_CONTAINER_MEMORY_MB=1536
GSH_HOST_STEAMCMD_PLANNING_MB=1280
GSH_HOST_MEMORY_HEADROOM_MB=512
GSH_HOST_DST_PLANNING_MB=768
EOF"
      ;;
    large.env)
      run_as_root bash -c "cat > \"${dest_path}\" <<'EOF'
# GSH 内存预设：large（总内存 ≥ 8 GiB）
# 高配默认不设子容器硬上限，由 DST/SteamCMD 按需使用；若需防止单容器失控可取消注释：
# GSH_STEAMCMD_CONTAINER_MEMORY_MB=4096
# GSH_DST_CONTAINER_MEMORY_MB=8192
GSH_HOST_MEMORY_HEADROOM_MB=512
EOF"
      ;;
    README.md)
      run_as_root bash -c "cat > \"${dest_path}\" <<'EOF'
# panel.env 内存预设

按宿主机 **总内存（MemTotal）** 选用预设，写入 `panel.env` 中的 **可选** 子容器内存上限与安装守卫参数。  
默认生产安装**不强制**上限（高配可跑满 Mod）；小内存机建议显式启用预设，避免误设过大上限（如压力测试用的 5120 MiB）。

| 预设文件 | 适用总内存 | 说明 |
|----------|------------|------|
| `small.env` | 约 4 GiB（< 5 GiB） | 单实例地上、少 Mod；不建议洞穴 |
| `medium.env` | 约 6 GiB（5–8 GiB） | 单实例 + 洞穴 + 中等 Mod |
| `large.env` | ≥ 8 GiB | 默认不设硬上限；可按需取消注释 |

## 用法

**安装脚本自动档位**（默认 `GSH_PANEL_ENV_PRESET=auto`）：

```bash
sudo bash ./scripts/install.linux.sh
# 显式指定：sudo GSH_PANEL_ENV_PRESET=small bash ./scripts/install.linux.sh
```

**已安装后手动合并**（保留现有 `panel.env`，追加预设行）：

```bash
sudo bash -c 'cat /opt/game-server-hub/config/panel.env.presets/small.env >> /opt/game-server-hub/panel.env'
# 安装脚本会将预设同步到 PANEL_INSTALL_DIR/config/panel.env.presets/
cd /opt/game-server-hub
sudo docker compose --env-file panel.env -f docker-compose.yml -f docker-compose.bind.yml up -d
```

完整说明见 [docs/MEMORY.md](../../docs/MEMORY.md)。
EOF"
      ;;
    *)
      return 1
      ;;
  esac

  return 0
}

# registry 连通性预检：探测 registry v2 端点（200/401/403 视为可达），避免 HEAD / 405 误报。
check_registry_reachability() {
  local registry="${1:-ghcr.io}"
  local status_code

  status_code="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout "${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS}" --max-time "${GHCR_CHECK_TIMEOUT_SECONDS}" "https://${registry}/v2/")" || return 1
  case "${status_code}" in
    200|401|403|404|405|30[0-9])
      log_info "Registry preflight check passed via https://${registry}/v2/ (HTTP ${status_code})."
      return 0
      ;;
    *)
      log_warn "Registry preflight returned HTTP ${status_code} on https://${registry}/v2/."
      return 1
      ;;
  esac
}

# 兼容旧调用点：network profile 打分仍以 GHCR 可达性作为 global 档位信号。
check_ghcr_reachability() {
  check_registry_reachability "ghcr.io"
}

# 生成三个镜像键（v0.2.0 统一镜像：三键同值；PANEL_IMAGE_OVERRIDE 设置时直接采用）。
finalize_image_refs() {
  if [[ -n "${PANEL_IMAGE_OVERRIDE}" ]]; then
    PANEL_IMAGE="${PANEL_IMAGE_OVERRIDE}"
    GSH_GAME_DST_IMAGE="${PANEL_IMAGE_OVERRIDE}"
    GSH_STEAMCMD_IMAGE="${PANEL_IMAGE_OVERRIDE}"
    INSTALL_STEAMCMD_PULL_IMAGE="${PANEL_IMAGE_OVERRIDE}"
    log_info "Image override in effect: ${PANEL_IMAGE}"
    return
  fi
  PANEL_IMAGE="ghcr.io/pmat77/game-server-hub:${PANEL_IMAGE_TAG}"
  GSH_GAME_DST_IMAGE="${PANEL_IMAGE}"
  GSH_STEAMCMD_IMAGE="${PANEL_IMAGE}"
  INSTALL_STEAMCMD_PULL_IMAGE="${PANEL_IMAGE}"
  log_info "Panel image: ${PANEL_IMAGE}"
  log_info "DST image: ${GSH_GAME_DST_IMAGE}"
  log_info "SteamCMD image: ${GSH_STEAMCMD_IMAGE}"
}

probe_https_url() {
  local url="$1"
  local timeout_seconds="${2:-6}"
  curl -fsSL -o /dev/null --connect-timeout 3 --max-time "${timeout_seconds}" "${url}" >/dev/null 2>&1
}

# 基于实际连通性选择网络档位，不通过 IP 地理接口收集服务器位置。
resolve_network_profile() {
  local global_score=0

  case "${NETWORK_PROFILE}" in
    cn|global)
      RESOLVED_NETWORK_PROFILE="${NETWORK_PROFILE}"
      ;;
    auto)
      probe_https_url "https://raw.githubusercontent.com/" 5 && global_score=$((global_score + 1))
      probe_https_url "https://download.docker.com/" 5 && global_score=$((global_score + 1))
      check_ghcr_reachability >/dev/null 2>&1 && global_score=$((global_score + 1))
      if [[ "${global_score}" -ge 2 ]]; then
        RESOLVED_NETWORK_PROFILE="global"
      elif probe_https_url "${DEBIAN_MIRROR_URL}/" 5; then
        RESOLVED_NETWORK_PROFILE="cn"
      else
        RESOLVED_NETWORK_PROFILE="global"
        log_warn "Unable to confirm a reachable CN mirror; retaining global sources."
      fi
      ;;
    *)
      abort "Invalid network profile '${NETWORK_PROFILE}'. Expected auto, cn or global."
      ;;
  esac

  if [[ "${RESOLVED_NETWORK_PROFILE}" == "cn" ]]; then
    USE_CN_DEBIAN_MIRROR=1
    log_info "Network profile: cn (distribution mirror + extended SteamCMD retries)."
  else
    log_info "Network profile: global."
  fi
}

resolve_install_mode() {
  case "${INSTALL_MODE}" in
    docker|native)
      RESOLVED_INSTALL_MODE="${INSTALL_MODE}"
      ;;
    auto)
      if command -v docker >/dev/null 2>&1; then
        RESOLVED_INSTALL_MODE="docker"
      elif [[ -t 0 && -t 1 ]]; then
        printf 'Select deployment mode [1=Docker (recommended for communities), 2=Native systemd]: '
        local answer
        read -r answer
        case "${answer}" in
          2|native|Native)
            RESOLVED_INSTALL_MODE="native"
            ;;
          *)
            RESOLVED_INSTALL_MODE="docker"
            ;;
        esac
      else
        # 非交互场景保持 Docker 默认值；若失败会给出显式 Native 重试命令，不静默改变隔离模型。
        RESOLVED_INSTALL_MODE="docker"
      fi
      ;;
    *)
      abort "Invalid install mode '${INSTALL_MODE}'. Expected auto, docker or native."
      ;;
  esac
  log_info "Deployment mode: ${RESOLVED_INSTALL_MODE}."
}

# 校验系统是否提供 apt-get（仅支持 Debian/Ubuntu 体系）。
ensure_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    if command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
      abort "RHEL/Rocky/Alma hosts are supported in docker mode only (native systemd packaging is Debian/Ubuntu). Rerun with --mode docker."
    fi
    abort "Only Debian/Ubuntu systems with apt are supported."
  fi
}

# 识别发行版与代号，用于后续 apt 仓库配置。
detect_distro() {
  if [[ ! -f /etc/os-release ]]; then
    abort "/etc/os-release not found. Unsupported Linux distribution."
  fi

  # shellcheck disable=SC1091
  source /etc/os-release
  DISTRO_ID="${ID:-}"
  DISTRO_CODENAME="${VERSION_CODENAME:-}"

  if [[ -z "${DISTRO_ID}" ]]; then
    abort "Cannot detect Linux distribution."
  fi

  if [[ "${DISTRO_ID}" != "ubuntu" && "${DISTRO_ID}" != "debian" ]]; then
    abort "Unsupported distribution: ${DISTRO_ID}. Only Ubuntu/Debian are supported."
  fi

  if [[ -z "${DISTRO_CODENAME}" && -n "${VERSION:-}" ]]; then
    DISTRO_CODENAME="$(echo "${VERSION}" | awk -F'[() ]' '{print $2}')"
  fi

  if [[ -z "${DISTRO_CODENAME}" ]]; then
    abort "Cannot detect distro codename from /etc/os-release."
  fi
}

# 统一 apt 安装入口，使用非交互模式避免阻塞。
apt_install() {
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
}

# 备份 apt 源配置，便于失败时恢复到系统默认。
backup_apt_sources() {
  run_as_root rm -rf "${APT_SOURCES_BACKUP_DIR}"
  run_as_root mkdir -p "${APT_SOURCES_BACKUP_DIR}"

  if run_as_root test -f /etc/apt/sources.list; then
    run_as_root cp /etc/apt/sources.list "${APT_SOURCES_BACKUP_DIR}/sources.list"
  fi

  if run_as_root test -f /etc/apt/sources.list.d/debian.sources; then
    run_as_root cp /etc/apt/sources.list.d/debian.sources "${APT_SOURCES_BACKUP_DIR}/debian.sources"
  fi

  if run_as_root test -f /etc/apt/sources.list.d/ubuntu.sources; then
    run_as_root cp /etc/apt/sources.list.d/ubuntu.sources "${APT_SOURCES_BACKUP_DIR}/ubuntu.sources"
  fi
}

# 恢复 apt 源配置到脚本运行前状态。
restore_apt_sources_backup() {
  if run_as_root test -f "${APT_SOURCES_BACKUP_DIR}/sources.list"; then
    run_as_root cp "${APT_SOURCES_BACKUP_DIR}/sources.list" /etc/apt/sources.list
  else
    run_as_root rm -f /etc/apt/sources.list
  fi

  if run_as_root test -f "${APT_SOURCES_BACKUP_DIR}/debian.sources"; then
    run_as_root cp "${APT_SOURCES_BACKUP_DIR}/debian.sources" /etc/apt/sources.list.d/debian.sources
  else
    run_as_root rm -f /etc/apt/sources.list.d/debian.sources
  fi

  if run_as_root test -f "${APT_SOURCES_BACKUP_DIR}/ubuntu.sources"; then
    run_as_root cp "${APT_SOURCES_BACKUP_DIR}/ubuntu.sources" /etc/apt/sources.list.d/ubuntu.sources
  else
    run_as_root rm -f /etc/apt/sources.list.d/ubuntu.sources
  fi
}

# 将 Debian apt 源切换为国内镜像（bookworm/bookworm-updates/bookworm-backports/security）。
apply_cn_debian_mirror() {
  run_as_root rm -f /etc/apt/sources.list.d/debian.sources
  run_as_root bash -c "cat > /etc/apt/sources.list <<EOF
deb ${DEBIAN_MIRROR_URL} ${DISTRO_CODENAME} main contrib non-free non-free-firmware
deb ${DEBIAN_MIRROR_URL} ${DISTRO_CODENAME}-updates main contrib non-free non-free-firmware
deb ${DEBIAN_MIRROR_URL} ${DISTRO_CODENAME}-backports main contrib non-free non-free-firmware
deb ${DEBIAN_SECURITY_MIRROR_URL} ${DISTRO_CODENAME}-security main contrib non-free non-free-firmware
EOF"
}

# 将 Ubuntu apt 源切换为国内镜像；发行版签名仍由系统密钥验证。
apply_cn_ubuntu_mirror() {
  run_as_root rm -f /etc/apt/sources.list.d/ubuntu.sources
  run_as_root bash -c "cat > /etc/apt/sources.list <<EOF
deb ${UBUNTU_MIRROR_URL} ${DISTRO_CODENAME} main restricted universe multiverse
deb ${UBUNTU_MIRROR_URL} ${DISTRO_CODENAME}-updates main restricted universe multiverse
deb ${UBUNTU_MIRROR_URL} ${DISTRO_CODENAME}-backports main restricted universe multiverse
deb ${UBUNTU_MIRROR_URL} ${DISTRO_CODENAME}-security main restricted universe multiverse
EOF"
}

# Debian / Ubuntu 优先使用国内镜像；失败则回退系统默认源。
prepare_apt_sources() {
  if [[ "${USE_CN_DEBIAN_MIRROR}" != "1" ]]; then
    run_with_retry "apt-get update" run_as_root apt-get update -y || abort "apt-get update failed."
    return
  fi

  backup_apt_sources
  if [[ "${DISTRO_ID}" == "debian" ]]; then
    apply_cn_debian_mirror
  else
    apply_cn_ubuntu_mirror
  fi

  if run_with_retry "apt-get update with CN mirror" run_as_root apt-get update -y; then
    log_info "Using CN ${DISTRO_ID} mirror."
    return
  fi

  log_warn "CN mirror update failed. Rolling back to default apt sources..."
  restore_apt_sources_backup
  run_with_retry "apt-get update after rollback" run_as_root apt-get update -y || abort "apt-get update failed after rollback."
}

# 安装后续步骤所需的基础依赖。
install_base_packages() {
  log_info "Installing base packages..."
  prepare_apt_sources
  apt_install ca-certificates curl gnupg lsb-release software-properties-common apt-transport-https jq sqlite3
}

# 配置 Docker 官方 apt 仓库与 GPG key。
configure_docker_repo() {
  local arch repo keyring
  arch="$(dpkg --print-architecture)"
  keyring="/etc/apt/keyrings/docker.gpg"
  repo="https://download.docker.com/linux/${DISTRO_ID}"

  log_info "Configuring Docker apt repository..."
  run_as_root install -m 0755 -d /etc/apt/keyrings
  run_as_root rm -f "${keyring}"
  if ! curl -fsSL --connect-timeout 8 --max-time 30 "${repo}/gpg" | run_as_root gpg --dearmor -o "${keyring}"; then
    log_warn "Unable to download Docker repository signing key from ${repo}."
    return 1
  fi
  run_as_root chmod a+r "${keyring}"
  run_as_root bash -c "echo 'deb [arch=${arch} signed-by=${keyring}] ${repo} ${DISTRO_CODENAME} stable' > /etc/apt/sources.list.d/docker.list"
}

# 安装 Docker（如未安装），并确保守护进程与 compose 插件可用。
install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log_info "Docker already installed. Skipping package installation."
  else
    if configure_docker_repo \
      && run_as_root apt-get update -y \
      && apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin; then
      log_info "Docker CE installed from the official repository."
    else
      log_warn "Docker CE repository is unavailable. Trying signed distribution packages..."
      run_as_root rm -f /etc/apt/sources.list.d/docker.list
      run_as_root apt-get update -y || return 1
      apt_install docker.io || return 1
      if apt-cache show docker-compose-v2 >/dev/null 2>&1; then
        apt_install docker-compose-v2 || return 1
      elif apt-cache show docker-compose-plugin >/dev/null 2>&1; then
        apt_install docker-compose-plugin || return 1
      fi
    fi
  fi

  log_info "Ensuring Docker service is enabled..."
  run_as_root systemctl enable --now docker || return 1
  if ! run_as_root docker compose version >/dev/null 2>&1; then
    log_error "Docker Compose v2 plugin is required but unavailable."
    return 1
  fi
}

# 将当前执行用户加入 docker 组，避免非 root 场景下无法使用 Docker CLI。
add_user_to_docker_group() {
  local target_user
  target_user="${SUDO_USER:-${USER:-}}"

  if [[ -z "${target_user}" ]]; then
    log_warn "Cannot determine target user for docker group assignment."
    return
  fi

  if [[ "${target_user}" == "root" ]]; then
    return
  fi

  if ! getent group docker >/dev/null 2>&1; then
    run_as_root groupadd docker
  fi

  run_as_root usermod -aG docker "${target_user}" || true
  log_info "Added ${target_user} to docker group. Re-login is required for group changes to take effect."
}

install_native_dependencies() {
  if [[ "$(uname -m)" != "x86_64" ]]; then
    abort "Native mode currently supports x86_64 only. ARM64 remains experimental and has no Release artifact."
  fi
  if ! dpkg --print-foreign-architectures | grep -Fxq i386; then
    run_as_root dpkg --add-architecture i386
    run_as_root apt-get update -y
  fi
  apt_install tar gzip xz-utils lib32gcc-s1 libstdc++6:i386 libc6:i386
}

ensure_native_service_user() {
  if ! getent group "${NATIVE_SERVICE_GROUP}" >/dev/null 2>&1; then
    run_as_root groupadd --system "${NATIVE_SERVICE_GROUP}"
  fi
  if ! id "${NATIVE_SERVICE_USER}" >/dev/null 2>&1; then
    run_as_root useradd \
      --system \
      --gid "${NATIVE_SERVICE_GROUP}" \
      --home-dir "${NATIVE_USER_HOME}" \
      --create-home \
      --shell /usr/sbin/nologin \
      "${NATIVE_SERVICE_USER}"
  fi
  run_as_root mkdir -p \
    "${NATIVE_USER_HOME}/.config/systemd/user" \
    "${PANEL_DATA_DIR}" \
    "${PANEL_LOG_DIR}" \
    "${PANEL_INSTANCES_DIR}" \
    "${PANEL_BACKUPS_DIR}" \
    "${PANEL_DATA_DIR}/runtime"
  run_as_root chown -R "${NATIVE_SERVICE_USER}:${NATIVE_SERVICE_GROUP}" \
    "${NATIVE_USER_HOME}" \
    "${PANEL_DATA_DIR}" \
    "${PANEL_LOG_DIR}"

  local native_uid
  native_uid="$(id -u "${NATIVE_SERVICE_USER}")"
  run_as_root loginctl enable-linger "${NATIVE_SERVICE_USER}"
  run_as_root systemctl start "user@${native_uid}.service"
}

verify_native_archive_paths() {
  local archive_path="$1"
  if tar -tzf "${archive_path}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    return 1
  fi
  return 0
}

download_native_release_archive() {
  local archive_dest="$1"
  local checksum_dest="$2"
  local archive_filename="${NATIVE_RELEASE_NAME}.tar.gz"
  local checksum_filename="${archive_filename}.sha256"
  local source expected_sum actual_sum

  if [[ -n "${NATIVE_RELEASE_ARCHIVE}" ]]; then
    if [[ ! -f "${NATIVE_RELEASE_ARCHIVE}" ]]; then
      log_error "Configured Native archive does not exist: ${NATIVE_RELEASE_ARCHIVE}"
      return 1
    fi
    cp "${NATIVE_RELEASE_ARCHIVE}" "${archive_dest}"
    if [[ -f "${NATIVE_RELEASE_ARCHIVE}.sha256" ]]; then
      cp "${NATIVE_RELEASE_ARCHIVE}.sha256" "${checksum_dest}"
    elif [[ -n "${GSH_NATIVE_RELEASE_SHA256:-}" ]]; then
      printf '%s  %s\n' "${GSH_NATIVE_RELEASE_SHA256}" "${archive_filename}" > "${checksum_dest}"
    else
      log_error "Local Native archive requires a sibling .sha256 file or GSH_NATIVE_RELEASE_SHA256."
      return 1
    fi
  else
    if [[ -z "${NATIVE_RELEASE_MIRRORS}" ]]; then
      NATIVE_RELEASE_MIRRORS="$(build_github_url_variants "https://github.com/PMAT77/game-serve-hub/releases/download/${GSH_RELEASE_TAG}")"
      log_info "Native release mirrors: ${NATIVE_RELEASE_MIRRORS}"
    fi
    local raw_sources=()
    IFS=',' read -r -a raw_sources <<< "${NATIVE_RELEASE_MIRRORS}"
    for source in "${raw_sources[@]}"; do
      source="${source%/}"
      log_info "Trying Native Release source: ${source}"
      if curl -fL \
        --connect-timeout "${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS}" \
        --max-time 600 \
        -o "${archive_dest}" \
        "${source}/${archive_filename}" \
        && curl -fL \
          --connect-timeout "${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS}" \
          --max-time "${REPO_DOWNLOAD_TIMEOUT_SECONDS}" \
          -o "${checksum_dest}" \
          "${source}/${checksum_filename}"; then
        break
      fi
      rm -f "${archive_dest}" "${checksum_dest}"
    done
  fi

  if [[ ! -s "${archive_dest}" || ! -s "${checksum_dest}" ]]; then
    log_error "Unable to download Native Release ${archive_filename} and its checksum."
    return 1
  fi
  expected_sum="$(awk 'NR == 1 { print $1 }' "${checksum_dest}")"
  actual_sum="$(sha256sum "${archive_dest}" | awk '{print $1}')"
  if [[ -z "${expected_sum}" || "${expected_sum}" != "${actual_sum}" ]]; then
    log_error "Native Release checksum mismatch: expected ${expected_sum:-missing}, got ${actual_sum}."
    return 1
  fi
  verify_native_archive_paths "${archive_dest}" || {
    log_error "Native Release contains an unsafe archive path."
    return 1
  }
}

install_native_release() {
  local temp_dir archive_path checksum_path extracted_root target_dir replaced_dir
  temp_dir="$(mktemp -d)"
  archive_path="${temp_dir}/${NATIVE_RELEASE_NAME}.tar.gz"
  checksum_path="${archive_path}.sha256"

  download_native_release_archive "${archive_path}" "${checksum_path}" || {
    rm -rf "${temp_dir}"
    abort "Native Release download failed. Verify the ${GSH_RELEASE_TAG} GitHub Release assets or set GSH_NATIVE_RELEASE_ARCHIVE."
  }
  tar -xzf "${archive_path}" -C "${temp_dir}"
  extracted_root="${temp_dir}/${NATIVE_RELEASE_NAME}"
  if [[ ! -x "${extracted_root}/bin/game-server-hub" || ! -f "${extracted_root}/release.json" ]]; then
    rm -rf "${temp_dir}"
    abort "Native Release is incomplete: launcher or release.json is missing."
  fi

  target_dir="${NATIVE_RELEASE_ROOT}/${GSH_RELEASE_TAG}"
  run_as_root mkdir -p "${NATIVE_RELEASE_ROOT}"
  if [[ -L "${NATIVE_CURRENT_LINK}" ]]; then
    NATIVE_PREVIOUS_RELEASE="$(readlink -f "${NATIVE_CURRENT_LINK}" || true)"
  fi
  if run_as_root test -e "${target_dir}"; then
    replaced_dir="${target_dir}.replaced.$(date +%Y%m%d%H%M%S)"
    run_as_root mv "${target_dir}" "${replaced_dir}"
  fi
  run_as_root mv "${extracted_root}" "${target_dir}"
  run_as_root chown -R root:"${NATIVE_SERVICE_GROUP}" "${target_dir}"
  run_as_root chmod -R a-w "${target_dir}"
  run_as_root chmod 0755 "${target_dir}/bin/game-server-hub"
  run_as_root ln -sfn "${target_dir}" "${NATIVE_CURRENT_LINK}.new"
  run_as_root mv -Tf "${NATIVE_CURRENT_LINK}.new" "${NATIVE_CURRENT_LINK}"
  rm -rf "${temp_dir}"
}

install_native_steamcmd() {
  local temp_archive
  if run_as_root test -x "${NATIVE_STEAMCMD_PATH}"; then
    log_info "Native SteamCMD already installed: ${NATIVE_STEAMCMD_PATH}"
    return
  fi
  temp_archive="$(mktemp)"
  if ! run_with_retry "download Native SteamCMD" curl -fL \
    --connect-timeout "${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS}" \
    --max-time 600 \
    -o "${temp_archive}" \
    "${NATIVE_STEAMCMD_URL}"; then
    rm -f "${temp_archive}"
    abort "SteamCMD download failed: ${NATIVE_STEAMCMD_URL}"
  fi
  run_as_root mkdir -p "${NATIVE_STEAMCMD_DIR}"
  run_as_root tar -xzf "${temp_archive}" -C "${NATIVE_STEAMCMD_DIR}"
  rm -f "${temp_archive}"
  run_as_root chown -R "${NATIVE_SERVICE_USER}:${NATIVE_SERVICE_GROUP}" "${NATIVE_STEAMCMD_DIR}"
  run_as_root chmod 0755 "${NATIVE_STEAMCMD_PATH}"
}

prepare_native_panel_env() {
  local native_uid steamcmd_region steamcmd_attempts existing_port existing_public_url
  native_uid="$(id -u "${NATIVE_SERVICE_USER}")"
  steamcmd_region=""
  steamcmd_attempts=5
  if [[ "${RESOLVED_NETWORK_PROFILE}" == "cn" ]]; then
    steamcmd_region="cn"
    steamcmd_attempts=8
  fi
  run_as_root mkdir -p "${PANEL_INSTALL_DIR}"
  if try_as_root test -f "${PANEL_ENV_FILE}"; then
    existing_port="$(read_env_value "${PANEL_ENV_FILE}" "SERVER_PORT")"
    existing_public_url="$(read_env_value "${PANEL_ENV_FILE}" "PANEL_PUBLIC_URL")"
    if [[ "${existing_port}" =~ ^[0-9]+$ ]]; then
      PANEL_PORT="${existing_port}"
    fi
    detect_host_ip
    PANEL_ACCESS_URL="${existing_public_url:-${PANEL_PROTOCOL}://${PANEL_HOST}:${PANEL_PORT}}"
    run_as_root cp -p "${PANEL_ENV_FILE}" "${PANEL_ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)"
    upsert_env_values "${PANEL_ENV_FILE}" \
      "NODE_ENV=production" \
      "GSH_EDITION=community" \
      "GSH_RUNTIME_MODE=native" \
      "GSH_INSTANCES_ROOT=${PANEL_INSTANCES_DIR}" \
      "GSH_BACKUPS_ROOT=${PANEL_BACKUPS_DIR}" \
      "GSH_NATIVE_RUNTIME_DIR=${PANEL_DATA_DIR}/runtime" \
      "GSH_NATIVE_STEAMCMD_PATH=${NATIVE_STEAMCMD_PATH}" \
      "GSH_NATIVE_SYSTEMD_UNIT_DIR=${NATIVE_USER_HOME}/.config/systemd/user" \
      "GSH_GITHUB_REPO=PMAT77/game-serve-hub" \
      "GSH_RELEASE_VERSION=${GSH_RELEASE_TAG}"
    log_info "Preserved existing Native panel.env and updated release/runtime keys."
  else
    detect_host_ip
    PANEL_ACCESS_URL="${PANEL_PROTOCOL}://${PANEL_HOST}:${PANEL_PORT}"
    generate_admin_credentials
    # 用 printf 逐行写入再以 root 原子落盘：环境变量传入的凭证含 $、反引号、引号时
    # 不会被 shell 展开（旧无引号 heredoc 会破坏凭证甚至注入任意行）。
    local panel_env_tmp
    panel_env_tmp="$(mktemp)"
    {
      printf '%s\n' \
        "NODE_ENV=production" \
        "SERVER_HOST=0.0.0.0" \
        "SERVER_PORT=${PANEL_PORT}" \
        "DB_PATH=${PANEL_DATA_DIR}/game-server-hub.sqlite" \
        "SERVER_LOG_DIR=${PANEL_LOG_DIR}" \
        "PANEL_PUBLIC_URL=${PANEL_ACCESS_URL}" \
        "ADMIN_USERNAME=${ADMIN_USERNAME}" \
        "ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
        "FORCE_PASSWORD_CHANGE=1" \
        "GSH_EDITION=community" \
        "GSH_RUNTIME_MODE=native" \
        "GSH_INSTANCES_ROOT=${PANEL_INSTANCES_DIR}" \
        "GSH_BACKUPS_ROOT=${PANEL_BACKUPS_DIR}" \
        "GSH_NATIVE_RUNTIME_DIR=${PANEL_DATA_DIR}/runtime" \
        "GSH_NATIVE_STEAMCMD_PATH=${NATIVE_STEAMCMD_PATH}" \
        "GSH_NATIVE_SYSTEMD_UNIT_DIR=${NATIVE_USER_HOME}/.config/systemd/user" \
        "GSH_STEAMCMD_DOWNLOAD_REGION=${steamcmd_region}" \
        "GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=${steamcmd_attempts}" \
        "GSH_GITHUB_REPO=PMAT77/game-serve-hub" \
        "GSH_RELEASE_VERSION=${GSH_RELEASE_TAG}" \
        "TZ=UTC"
    } > "${panel_env_tmp}"
    run_as_root install -m 0640 -o root -g "${NATIVE_SERVICE_GROUP}" "${panel_env_tmp}" "${PANEL_ENV_FILE}"
    rm -f "${panel_env_tmp}"
  fi

  run_as_root bash -c "cat > \"${NATIVE_SYSTEMD_UNIT}\" <<EOF
[Unit]
Description=Game Server Hub (Native)
After=network-online.target user@${native_uid}.service
Wants=network-online.target
Requires=user@${native_uid}.service

[Service]
Type=simple
User=${NATIVE_SERVICE_USER}
Group=${NATIVE_SERVICE_GROUP}
WorkingDirectory=${NATIVE_CURRENT_LINK}
EnvironmentFile=${PANEL_ENV_FILE}
Environment=HOME=${NATIVE_USER_HOME}
Environment=XDG_RUNTIME_DIR=/run/user/${native_uid}
Environment=DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${native_uid}/bus
ExecStart=${NATIVE_CURRENT_LINK}/bin/game-server-hub
Restart=on-failure
RestartSec=5
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=${PANEL_DATA_DIR} ${PANEL_LOG_DIR} ${NATIVE_USER_HOME} ${PANEL_INSTALL_DIR}/runtime

[Install]
WantedBy=multi-user.target
EOF"
  run_as_root systemctl daemon-reload
}

# 避免将面板绑定到已被占用的宿主机端口。
check_port_conflict() {
  local existing_mode
  if existing_mode="$(resolve_existing_install_mode)" && [[ "${existing_mode}" == "${RESOLVED_INSTALL_MODE}" ]]; then
    log_info "Skipping port-conflict rejection for the existing ${existing_mode} installation."
    return
  fi
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :${PANEL_PORT} )" | awk 'NR > 1 { found = 1 } END { exit(found ? 0 : 1) }'; then
      abort "Port ${PANEL_PORT} is already in use. Set PANEL_PORT to an unused port and retry."
    fi
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    if lsof -iTCP:"${PANEL_PORT}" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
      abort "Port ${PANEL_PORT} is already in use. Set PANEL_PORT to an unused port and retry."
    fi
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    if netstat -ltn 2>/dev/null | awk -v port=":${PANEL_PORT}" '$4 ~ port"$" { found = 1 } END { exit(found ? 0 : 1) }'; then
      abort "Port ${PANEL_PORT} is already in use. Set PANEL_PORT to an unused port and retry."
    fi
    return
  fi

  log_warn "Port conflict check skipped: ss/lsof/netstat not found."
}

# 优先使用现有防火墙工具开放端口；若不可用则给出手动提示。
open_firewall_port() {
  local rule_desc
  rule_desc="tcp/${PANEL_PORT}"

  if command -v ufw >/dev/null 2>&1; then
    if ! run_as_root ufw status >/dev/null 2>&1; then
      log_warn "ufw detected but not active/initialized. Skipping automatic firewall rule."
      return
    fi
    log_info "Configuring firewall via ufw: allow ${rule_desc}"
    if run_as_root ufw allow "${PANEL_PORT}/tcp" >/dev/null; then
      log_warn "Firewall note: panel port ${PANEL_PORT} is exposed externally. Restrict source IPs if needed."
    else
      log_warn "Failed to apply ufw rule for ${rule_desc}. Please allow it manually."
    fi
    return
  fi

  if command -v firewall-cmd >/dev/null 2>&1; then
    if run_as_root systemctl is-active --quiet firewalld; then
      log_info "Configuring firewall via firewalld: allow ${rule_desc}"
      if run_as_root firewall-cmd --add-port="${PANEL_PORT}/tcp" --permanent >/dev/null && run_as_root firewall-cmd --reload >/dev/null; then
        log_warn "Firewall note: panel port ${PANEL_PORT} is exposed externally. Restrict source IPs if needed."
      else
        log_warn "Failed to apply firewalld rule for ${rule_desc}. Please allow it manually."
      fi
      return
    fi
    log_warn "firewall-cmd detected but firewalld is not active. Skipping automatic firewall rule."
    return
  fi

  log_warn "No ufw/firewalld detected. Please open tcp/${PANEL_PORT} manually."
}

# 可选：开放 DST 默认 UDP 游戏端口（地表 + Steam 注册/主服务器）
open_firewall_dst_ports() {
  local ports=("${DST_GAME_PORT}" "${DST_AUTH_PORT}" "${DST_MASTER_PORT}")
  local port rule_desc

  for port in "${ports[@]}"; do
    rule_desc="udp/${port}"
    if command -v ufw >/dev/null 2>&1; then
      log_info "Configuring firewall via ufw: allow ${rule_desc}"
      run_as_root ufw allow "${port}/udp" >/dev/null || true
      continue
    fi
    if command -v firewall-cmd >/dev/null 2>&1; then
      log_info "Configuring firewall via firewalld: allow ${rule_desc}"
      run_as_root firewall-cmd --add-port="${port}/udp" --permanent >/dev/null || true
      continue
    fi
    log_warn "No ufw/firewalld detected. Please open ${rule_desc} manually (and cloud security group)."
    return
  done

  if command -v firewall-cmd >/dev/null 2>&1; then
    run_as_root firewall-cmd --reload >/dev/null || true
  fi
  log_warn "Firewall note: DST UDP ports ${DST_GAME_PORT}/${DST_AUTH_PORT}/${DST_MASTER_PORT} opened. Adjust if you changed server.ini ports."
}

print_usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [options]

Options:
  --mode MODE         Deployment mode: auto, docker or native
  --network PROFILE   Network profile: auto, cn or global
  --open-panel-port  Open panel TCP port (${PANEL_PORT}) via ufw/firewalld
  --open-dst-ports   Open default DST UDP ports (${DST_GAME_PORT}, ${DST_AUTH_PORT}, ${DST_MASTER_PORT}) via ufw/firewalld
  -h, --help         Show this help

Environment (optional):
  GSH_INSTALL_MODE=MODE          Same as --mode
  GSH_NETWORK_PROFILE=PROFILE    Same as --network
  INSTALL_STEAMCMD_IMAGE=0      Skip SteamCMD pre-pull (default: pre-pull so the panel is ready to create instances)
  PANEL_IMAGE=REF               Full unified image reference (tag or digest); overrides the GHCR default
  GSH_GAME_DST_IMAGE=REF        Kept for compatibility; defaults to PANEL_IMAGE (v0.2.0 unified image)
  GSH_STEAMCMD_IMAGE=REF        Kept for compatibility; defaults to PANEL_IMAGE (v0.2.0 unified image)
  GSH_GITHUB_PROXY=URL          Force one GitHub accelerator (e.g. https://gh-proxy.com/)
  PANEL_HEALTHCHECK_TIMEOUT_SECONDS=90  Maximum wait for panel /health after startup
  PANEL_HEALTHCHECK_INTERVAL_SECONDS=3  Panel /health polling interval
  USE_CN_DEBIAN_MIRROR=1        Enable CN Debian/Ubuntu mirror
  GSH_NATIVE_RELEASE_ARCHIVE=PATH  Install a local Native Release archive
  STRICT_INSTALLER_ASSET_CHECKSUM=0  Skip embedded checksum verification (not recommended)
  v0.2.0 unified image: one docker pull provides the panel, DST runtime libraries and SteamCMD.
EOF
}

# 未提供 PANEL_HOST 时，自动探测主机首个可用 IP。
detect_host_ip() {
  if [[ -n "${PANEL_HOST}" ]]; then
    return
  fi

  PANEL_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [[ -z "${PANEL_HOST}" ]]; then
    PANEL_HOST="127.0.0.1"
  fi
}

# 调用方未提供管理员密码时，自动生成一次性密码。
generate_admin_credentials() {
  if [[ -z "${ADMIN_PASSWORD}" ]]; then
    if command -v openssl >/dev/null 2>&1; then
      ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-18)"
    else
      # /dev/urandom 是始终存在的内核熵源；旧回退用秒级时间戳（约 30 bit 熵）可被离线枚举。
      ADMIN_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
    fi
  fi
}

# 读取宿主机总内存（MiB），失败时返回 0。
read_host_mem_total_mb() {
  awk '/^MemTotal:/ { printf "%d", int($2 / 1024); exit }' /proc/meminfo 2>/dev/null || echo 0
}

# 按总内存解析 panel.env 预设名（auto 时自动分档）。
resolve_panel_env_preset_name() {
  local total_mb="$1"
  local preset="${GSH_PANEL_ENV_PRESET}"

  case "${preset}" in
    none|off|disable)
      printf '%s' "none"
      return
      ;;
    small|medium|large)
      printf '%s' "${preset}"
      return
      ;;
    auto|"")
      ;;
    *)
      log_warn "Unknown GSH_PANEL_ENV_PRESET=${preset}, fallback to auto."
      ;;
  esac

  if [[ "${total_mb}" -lt "${HOST_MEMORY_TIER_SMALL_MAX_MB}" ]]; then
    printf '%s' "small"
  elif [[ "${total_mb}" -lt "${HOST_MEMORY_TIER_MEDIUM_MAX_MB}" ]]; then
    printf '%s' "medium"
  else
    printf '%s' "large"
  fi
}

# 安装前内存档位提示（不阻断安装）。
warn_host_memory_tier() {
  local total_mb="$1"
  local preset_name tier_label

  if [[ "${total_mb}" -le 0 ]]; then
    log_warn "Cannot read host MemTotal; skip memory tier warning."
    return
  fi

  preset_name="$(resolve_panel_env_preset_name "${total_mb}")"
  case "${preset_name}" in
    small) tier_label="小内存（约 4 GiB）" ;;
    medium) tier_label="中等（约 6 GiB）" ;;
    large) tier_label="充足（8 GiB 及以上）" ;;
    *) tier_label="未应用预设" ;;
  esac

  log_info "Host memory total: ${total_mb} MB (tier: ${tier_label}, preset: ${preset_name})"

  if [[ "${total_mb}" -lt "${HOST_MEMORY_WARN_MIN_MB}" ]]; then
    log_warn "Host RAM is below ~4 GiB. Recommended: single surface shard, few mods, avoid caves. See docs/MEMORY.md."
    log_warn "Single instance + caves + many mods may OOM. Consider upgrading to 6-8 GiB, use preset: config/panel.env.presets/small.env, and run: gsh setup-swap"
    write_status "preflight" "warn" "Low host RAM ${total_mb} MB; see docs/MEMORY.md and gsh setup-swap"
  elif [[ "${total_mb}" -lt "${HOST_MEMORY_TIER_SMALL_MAX_MB}" ]]; then
    log_warn "Host RAM tier is small (<5 GiB). Caves and heavy mod sets increase OOM risk. See docs/MEMORY.md; consider: gsh setup-swap"
    write_status "preflight" "warn" "Host RAM tier small (${total_mb} MB)"
  fi
}

# 同步 panel.env 预设到安装目录（优先本地仓库，其次脚本内置，最后镜像池下载）。
sync_panel_env_presets() {
  local script_dir src_dir dest_dir item
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  src_dir="${script_dir}/../config/panel.env.presets"
  dest_dir="${PANEL_INSTALL_DIR}/config/panel.env.presets"

  run_as_root mkdir -p "${dest_dir}"
  for item in small.env medium.env large.env README.md; do
    if [[ -f "${src_dir}/${item}" ]]; then
      run_as_root cp "${src_dir}/${item}" "${dest_dir}/${item}"
    elif write_builtin_panel_env_preset_asset "${item}" "${dest_dir}/${item}"; then
      log_info "Synced panel.env preset from built-in asset: ${item}"
    elif download_installer_asset "config/panel.env.presets/${item}" "${dest_dir}/${item}"; then
      log_info "Downloaded panel.env preset asset: ${item}"
    else
      log_warn "Could not sync preset asset: ${item}"
    fi
  done
}

# 将 config/panel.env.presets/<name>.env 追加到 panel.env（若存在）。
append_panel_env_preset() {
  local preset_name="$1"
  local script_dir preset_file

  if [[ "${preset_name}" == "none" ]]; then
    log_info "GSH_PANEL_ENV_PRESET=none, skip merging panel.env preset."
    return
  fi

  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  preset_file="${PANEL_INSTALL_DIR}/config/panel.env.presets/${preset_name}.env"
  if [[ ! -f "${preset_file}" ]]; then
    preset_file="${script_dir}/../config/panel.env.presets/${preset_name}.env"
  fi
  if [[ ! -f "${preset_file}" ]]; then
    log_warn "Preset file not found: ${preset_name}.env (install dir and repo copy missing)"
    return
  fi

  run_as_root bash -c "printf '\n# --- merged by install.linux.sh (GSH_PANEL_ENV_PRESET=%s) ---\n' \"${preset_name}\" >> \"${PANEL_ENV_FILE}\""
  run_as_root bash -c "cat \"${preset_file}\" >> \"${PANEL_ENV_FILE}\""
  log_info "Merged panel.env preset: ${preset_name} (${preset_file})"
  write_status "deploy" "ok" "Merged panel.env preset ${preset_name}"
}

# 在生成配置与部署前，先校验主机前置条件。
preflight_checks() {
  local arch free_disk_mb host_mem_total_mb
  arch="$(uname -m)"
  free_disk_mb="$(df -Pm / | awk 'NR == 2 { print $4 }')"
  host_mem_total_mb="$(read_host_mem_total_mb)"

  write_status "preflight" "start" "Collecting host information"
  log_info "OS: ${DISTRO_ID} (${DISTRO_CODENAME})"
  log_info "Architecture: ${arch}"
  log_info "Free disk on /: ${free_disk_mb} MB"
  warn_host_memory_tier "${host_mem_total_mb}"

  if [[ "${arch}" != "x86_64" && "${arch}" != "aarch64" ]]; then
    abort "Unsupported architecture ${arch}. Only x86_64/aarch64 are supported."
  fi
  if [[ "${RESOLVED_INSTALL_MODE}" == "native" && "${arch}" != "x86_64" ]]; then
    abort "Native Release is currently available for x86_64 only."
  fi

  if [[ "${free_disk_mb}" -lt "${MIN_FREE_DISK_MB}" ]]; then
    abort "Insufficient disk space on /. Require >= ${MIN_FREE_DISK_MB} MB."
  fi

  if [[ "${RESOLVED_INSTALL_MODE}" == "docker" && -z "${PANEL_IMAGE_OVERRIDE}" ]] && ! check_registry_reachability "ghcr.io"; then
    if [[ "${STRICT_GHCR_CHECK}" == "1" ]]; then
      abort "Cannot reach GHCR endpoint https://ghcr.io/v2/ within ${GHCR_CHECK_TIMEOUT_SECONDS}s. Check outbound network, use the offline image archive from the Release page, or set PANEL_IMAGE to a mirror you control."
    fi
    log_warn "Cannot reach GHCR endpoint https://ghcr.io/v2/ within ${GHCR_CHECK_TIMEOUT_SECONDS}s during preflight. Consider the offline image archive (Release assets) or PANEL_IMAGE override."
  fi
  if [[ "${RESOLVED_INSTALL_MODE}" == "native" ]] && ! command -v systemctl >/dev/null 2>&1; then
    abort "Native mode requires systemd/systemctl."
  fi

  write_status "preflight" "ok" "Host checks passed"
}

# 生成运行目录、环境变量文件与 compose 配置。
prepare_panel_files() {
  local script_dir repo_compose compose_source bind_compose steamcmd_region steamcmd_attempts existing_port existing_public_url is_upgrade
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_compose="${script_dir}/../docker-compose.yml"
  compose_source="${COMPOSE_SOURCE:-${repo_compose}}"
  steamcmd_region=""
  steamcmd_attempts=5
  if [[ "${RESOLVED_NETWORK_PROFILE}" == "cn" ]]; then
    steamcmd_region="cn"
    steamcmd_attempts=8
  fi

  write_status "deploy" "start" "Preparing runtime files"
  run_as_root mkdir -p "${PANEL_INSTALL_DIR}" "${PANEL_DATA_DIR}" "${PANEL_LOG_DIR}" "${PANEL_INSTANCES_DIR}"
  sync_panel_env_presets
  run_as_root chmod 700 "${PANEL_INSTALL_DIR}"
  run_as_root chmod 750 "${PANEL_DATA_DIR}" "${PANEL_LOG_DIR}" "${PANEL_INSTANCES_DIR}"

  is_upgrade=0
  if try_as_root test -f "${PANEL_ENV_FILE}"; then
    is_upgrade=1
    existing_port="$(read_env_value "${PANEL_ENV_FILE}" "PANEL_PORT")"
    existing_public_url="$(read_env_value "${PANEL_ENV_FILE}" "PANEL_PUBLIC_URL")"
    if [[ "${existing_port}" =~ ^[0-9]+$ ]]; then
      PANEL_PORT="${existing_port}"
    fi
  fi
  detect_host_ip
  PANEL_ACCESS_URL="${existing_public_url:-${PANEL_PROTOCOL}://${PANEL_HOST}:${PANEL_PORT}}"

  if [[ -f "${compose_source}" ]]; then
    run_as_root cp "${compose_source}" "${PANEL_COMPOSE_FILE}"
  else
    log_info "Local compose not found, downloading docker-compose.yml from installer mirrors."
    download_installer_asset "docker-compose.yml" "${PANEL_COMPOSE_FILE}" || abort "Failed to download docker-compose.yml from installer mirrors."
  fi
  bind_compose="${script_dir}/../docker-compose.bind.yml"
  if [[ -f "${bind_compose}" ]]; then
    run_as_root cp "${bind_compose}" "${PANEL_BIND_COMPOSE_FILE}"
  else
    download_installer_asset "docker-compose.bind.yml" "${PANEL_BIND_COMPOSE_FILE}" || abort "Failed to download docker-compose.bind.yml from installer mirrors."
  fi

  if [[ "${is_upgrade}" -eq 1 ]]; then
    local old_dst_image old_steamcmd_image
    old_dst_image="$(read_env_value "${PANEL_ENV_FILE}" "GSH_GAME_DST_IMAGE")"
    old_steamcmd_image="$(read_env_value "${PANEL_ENV_FILE}" "GSH_STEAMCMD_IMAGE")"
    if [[ -n "${old_dst_image}" && "${old_dst_image}" != "${PANEL_IMAGE}" ]]; then
      log_info "Detected legacy three-image layout (dst: ${old_dst_image}). Migrating to the v0.2.0 unified image (panel + DST + SteamCMD in one)."
    fi
    if [[ -n "${old_steamcmd_image}" && "${old_steamcmd_image}" != "${PANEL_IMAGE}" ]]; then
      log_info "Legacy SteamCMD image ${old_steamcmd_image} will be replaced by the unified image; old tags can be removed later with docker rmi."
    fi
    run_as_root cp -p "${PANEL_ENV_FILE}" "${PANEL_ENV_FILE}.backup.$(date +%Y%m%d%H%M%S)"
    upsert_env_values "${PANEL_ENV_FILE}" \
      "PANEL_IMAGE=${PANEL_IMAGE}" \
      "GSH_EDITION=community" \
      "GSH_RUNTIME_MODE=docker" \
      "GSH_GAME_DST_IMAGE=${GSH_GAME_DST_IMAGE}" \
      "GSH_STEAMCMD_IMAGE=${GSH_STEAMCMD_IMAGE}" \
      "GSH_STACK_DIR=${PANEL_INSTALL_DIR}" \
      "GSH_COMPOSE_FILES=docker-compose.yml:docker-compose.bind.yml" \
      "GSH_GITHUB_REPO=PMAT77/game-serve-hub" \
      "GSH_RELEASE_VERSION=${GSH_RELEASE_TAG}"
    log_info "Preserved existing Docker panel.env and updated release/image keys."
  else
    generate_admin_credentials
    # 同 native：printf 逐行写入，凭证值不会被 shell 二次展开。
    local panel_env_tmp
    panel_env_tmp="$(mktemp)"
    {
      printf '%s\n' \
        "PANEL_PORT=${PANEL_PORT}" \
        "PANEL_DATA_DIR=${PANEL_DATA_DIR}" \
        "PANEL_LOG_DIR=${PANEL_LOG_DIR}" \
        "PANEL_INSTANCES_DIR=${PANEL_INSTANCES_DIR}" \
        "PANEL_BACKUPS_DIR=${PANEL_BACKUPS_DIR}" \
        "PANEL_IMAGE=${PANEL_IMAGE}" \
        "PANEL_PUBLIC_URL=${PANEL_ACCESS_URL}" \
        "ADMIN_USERNAME=${ADMIN_USERNAME}" \
        "ADMIN_PASSWORD=${ADMIN_PASSWORD}" \
        "FORCE_PASSWORD_CHANGE=1" \
        "GSH_EDITION=community" \
        "GSH_RUNTIME_MODE=docker" \
        "DOCKER_HOST=unix:///var/run/docker.sock" \
        "GSH_GAME_DST_IMAGE=${GSH_GAME_DST_IMAGE}" \
        "GSH_STEAMCMD_IMAGE=${GSH_STEAMCMD_IMAGE}" \
        "GSH_STEAMCMD_DOWNLOAD_REGION=${steamcmd_region}" \
        "GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=${steamcmd_attempts}" \
        "# GSH_STEAMCMD_INSTALL_RETRY_DELAYS_MS=5000,10000,15000,20000,25000,30000,35000" \
        "# STEAMCMD_USERNAME=" \
        "# STEAMCMD_PASSWORD=" \
        "GSH_STACK_DIR=${PANEL_INSTALL_DIR}" \
        "GSH_COMPOSE_FILES=docker-compose.yml:docker-compose.bind.yml" \
        "GSH_GITHUB_REPO=PMAT77/game-serve-hub" \
        "GSH_RELEASE_VERSION=${GSH_RELEASE_TAG}" \
        "TZ=UTC"
    } > "${panel_env_tmp}"
    run_as_root install -m 0600 -o root "${panel_env_tmp}" "${PANEL_ENV_FILE}"
    rm -f "${panel_env_tmp}"
  fi

  if [[ "${is_upgrade}" -eq 0 ]]; then
    local host_mem_total_mb preset_name
    host_mem_total_mb="$(read_host_mem_total_mb)"
    preset_name="$(resolve_panel_env_preset_name "${host_mem_total_mb}")"
    append_panel_env_preset "${preset_name}"
  fi
}

# 仅在部署阶段开始后启用容器栈回滚。
rollback_install() {
  if [[ "${ROLLBACK_ENABLED}" -ne 1 ]]; then
    return
  fi

  write_status "rollback" "start" "Rolling back failed deployment"
  if [[ "${RESOLVED_INSTALL_MODE}" == "native" ]]; then
    log_warn "Native deployment failed, stopping the panel service..."
    run_as_root systemctl stop game-server-hub.service >/dev/null 2>&1 || true
    restore_existing_install_state
    if [[ -n "${NATIVE_PREVIOUS_RELEASE}" && -d "${NATIVE_PREVIOUS_RELEASE}" ]]; then
      run_as_root ln -sfn "${NATIVE_PREVIOUS_RELEASE}" "${NATIVE_CURRENT_LINK}.rollback"
      run_as_root mv -Tf "${NATIVE_CURRENT_LINK}.rollback" "${NATIVE_CURRENT_LINK}"
      run_as_root systemctl start game-server-hub.service >/dev/null 2>&1 || true
    fi
  else
    log_warn "Deployment failed, rolling back container stack..."
    run_as_root docker compose --env-file "${PANEL_ENV_FILE}" -f "${PANEL_COMPOSE_FILE}" -f "${PANEL_BIND_COMPOSE_FILE}" stop panel >/dev/null 2>&1 || true
    restore_existing_install_state
    if [[ -n "${UPGRADE_STATE_BACKUP_DIR}" ]]; then
      run_as_root docker compose --env-file "${PANEL_ENV_FILE}" -f "${PANEL_COMPOSE_FILE}" -f "${PANEL_BIND_COMPOSE_FILE}" up -d panel >/dev/null 2>&1 || true
    else
      run_as_root docker compose --env-file "${PANEL_ENV_FILE}" -f "${PANEL_COMPOSE_FILE}" -f "${PANEL_BIND_COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true
    fi
  fi
  write_status "rollback" "ok" "Rollback finished"
}

# 安装阶段可选预拉 SteamCMD（默认不拉，由面板内触发）。
pull_install_steamcmd_image() {
  if [[ "${INSTALL_STEAMCMD_IMAGE}" != "1" ]]; then
    return 0
  fi

  if run_with_retry "docker pull ${INSTALL_STEAMCMD_PULL_IMAGE}" run_as_root docker pull "${INSTALL_STEAMCMD_PULL_IMAGE}"; then
    return 0
  fi

  return 1
}

# 拉取运行时镜像（v0.2.0 起统一镜像：面板/DST/SteamCMD 同一引用，一次拉取全部就绪）。
pull_runtime_images() {
  run_with_retry "docker pull ${PANEL_IMAGE}" run_as_root docker pull "${PANEL_IMAGE}" || return 1
}

wait_for_panel_health() {
  local deadline response
  deadline=$((SECONDS + PANEL_HEALTHCHECK_TIMEOUT_SECONDS))
  while (( SECONDS < deadline )); do
    if response="$(curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:${PANEL_PORT}/health" 2>/dev/null)"; then
      if [[ "${RESOLVED_INSTALL_MODE}" == "native" && "${response}" == *'"mode":"native"'* ]]; then
        return 0
      fi
      if [[ "${RESOLVED_INSTALL_MODE}" == "docker" && "${response}" == *'"docker"'* ]]; then
        return 0
      fi
    fi
    sleep "${PANEL_HEALTHCHECK_INTERVAL_SECONDS}"
  done
  LAST_ERROR_MESSAGE="Panel did not become healthy within ${PANEL_HEALTHCHECK_TIMEOUT_SECONDS}s"
  return 1
}

# 拉取镜像并启动服务栈；通过重试应对临时网络抖动。
deploy_panel() {
  begin_stage "images" "Pulling runtime images"
  ROLLBACK_ENABLED=1
  pull_runtime_images || abort "Image pull failed. Check outbound network or configure explicit image references. Native fallback: rerun with --mode native."
  write_status "images" "ok" "Runtime image pull completed"

  begin_stage "startup" "Starting panel stack"
  run_with_retry "docker compose up" run_as_root docker compose --env-file "${PANEL_ENV_FILE}" -f "${PANEL_COMPOSE_FILE}" -f "${PANEL_BIND_COMPOSE_FILE}" up -d
  write_status "startup" "ok" "Panel stack started"

  begin_stage "health" "Waiting for panel health endpoint"
  wait_for_panel_health
  write_status "health" "ok" "Panel health endpoint is ready"
}

deploy_native_panel() {
  begin_stage "native-release" "Installing Native Release"
  if run_as_root test -L "${NATIVE_CURRENT_LINK}"; then
    NATIVE_PREVIOUS_RELEASE="$(readlink -f "${NATIVE_CURRENT_LINK}" || true)"
  fi
  ROLLBACK_ENABLED=1
  install_native_release
  install_native_steamcmd
  write_status "native-release" "ok" "Native Release and SteamCMD installed"

  begin_stage "configuration" "Preparing Native systemd service"
  prepare_native_panel_env
  write_status "configuration" "ok" "Native configuration prepared"

  begin_stage "startup" "Starting Native panel service"
  run_as_root systemctl enable --now game-server-hub.service
  write_status "startup" "ok" "Native panel service started"

  begin_stage "health" "Waiting for Native panel health endpoint"
  wait_for_panel_health
  write_status "health" "ok" "Native panel health endpoint is ready"
}

# 部署 gsh CLI 到 /usr/local/bin（优先本地仓库，其次镜像池下载）。
install_gsh_cli() {
  local script_dir src tmp
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  src="${script_dir}/../scripts/gsh.sh"
  if [[ ! -f "${src}" ]]; then
    tmp="$(mktemp)"
    if download_installer_asset "scripts/gsh.sh" "${tmp}"; then
      src="${tmp}"
    else
      log_warn "gsh.sh not available locally or from mirrors; skip CLI install."
      return 0
    fi
  fi
  run_as_root install -m 0755 "${src}" /usr/local/bin/gsh
  log_info "Installed panel CLI: /usr/local/bin/gsh (try: gsh doctor)"
}

# 输出最终访问信息与安全提醒。
print_summary() {
  write_status "install" "ok" "Installation completed"
  INSTALL_COMPLETED=1
  CURRENT_STAGE="complete"
  log_info "Installation completed."
  log_info "Deployment mode: ${RESOLVED_INSTALL_MODE}"
  log_info "Network profile: ${RESOLVED_NETWORK_PROFILE}"
  if [[ "${RESOLVED_INSTALL_MODE}" == "native" ]]; then
    log_info "Native Release: ${NATIVE_CURRENT_LINK}"
    log_info "Native SteamCMD: ${NATIVE_STEAMCMD_PATH}"
    log_info "Panel service: game-server-hub.service"
  else
    log_info "Unified image (panel + DST + SteamCMD): ${PANEL_IMAGE}"
    log_info "CLI: run gsh (or bash /usr/local/bin/gsh) to manage the panel stack; gsh doctor for diagnostics."
  fi
  log_info "Panel URL: ${PANEL_ACCESS_URL}"
  log_info "Admin username: ${ADMIN_USERNAME}"
  if [[ "${EXPOSE_ADMIN_PASSWORD}" == "1" ]]; then
    log_info "Admin password: ${ADMIN_PASSWORD}"
  else
    log_warn "Admin password is hidden by default. Set EXPOSE_ADMIN_PASSWORD=1 to print it in summary."
  fi
  log_warn "Security note: change the admin password immediately after first login."
  log_info "First-login force password change flag: FORCE_PASSWORD_CHANGE=1"
  log_info "Install status file: ${STATUS_FILE}"
  log_info "Host memory guidance: docs/MEMORY.md (panel.env presets under config/panel.env.presets/)"
}

# 主流程：安装依赖 -> 预检 -> 网络处理 -> 生成配置 -> 部署。
main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --mode)
        [[ $# -ge 2 ]] || abort "--mode requires auto, docker or native."
        INSTALL_MODE="$2"
        shift 2
        ;;
      --mode=*)
        INSTALL_MODE="${1#*=}"
        shift
        ;;
      --network)
        [[ $# -ge 2 ]] || abort "--network requires auto, cn or global."
        NETWORK_PROFILE="$2"
        shift 2
        ;;
      --network=*)
        NETWORK_PROFILE="${1#*=}"
        shift
        ;;
      --open-panel-port)
        OPEN_PANEL_PORT=1
        shift
        ;;
      --open-dst-ports)
        OPEN_DST_PORTS=1
        shift
        ;;

      -h|--help)
        print_usage
        exit 0
        ;;
      *)
        abort "Unknown option: $1 (use --help)"
        ;;
    esac
  done

  # ERR 记录失败位置；EXIT 统一写状态、生成脱敏诊断并执行部署回滚。
  trap 'record_install_error "$?" "$LINENO"' ERR
  trap 'handle_install_exit "$?"' EXIT

  log_info "Running ${SCRIPT_NAME}..."
  begin_stage "install" "Installer started"

  CURRENT_STAGE="platform"
  detect_distro
  ensure_apt
  resolve_network_profile
  resolve_install_mode
  validate_install_mode_transition
  if [[ "${RESOLVED_INSTALL_MODE}" == "docker" ]]; then
    finalize_image_refs
  fi

  begin_stage "dependencies" "Installing base dependencies"
  install_base_packages
  if [[ "${RESOLVED_INSTALL_MODE}" == "docker" ]]; then
    if ! install_docker; then
      abort "Docker installation failed. Fix Docker networking or explicitly retry Native mode with --mode native."
    fi
    add_user_to_docker_group
    write_status "dependencies" "ok" "Docker dependencies installed"
  else
    install_native_dependencies
    ensure_native_service_user
    write_status "dependencies" "ok" "Native systemd dependencies installed"
  fi
  backup_existing_install_state

  CURRENT_STAGE="preflight"
  preflight_checks

  begin_stage "network" "Checking panel port and firewall"
  check_port_conflict
  if [[ "${OPEN_PANEL_PORT}" -eq 1 ]]; then
    open_firewall_port
  else
    log_info "Panel TCP port not opened automatically. Use --open-panel-port or configure firewall/security-group manually."
  fi
  if [[ "${OPEN_DST_PORTS}" -eq 1 ]]; then
    open_firewall_dst_ports
  else
    log_info "DST UDP ports not opened automatically. Use --open-dst-ports or configure firewall manually (see docs/others/DST.md)."
  fi
  write_status "network" "ok" "Port and firewall processed"

  if [[ "${RESOLVED_INSTALL_MODE}" == "docker" ]]; then
    begin_stage "configuration" "Preparing Docker panel configuration"
    prepare_panel_files
    write_status "configuration" "ok" "Docker panel configuration prepared"
    deploy_panel
  else
    deploy_native_panel
  fi

  install_gsh_cli
  print_summary
}

if [[ "${GSH_INSTALLER_LIB_ONLY:-0}" != "1" ]]; then
  main "$@"
fi
