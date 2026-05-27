#!/usr/bin/env bash

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# 安装脚本默认参数与运行时路径
# -----------------------------------------------------------------------------
SCRIPT_NAME="$(basename "$0")" # 当前脚本名称（用于日志展示）。
INSTALLER_REPO_RAW="${INSTALLER_REPO_RAW:-}" # 兼容旧变量：指定单一安装资源源（为空时使用 INSTALLER_REPO_MIRRORS）。
INSTALLER_REPO_MIRRORS="${INSTALLER_REPO_MIRRORS:-https://cdn.jsdelivr.net/gh/GameServerHub/game-server-hub@main,https://ghproxy.com/https://raw.githubusercontent.com/GameServerHub/game-server-hub/main,https://raw.githubusercontent.com/GameServerHub/game-server-hub/main}" # 安装资源镜像池（按顺序回退）。
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
STRICT_DOCKER_REPO_CHECK="${STRICT_DOCKER_REPO_CHECK:-1}" # 是否要求 download.docker.com 预检查必须通过（1=失败即终止，0=失败仅告警）。
USE_CN_DEBIAN_MIRROR="${USE_CN_DEBIAN_MIRROR:-0}" # Debian 是否优先尝试国内镜像（1=启用，0=关闭）。
DEBIAN_MIRROR_URL="${DEBIAN_MIRROR_URL:-https://mirrors.tuna.tsinghua.edu.cn/debian}" # Debian 主仓库镜像。
DEBIAN_SECURITY_MIRROR_URL="${DEBIAN_SECURITY_MIRROR_URL:-https://mirrors.tuna.tsinghua.edu.cn/debian-security}" # Debian 安全仓库镜像。
APT_SOURCES_BACKUP_DIR="/tmp/gsh-apt-sources-backup"

# DST 默认 UDP 端口（与 cluster.ini / server.ini 默认值一致）
DST_GAME_PORT="${DST_GAME_PORT:-10999}"
DST_AUTH_PORT="${DST_AUTH_PORT:-8766}"
DST_MASTER_PORT="${DST_MASTER_PORT:-12346}"

PANEL_NAME="${PANEL_NAME:-game-server-hub}" # 面板逻辑名称（可被环境变量覆盖）。
PANEL_PORT="${PANEL_PORT:-9527}" # 面板对外暴露端口（默认使用高位端口以降低备案拦截影响）。
PANEL_PROTOCOL="${PANEL_PROTOCOL:-http}" # 访问协议（用于生成访问 URL）。
USE_ACR_MIRROR="${USE_ACR_MIRROR:-${USE_CN_GHCR_MIRROR:-0}}" # 是否优先使用 ACR 镜像（1=启用，0=关闭）；兼容历史 USE_CN_GHCR_MIRROR。
INSTALL_STEAMCMD_IMAGE="${INSTALL_STEAMCMD_IMAGE:-0}" # 安装阶段是否预拉 SteamCMD 镜像（1=拉取，0=仅写入 panel.env，由面板内安装）。
PANEL_IMAGE_REPOSITORY_OVERRIDE="${PANEL_IMAGE_REPOSITORY:-}" # 兼容旧变量：显式指定面板镜像仓库时优先使用。
PANEL_IMAGE_OFFICIAL_REPOSITORY="${PANEL_IMAGE_OFFICIAL_REPOSITORY:-ghcr.io/gameserverhub/game-server-hub}" # 面板官方镜像仓库。
ACR_REGISTRY="${ACR_REGISTRY:-registry.cn-hangzhou.aliyuncs.com}" # ACR Registry 域名。
ACR_NAMESPACE="${ACR_NAMESPACE:-game-server-hub}" # ACR 命名空间。
PANEL_IMAGE_ACR_REPOSITORY="${PANEL_IMAGE_ACR_REPOSITORY:-${ACR_REGISTRY}/${ACR_NAMESPACE}/game-server-hub}" # 面板 ACR 镜像仓库。
PANEL_IMAGE_CN_REPOSITORY="${PANEL_IMAGE_CN_REPOSITORY:-${PANEL_IMAGE_ACR_REPOSITORY}}" # 兼容历史变量名：默认等价 ACR 仓库。
GSH_GAME_DST_IMAGE_OFFICIAL_REPOSITORY="${GSH_GAME_DST_IMAGE_OFFICIAL_REPOSITORY:-ghcr.io/gameserverhub/game-server-hub-dst}" # DST 官方镜像仓库。
GSH_GAME_DST_IMAGE_ACR_REPOSITORY="${GSH_GAME_DST_IMAGE_ACR_REPOSITORY:-${ACR_REGISTRY}/${ACR_NAMESPACE}/game-server-hub-dst}" # DST ACR 镜像仓库。
GSH_GAME_DST_IMAGE_CN_REPOSITORY="${GSH_GAME_DST_IMAGE_CN_REPOSITORY:-${GSH_GAME_DST_IMAGE_ACR_REPOSITORY}}" # 兼容历史变量名：默认等价 ACR 仓库。
GSH_STEAMCMD_IMAGE_OFFICIAL_REPOSITORY="${GSH_STEAMCMD_IMAGE_OFFICIAL_REPOSITORY:-ghcr.io/gameserverhub/steamcmd-base}" # SteamCMD 官方镜像仓库（与 CI 同步 GHCR 名一致）。
GSH_STEAMCMD_IMAGE_ACR_REPOSITORY="${GSH_STEAMCMD_IMAGE_ACR_REPOSITORY:-${ACR_REGISTRY}/${ACR_NAMESPACE}/steamcmd-base}" # SteamCMD ACR 镜像仓库（与 sync-to-acr 推送名一致）。
GSH_STEAMCMD_IMAGE_CN_REPOSITORY="${GSH_STEAMCMD_IMAGE_CN_REPOSITORY:-${GSH_STEAMCMD_IMAGE_ACR_REPOSITORY}}" # 兼容历史变量名：默认等价 ACR 仓库。
PANEL_INSTALL_DIR="${PANEL_INSTALL_DIR:-/opt/game-server-hub}" # 安装目录（放置 env/compose）。
PANEL_DATA_DIR="${PANEL_DATA_DIR:-/var/lib/game-server-hub}" # 面板持久化数据目录。
PANEL_LOG_DIR="${PANEL_LOG_DIR:-/var/log/game-server-hub}" # 面板日志与安装状态目录。
PANEL_INSTANCES_DIR="${PANEL_INSTANCES_DIR:-${PANEL_DATA_DIR}/instances}" # 游戏实例数据目录。
PANEL_BACKUPS_DIR="${PANEL_BACKUPS_DIR:-${PANEL_DATA_DIR}/backups}" # 备份目录。
PANEL_BIND_COMPOSE_FILE="${PANEL_INSTALL_DIR}/docker-compose.bind.yml"
PANEL_IMAGE_TAG="${PANEL_IMAGE_TAG:-latest}" # 容器镜像标签。
if [[ -n "${PANEL_IMAGE_REPOSITORY_OVERRIDE}" ]]; then
  PANEL_IMAGE_REPOSITORY="${PANEL_IMAGE_REPOSITORY_OVERRIDE}"
elif [[ "${USE_ACR_MIRROR}" == "1" ]]; then
  PANEL_IMAGE_REPOSITORY="${PANEL_IMAGE_ACR_REPOSITORY}"
else
  PANEL_IMAGE_REPOSITORY="${PANEL_IMAGE_OFFICIAL_REPOSITORY}"
fi
if [[ "${USE_ACR_MIRROR}" == "1" ]]; then
  GSH_GAME_DST_IMAGE_REPOSITORY="${GSH_GAME_DST_IMAGE_ACR_REPOSITORY}"
else
  GSH_GAME_DST_IMAGE_REPOSITORY="${GSH_GAME_DST_IMAGE_OFFICIAL_REPOSITORY}"
fi
PANEL_IMAGE="${PANEL_IMAGE_REPOSITORY}:${PANEL_IMAGE_TAG}" # 完整镜像引用（仓库:标签）。
PANEL_IMAGE_FALLBACK="${PANEL_IMAGE_OFFICIAL_REPOSITORY}:${PANEL_IMAGE_TAG}" # 回退镜像引用。
GSH_GAME_DST_IMAGE="${GSH_GAME_DST_IMAGE_REPOSITORY}:${PANEL_IMAGE_TAG}" # DST 镜像引用。
GSH_GAME_DST_IMAGE_FALLBACK="${GSH_GAME_DST_IMAGE_OFFICIAL_REPOSITORY}:${PANEL_IMAGE_TAG}" # DST 回退镜像引用。
# panel.env 中 SteamCMD 固定为 GHCR（面板内安装默认走 GHCR）；安装阶段可选预拉 ACR 同名镜像。
GSH_STEAMCMD_IMAGE="${GSH_STEAMCMD_IMAGE_OFFICIAL_REPOSITORY}:${PANEL_IMAGE_TAG}"
if [[ "${USE_ACR_MIRROR}" == "1" ]]; then
  INSTALL_STEAMCMD_PULL_IMAGE="${GSH_STEAMCMD_IMAGE_ACR_REPOSITORY}:${PANEL_IMAGE_TAG}"
else
  INSTALL_STEAMCMD_PULL_IMAGE="${GSH_STEAMCMD_IMAGE}"
fi
PANEL_ENV_FILE="${PANEL_INSTALL_DIR}/panel.env" # 运行时环境变量文件路径。
PANEL_COMPOSE_FILE="${PANEL_INSTALL_DIR}/docker-compose.yml" # Docker Compose 文件路径。
STATUS_FILE="${PANEL_LOG_DIR}/install.status" # 安装状态追踪文件路径。

DISTRO_ID="" # 发行版 ID（如 ubuntu/debian）。
DISTRO_CODENAME="" # 发行版代号（如 jammy/bookworm）。
PANEL_HOST="${PANEL_HOST:-}" # 面板访问主机地址（为空时自动探测）。
PANEL_ACCESS_URL="" # 最终拼装出的访问 URL。
ADMIN_USERNAME="${ADMIN_USERNAME:-superadmin}" # 初始管理员用户名。
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" # 初始管理员密码（为空时自动生成随机密码）。
EXPOSE_ADMIN_PASSWORD="${EXPOSE_ADMIN_PASSWORD:-0}" # 是否在安装摘要中明文输出管理员密码（1=输出，0=仅提示凭据文件）。
ROLLBACK_ENABLED=0 # 是否允许回滚（部署开始后置为 1）。
INSTALLER_REPO_POOL_INITIALIZED=0
declare -a INSTALLER_REPO_POOL=()
INSTALLER_CANONICAL_REPO_BASE="${INSTALLER_CANONICAL_REPO_BASE:-https://raw.githubusercontent.com/GameServerHub/game-server-hub/main}" # 用于安装资源完整性校验的权威源。
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

# 初始化安装资源镜像池（INSTALLER_REPO_RAW 优先，其次 INSTALLER_REPO_MIRRORS）。
init_installer_repo_pool() {
  local item
  local raw_sources

  if [[ "${INSTALLER_REPO_POOL_INITIALIZED}" -eq 1 ]]; then
    return
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

# 对镜像源下载的安装资源做完整性校验（与权威源同路径内容对比）。
verify_installer_asset_checksum() {
  local relative_path="$1"
  local downloaded_file="$2"
  local canonical_url canonical_tmp expected_sum actual_sum

  if [[ "${STRICT_INSTALLER_ASSET_CHECKSUM}" != "1" ]]; then
    return 0
  fi

  canonical_url="${INSTALLER_CANONICAL_REPO_BASE}/${relative_path}"
  canonical_tmp="$(mktemp)"

  if ! curl -fL --connect-timeout "${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS}" --max-time "${REPO_DOWNLOAD_TIMEOUT_SECONDS}" -o "${canonical_tmp}" "${canonical_url}" >/dev/null 2>&1; then
    rm -f "${canonical_tmp}"
    log_warn "Cannot fetch canonical asset for checksum verification: ${canonical_url}"
    return 1
  fi

  expected_sum="$(sha256sum "${canonical_tmp}" | awk '{print $1}')"
  actual_sum="$(sha256sum "${downloaded_file}" | awk '{print $1}')"
  rm -f "${canonical_tmp}"

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

# GHCR 连通性预检：优先探测 registry v2（200/401 视为可达），避免 HEAD / 405 误报。
check_ghcr_reachability() {
  local status_code

  status_code="$(curl -sS -o /dev/null -w '%{http_code}' --connect-timeout "${REPO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS}" --max-time "${GHCR_CHECK_TIMEOUT_SECONDS}" "https://ghcr.io/v2/")" || return 1
  case "${status_code}" in
    200|401|403|404|405|30[0-9])
      log_info "GHCR preflight check passed via https://ghcr.io/v2/ (HTTP ${status_code})."
      return 0
      ;;
    *)
      log_warn "GHCR preflight returned HTTP ${status_code} on https://ghcr.io/v2/."
      return 1
      ;;
  esac
}

# 校验系统是否提供 apt-get（仅支持 Debian/Ubuntu 体系）。
ensure_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
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

# Debian 优先使用国内镜像；失败则回退系统默认源。
prepare_apt_sources() {
  if [[ "${DISTRO_ID}" != "debian" || "${USE_CN_DEBIAN_MIRROR}" != "1" ]]; then
    run_with_retry "apt-get update" run_as_root apt-get update -y || abort "apt-get update failed."
    return
  fi

  backup_apt_sources
  apply_cn_debian_mirror

  if run_with_retry "apt-get update with CN mirror" run_as_root apt-get update -y; then
    log_info "Using CN Debian mirror: ${DEBIAN_MIRROR_URL}"
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
  apt_install ca-certificates curl gnupg lsb-release software-properties-common apt-transport-https jq
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
  curl -fsSL "${repo}/gpg" | run_as_root gpg --dearmor -o "${keyring}"
  run_as_root chmod a+r "${keyring}"
  run_as_root bash -c "echo 'deb [arch=${arch} signed-by=${keyring}] ${repo} ${DISTRO_CODENAME} stable' > /etc/apt/sources.list.d/docker.list"
}

# 安装 Docker（如未安装），并确保守护进程与 compose 插件可用。
install_docker() {
  if command -v docker >/dev/null 2>&1; then
    log_info "Docker already installed. Skipping package installation."
  else
    configure_docker_repo
    run_as_root apt-get update -y
    apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi

  log_info "Ensuring Docker service is enabled..."
  run_as_root systemctl enable --now docker
  run_as_root docker compose version >/dev/null 2>&1 || abort "docker compose plugin is required."
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

# 避免将面板绑定到已被占用的宿主机端口。
check_port_conflict() {
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
  --open-panel-port  Open panel TCP port (${PANEL_PORT}) via ufw/firewalld
  --open-dst-ports   Open default DST UDP ports (${DST_GAME_PORT}, ${DST_AUTH_PORT}, ${DST_MASTER_PORT}) via ufw/firewalld
  -h, --help         Show this help

Environment (optional):
  USE_ACR_MIRROR=1              Prefer ACR for panel/DST images (default 0 = GHCR)
  INSTALL_STEAMCMD_IMAGE=1      Pre-pull steamcmd-base during install (default 0; panel UI installs by default)
  ACR_REGISTRY / ACR_NAMESPACE  ACR endpoint when USE_ACR_MIRROR=1
  USE_CN_DEBIAN_MIRROR=1        Enable CN Debian mirror (default 0 for community-safe baseline)
  STRICT_INSTALLER_ASSET_CHECKSUM=0  Skip canonical checksum verification (not recommended)
  With INSTALL_STEAMCMD_IMAGE=1, SteamCMD follows USE_ACR_MIRROR (ACR first, fallback GHCR); panel.env always records GHCR steamcmd-base.
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
      ADMIN_PASSWORD="$(date +%s | sha256sum | cut -c1-18)"
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
    log_warn "Single instance + caves + many mods may OOM. Consider upgrading to 6–8 GiB or use preset: config/panel.env.presets/small.env"
    write_status "preflight" "warn" "Low host RAM ${total_mb} MB; see docs/MEMORY.md"
  elif [[ "${total_mb}" -lt "${HOST_MEMORY_TIER_SMALL_MAX_MB}" ]]; then
    log_warn "Host RAM tier is small (<5 GiB). Caves and heavy mod sets increase OOM risk. See docs/MEMORY.md."
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

  if [[ "${free_disk_mb}" -lt "${MIN_FREE_DISK_MB}" ]]; then
    abort "Insufficient disk space on /. Require >= ${MIN_FREE_DISK_MB} MB."
  fi

  if ! command -v docker >/dev/null 2>&1; then
    if ! curl -fsSI --max-time "${DOCKER_REPO_CHECK_TIMEOUT_SECONDS}" "https://download.docker.com" >/dev/null; then
      if [[ "${STRICT_DOCKER_REPO_CHECK}" == "1" ]]; then
        abort "Cannot reach https://download.docker.com within ${DOCKER_REPO_CHECK_TIMEOUT_SECONDS}s. Please check outbound network."
      fi
      log_warn "Cannot reach https://download.docker.com within ${DOCKER_REPO_CHECK_TIMEOUT_SECONDS}s during preflight. Continue because strict check is disabled."
    fi
  else
    log_info "Docker already installed, skipping download.docker.com preflight check."
  fi

  if ! check_ghcr_reachability; then
    if [[ "${STRICT_GHCR_CHECK}" == "1" ]]; then
      abort "Cannot reach GHCR registry endpoint https://ghcr.io/v2/ within ${GHCR_CHECK_TIMEOUT_SECONDS}s. Please check outbound network."
    fi
    log_warn "Cannot reach GHCR registry endpoint https://ghcr.io/v2/ within ${GHCR_CHECK_TIMEOUT_SECONDS}s during preflight. Continue and rely on docker pull retries."
  fi

  write_status "preflight" "ok" "Host checks passed"
}

# 生成运行目录、环境变量文件与 compose 配置。
prepare_panel_files() {
  local script_dir repo_compose compose_source bind_compose
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_compose="${script_dir}/../docker-compose.yml"
  compose_source="${COMPOSE_SOURCE:-${repo_compose}}"

  write_status "deploy" "start" "Preparing runtime files"
  run_as_root mkdir -p "${PANEL_INSTALL_DIR}" "${PANEL_DATA_DIR}" "${PANEL_LOG_DIR}" "${PANEL_INSTANCES_DIR}"
  sync_panel_env_presets
  run_as_root chmod 700 "${PANEL_INSTALL_DIR}"
  run_as_root chmod 750 "${PANEL_DATA_DIR}" "${PANEL_LOG_DIR}" "${PANEL_INSTANCES_DIR}"

  detect_host_ip
  PANEL_ACCESS_URL="${PANEL_PROTOCOL}://${PANEL_HOST}:${PANEL_PORT}"
  generate_admin_credentials

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

  run_as_root bash -c "cat > \"${PANEL_ENV_FILE}\" <<EOF
PANEL_PORT=${PANEL_PORT}
PANEL_DATA_DIR=${PANEL_DATA_DIR}
PANEL_LOG_DIR=${PANEL_LOG_DIR}
PANEL_INSTANCES_DIR=${PANEL_INSTANCES_DIR}
PANEL_BACKUPS_DIR=${PANEL_BACKUPS_DIR}
PANEL_IMAGE=${PANEL_IMAGE}
PANEL_PUBLIC_URL=${PANEL_ACCESS_URL}
ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
FORCE_PASSWORD_CHANGE=1
GSH_EDITION=community
DOCKER_HOST=unix:///var/run/docker.sock
GSH_GAME_DST_IMAGE=${GSH_GAME_DST_IMAGE}
GSH_STEAMCMD_IMAGE=${GSH_STEAMCMD_IMAGE}
# 国内服务器建议取消注释以下 SteamCMD 优化项：
# GSH_STEAMCMD_DOWNLOAD_REGION=cn
# GSH_STEAMCMD_INSTALL_MAX_ATTEMPTS=8
# GSH_STEAMCMD_INSTALL_RETRY_DELAYS_MS=5000,10000,15000,20000,25000,30000,35000
# STEAMCMD_USERNAME=
# STEAMCMD_PASSWORD=
GSH_STACK_DIR=${PANEL_INSTALL_DIR}
GSH_COMPOSE_FILES=docker-compose.yml:docker-compose.bind.yml
GSH_GITHUB_REPO=GameServerHub/game-server-hub
TZ=UTC
EOF"
  run_as_root chmod 600 "${PANEL_ENV_FILE}"

  local host_mem_total_mb preset_name
  host_mem_total_mb="$(read_host_mem_total_mb)"
  preset_name="$(resolve_panel_env_preset_name "${host_mem_total_mb}")"
  append_panel_env_preset "${preset_name}"
}

# 仅在部署阶段开始后启用容器栈回滚。
rollback_install() {
  if [[ "${ROLLBACK_ENABLED}" -ne 1 ]]; then
    return
  fi

  write_status "rollback" "start" "Rolling back failed deployment"
  log_warn "Deployment failed, rolling back container stack..."
  run_as_root docker compose --env-file "${PANEL_ENV_FILE}" -f "${PANEL_COMPOSE_FILE}" -f "${PANEL_BIND_COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true
  write_status "rollback" "ok" "Rollback finished"
}

# 安装阶段可选预拉 SteamCMD（默认不拉，由面板内触发）；USE_ACR_MIRROR=1 时优先 ACR，失败回退 GHCR。
pull_install_steamcmd_image() {
  if [[ "${INSTALL_STEAMCMD_IMAGE}" != "1" ]]; then
    return 0
  fi

  if run_with_retry "docker pull ${INSTALL_STEAMCMD_PULL_IMAGE}" run_as_root docker pull "${INSTALL_STEAMCMD_PULL_IMAGE}"; then
    return 0
  fi

  if [[ "${USE_ACR_MIRROR}" == "1" && "${INSTALL_STEAMCMD_PULL_IMAGE}" != "${GSH_STEAMCMD_IMAGE}" ]]; then
    log_warn "ACR SteamCMD pull failed, falling back to GHCR steamcmd-base..."
    run_with_retry "docker pull ${GSH_STEAMCMD_IMAGE}" run_as_root docker pull "${GSH_STEAMCMD_IMAGE}" || return 1
    return 0
  fi

  return 1
}

# 拉取运行时镜像（面板 + DST；SteamCMD 仅 INSTALL_STEAMCMD_IMAGE=1 时预拉）。
pull_runtime_images() {
  run_with_retry "docker pull ${PANEL_IMAGE}" run_as_root docker pull "${PANEL_IMAGE}" || return 1
  run_with_retry "docker pull ${GSH_GAME_DST_IMAGE}" run_as_root docker pull "${GSH_GAME_DST_IMAGE}" || return 1
  pull_install_steamcmd_image || return 1
}

# 切换为官方 GHCR 镜像并同步更新 panel.env，供后续 compose 使用。
switch_to_official_images() {
  PANEL_IMAGE_REPOSITORY="${PANEL_IMAGE_OFFICIAL_REPOSITORY}"
  GSH_GAME_DST_IMAGE_REPOSITORY="${GSH_GAME_DST_IMAGE_OFFICIAL_REPOSITORY}"
  PANEL_IMAGE="${PANEL_IMAGE_FALLBACK}"
  GSH_GAME_DST_IMAGE="${GSH_GAME_DST_IMAGE_FALLBACK}"
  INSTALL_STEAMCMD_PULL_IMAGE="${GSH_STEAMCMD_IMAGE}"

  if run_as_root test -f "${PANEL_ENV_FILE}"; then
    run_as_root sed -i "s|^PANEL_IMAGE=.*$|PANEL_IMAGE=${PANEL_IMAGE}|g" "${PANEL_ENV_FILE}"
    run_as_root sed -i "s|^GSH_GAME_DST_IMAGE=.*$|GSH_GAME_DST_IMAGE=${GSH_GAME_DST_IMAGE}|g" "${PANEL_ENV_FILE}"
  fi
}

# 拉取镜像并启动服务栈；通过重试应对临时网络抖动。
deploy_panel() {
  write_status "deploy" "start" "Pulling panel image ${PANEL_IMAGE}"
  if ! pull_runtime_images; then
    if [[ "${USE_ACR_MIRROR}" == "1" ]]; then
      log_warn "ACR mirror pull failed, falling back to official ghcr.io..."
      switch_to_official_images
      write_status "deploy" "start" "Retrying image pull via official ghcr.io"
      pull_runtime_images || abort "Image pull failed on both ACR mirror and official ghcr.io."
    else
      abort "Image pull failed. Please check outbound network or image repository settings."
    fi
  fi
  write_status "deploy" "ok" "Image pull completed"

  write_status "deploy" "start" "Starting panel stack"
  ROLLBACK_ENABLED=1
  run_with_retry "docker compose up" run_as_root docker compose --env-file "${PANEL_ENV_FILE}" -f "${PANEL_COMPOSE_FILE}" -f "${PANEL_BIND_COMPOSE_FILE}" up -d
  write_status "deploy" "ok" "Panel stack started"
}

# 输出最终访问信息与安全提醒。
print_summary() {
  write_status "install" "ok" "Installation completed"
  log_info "Installation completed."
  log_info "Panel image: ${PANEL_IMAGE}"
  log_info "DST image: ${GSH_GAME_DST_IMAGE}"
  log_info "SteamCMD image (panel.env): ${GSH_STEAMCMD_IMAGE}"
  if [[ "${INSTALL_STEAMCMD_IMAGE}" == "1" ]]; then
    log_info "SteamCMD pre-pull during install: enabled"
  else
    log_info "SteamCMD pre-pull during install: disabled (pull from panel UI)"
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

  # 任何未处理错误都会触发 rollback_install。
  trap 'rollback_install' ERR

  log_info "Running ${SCRIPT_NAME}..."
  write_status "install" "start" "Installer started"

  detect_distro
  ensure_apt

  write_status "deps" "start" "Installing base dependencies"
  install_base_packages
  install_docker
  add_user_to_docker_group
  write_status "deps" "ok" "Dependencies installed (Docker only, no host Node/SteamCMD)"

  preflight_checks

  write_status "network" "start" "Checking panel port and firewall"
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

  prepare_panel_files
  deploy_panel

  print_summary
}

main "$@"
