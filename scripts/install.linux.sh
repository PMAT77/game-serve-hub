#!/usr/bin/env bash

set -Eeuo pipefail

# -----------------------------------------------------------------------------
# 安装脚本默认参数与运行时路径
# -----------------------------------------------------------------------------
SCRIPT_NAME="$(basename "$0")" # 当前脚本名称（用于日志展示）。
INSTALLER_REPO_RAW="${INSTALLER_REPO_RAW:-https://raw.githubusercontent.com/GameServerHub/game-server-hub/main}"
MIN_FREE_DISK_MB=4096 # 最小可用磁盘空间阈值（MB）。
RETRY_MAX=3 # 可重试操作的最大重试次数。
RETRY_DELAY_SECONDS=3 # 每次重试之间的等待秒数。
OPEN_DST_PORTS=0 # 是否在安装时开放 DST 默认 UDP 游戏端口。

# DST 默认 UDP 端口（与 cluster.ini / server.ini 默认值一致）
DST_GAME_PORT="${DST_GAME_PORT:-10999}"
DST_AUTH_PORT="${DST_AUTH_PORT:-8766}"
DST_MASTER_PORT="${DST_MASTER_PORT:-12346}"

PANEL_NAME="${PANEL_NAME:-game-server-hub}" # 面板逻辑名称（可被环境变量覆盖）。
PANEL_PORT="${PANEL_PORT:-80}" # 面板对外暴露端口（默认使用常见放行端口）。
PANEL_PROTOCOL="${PANEL_PROTOCOL:-http}" # 访问协议（用于生成访问 URL）。
PANEL_IMAGE_REPOSITORY="${PANEL_IMAGE_REPOSITORY:-ghcr.io/gameserverhub/game-server-hub}" # 容器镜像仓库地址。
PANEL_INSTANCES_DIR="${PANEL_INSTANCES_DIR:-${PANEL_DATA_DIR}/instances}" # 游戏实例数据目录。
PANEL_BACKUPS_DIR="${PANEL_BACKUPS_DIR:-${PANEL_DATA_DIR}/backups}" # 备份目录。
PANEL_BIND_COMPOSE_FILE="${PANEL_INSTALL_DIR}/docker-compose.bind.yml"
PANEL_IMAGE_TAG="${PANEL_IMAGE_TAG:-latest}" # 容器镜像标签。
PANEL_IMAGE="${PANEL_IMAGE_REPOSITORY}:${PANEL_IMAGE_TAG}" # 完整镜像引用（仓库:标签）。
PANEL_INSTALL_DIR="${PANEL_INSTALL_DIR:-/opt/game-server-hub}" # 安装目录（放置 env/compose）。
PANEL_DATA_DIR="${PANEL_DATA_DIR:-/var/lib/game-server-hub}" # 面板持久化数据目录。
PANEL_LOG_DIR="${PANEL_LOG_DIR:-/var/log/game-server-hub}" # 面板日志与安装状态目录。
PANEL_ENV_FILE="${PANEL_INSTALL_DIR}/panel.env" # 运行时环境变量文件路径。
PANEL_COMPOSE_FILE="${PANEL_INSTALL_DIR}/docker-compose.yml" # Docker Compose 文件路径。
STATUS_FILE="${PANEL_LOG_DIR}/install.status" # 安装状态追踪文件路径。

DISTRO_ID="" # 发行版 ID（如 ubuntu/debian）。
DISTRO_CODENAME="" # 发行版代号（如 jammy/bookworm）。
PANEL_HOST="${PANEL_HOST:-}" # 面板访问主机地址（为空时自动探测）。
PANEL_ACCESS_URL="" # 最终拼装出的访问 URL。
ADMIN_USERNAME="${ADMIN_USERNAME:-superadmin}" # 初始管理员用户名。
ADMIN_PASSWORD="${ADMIN_PASSWORD:-123456}" # 初始管理员密码（为空时使用预设值）。
ROLLBACK_ENABLED=0 # 是否允许回滚（部署开始后置为 1）。

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
  local stage status message
  stage="$1"
  status="$2"
  message="$3"
  run_as_root mkdir -p "${PANEL_LOG_DIR}"
  run_as_root bash -c "printf '%s [%s] [%s] %s\n' \"$(date '+%Y-%m-%d %H:%M:%S')\" \"${stage}\" \"${status}\" \"${message}\" | tee -a \"${STATUS_FILE}\" >/dev/null"
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

# 安装后续步骤所需的基础依赖。
install_base_packages() {
  log_info "Installing base packages..."
  run_as_root apt-get update -y
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
  fi
}

# 优先使用现有防火墙工具开放端口；若不可用则给出手动提示。
open_firewall_port() {
  local rule_desc
  rule_desc="tcp/${PANEL_PORT}"

  if command -v ufw >/dev/null 2>&1; then
    log_info "Configuring firewall via ufw: allow ${rule_desc}"
    run_as_root ufw allow "${PANEL_PORT}/tcp" >/dev/null || true
    log_warn "Firewall note: panel port ${PANEL_PORT} is exposed externally. Restrict source IPs if needed."
    return
  fi

  if command -v firewall-cmd >/dev/null 2>&1; then
    log_info "Configuring firewall via firewalld: allow ${rule_desc}"
    run_as_root firewall-cmd --add-port="${PANEL_PORT}/tcp" --permanent >/dev/null || true
    run_as_root firewall-cmd --reload >/dev/null || true
    log_warn "Firewall note: panel port ${PANEL_PORT} is exposed externally. Restrict source IPs if needed."
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
  --open-dst-ports   Open default DST UDP ports (${DST_GAME_PORT}, ${DST_AUTH_PORT}, ${DST_MASTER_PORT}) via ufw/firewalld
  -h, --help         Show this help
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

# 在生成配置与部署前，先校验主机前置条件。
preflight_checks() {
  local arch free_disk_mb
  arch="$(uname -m)"
  free_disk_mb="$(df -Pm / | awk 'NR == 2 { print $4 }')"

  write_status "preflight" "start" "Collecting host information"
  log_info "OS: ${DISTRO_ID} (${DISTRO_CODENAME})"
  log_info "Architecture: ${arch}"
  log_info "Free disk on /: ${free_disk_mb} MB"

  if [[ "${arch}" != "x86_64" && "${arch}" != "aarch64" ]]; then
    abort "Unsupported architecture ${arch}. Only x86_64/aarch64 are supported."
  fi

  if [[ "${free_disk_mb}" -lt "${MIN_FREE_DISK_MB}" ]]; then
    abort "Insufficient disk space on /. Require >= ${MIN_FREE_DISK_MB} MB."
  fi

  if ! curl -fsSI --max-time 8 "https://download.docker.com" >/dev/null; then
    abort "Cannot reach https://download.docker.com. Please check outbound network."
  fi

  if ! curl -fsSI --max-time 8 "https://ghcr.io" >/dev/null; then
    abort "Cannot reach https://ghcr.io. Please check outbound network."
  fi

  write_status "preflight" "ok" "Host checks passed"
}

# 生成运行目录、环境变量文件与 compose 配置。
prepare_panel_files() {
  local script_dir repo_compose compose_source
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  repo_compose="${script_dir}/../docker-compose.yml"
  compose_source="${COMPOSE_SOURCE:-${repo_compose}}"

  write_status "deploy" "start" "Preparing runtime files"
  run_as_root mkdir -p "${PANEL_INSTALL_DIR}" "${PANEL_DATA_DIR}" "${PANEL_LOG_DIR}" "${PANEL_INSTANCES_DIR}"
  run_as_root chmod 700 "${PANEL_INSTALL_DIR}"
  run_as_root chmod 750 "${PANEL_DATA_DIR}" "${PANEL_LOG_DIR}" "${PANEL_INSTANCES_DIR}"

  detect_host_ip
  PANEL_ACCESS_URL="${PANEL_PROTOCOL}://${PANEL_HOST}:${PANEL_PORT}"
  generate_admin_credentials

  if [[ -f "${compose_source}" ]]; then
    run_as_root cp "${compose_source}" "${PANEL_COMPOSE_FILE}"
  else
    log_info "Local compose not found, downloading from ${INSTALLER_REPO_RAW}/docker-compose.yml"
    curl -fsSL "${INSTALLER_REPO_RAW}/docker-compose.yml" | run_as_root tee "${PANEL_COMPOSE_FILE}" >/dev/null
  fi
  bind_compose="${script_dir}/../docker-compose.bind.yml"
  if [[ -f "${bind_compose}" ]]; then
    run_as_root cp "${bind_compose}" "${PANEL_BIND_COMPOSE_FILE}"
  else
    curl -fsSL "${INSTALLER_REPO_RAW}/docker-compose.bind.yml" | run_as_root tee "${PANEL_BIND_COMPOSE_FILE}" >/dev/null
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
GSH_GAME_DST_IMAGE=ghcr.io/gameserverhub/game-server-hub-dst:${PANEL_IMAGE_TAG}
GSH_STEAMCMD_IMAGE=cm2network/steamcmd:steam-bookworm
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

# 拉取镜像并启动服务栈；通过重试应对临时网络抖动。
deploy_panel() {
  write_status "deploy" "start" "Pulling panel image ${PANEL_IMAGE}"
  run_with_retry "docker pull ${PANEL_IMAGE}" run_as_root docker pull "${PANEL_IMAGE}"
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
  log_info "Panel URL: ${PANEL_ACCESS_URL}"
  log_info "Admin username: ${ADMIN_USERNAME}"
  log_info "Admin password: ${ADMIN_PASSWORD}"
  log_warn "Security note: change the admin password immediately after first login."
  log_info "First-login force password change flag: FORCE_PASSWORD_CHANGE=1"
  log_info "Install status file: ${STATUS_FILE}"
}

# 主流程：安装依赖 -> 预检 -> 网络处理 -> 生成配置 -> 部署。
main() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
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
  open_firewall_port
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
