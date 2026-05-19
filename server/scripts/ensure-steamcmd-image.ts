/**
 * dev:compose 前置：若本地无 SteamCMD 镜像则 pull（幂等）
 */
import { execFileSync } from 'node:child_process'

const image = process.env.GSH_STEAMCMD_IMAGE?.trim() || 'cm2network/steamcmd:root-bookworm'
const MAX_ATTEMPTS = 3

function imageExists(): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

function pullOnce() {
  execFileSync('docker', ['pull', image], { stdio: 'inherit' })
}

function main() {
  if (imageExists()) {
    console.log(`[ensure-steamcmd-image] 已存在: ${image}`)
    return
  }
  console.log(`[ensure-steamcmd-image] 拉取: ${image}`)
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      pullOnce()
      console.log(`[ensure-steamcmd-image] 完成: ${image}`)
      return
    }
    catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[ensure-steamcmd-image] 第 ${attempt} 次失败，重试…`)
      }
    }
  }
  console.error(`[ensure-steamcmd-image] 拉取失败: ${image}`)
  throw lastError
}

main()
