import type { ModUpdateCheckSummary } from '@/api/modules/mod'

/**
 * 「检查更新」结束后的提示决策。
 *
 * 这里唯一不能妥协的是：**无法判断的 Mod 绝不能和「已是最新」混在同一句话里**。
 * 面板的版本结论只在两侧都有凭据时才成立，剩下的都是「未检查」；把两者一起说成
 * 「当前 Mod 都是最新版本」，用户就会带着一台装着旧 Mod 的服务器去开服，然后被
 * 客户端的版本校验挡在门外（「服务器启用了一些旧版本的 Mod」）。
 */

export type ModUpdateCheckNoticeTone = 'success' | 'info' | 'warning'

export interface ModUpdateCheckNotice {
  /** notification 更醒目：确实发现新版本、需要用户接着操作时用它 */
  kind: 'notification' | 'message'
  tone: ModUpdateCheckNoticeTone
  title: string | null
  content: string
}

export interface ModUpdateCheckNoticeInput {
  summary: ModUpdateCheckSummary
  upstreamOk: boolean
  message: string | null
}

/**
 * 工坊接口不通时的自助出口。界面文案不写部署细节（环境变量、配置文件），
 * 只说清「为什么查不到」与「去哪儿找办法」，具体配置在安装指南里。
 */
export const STEAM_WEBAPI_BASE_HINT
  = '若长期取不到创意工坊信息，通常是服务器网络连不上 Steam 接口；可按安装指南配置一个可用的接口地址后重建面板。'

/** 无法判断版本的可行出口：面板已经为这类行准备了「重新下载」按钮 */
const REDOWNLOAD_HINT = '本机缺少这些 Mod 的版本记录，或工坊信息没取到；可对这几行点「重新下载」重新入账。'

function appendUpstreamNotice(content: string, input: ModUpdateCheckNoticeInput): string {
  if (input.upstreamOk) {
    return content
  }
  const reason = input.message?.trim() || '部分 Mod 未能从创意工坊取到信息'
  return `${content} 工坊侧：${reason} ${STEAM_WEBAPI_BASE_HINT}`
}

export function resolveModUpdateCheckNotice(input: ModUpdateCheckNoticeInput): ModUpdateCheckNotice {
  const { total, outdated, upToDate, unknown } = input.summary
  if (total === 0) {
    return { kind: 'message', tone: 'info', title: null, content: '该实例还没有已订阅的 Mod。' }
  }
  if (outdated > 0) {
    const tail = unknown > 0 ? `另有 ${unknown} 个 Mod 无法判断版本。` : ''
    return {
      kind: 'notification',
      tone: 'info',
      title: `发现 ${outdated} 个 Mod 有新版本`,
      content: appendUpstreamNotice(
        `点列表里的「更新」或工具条的「全部更新」，更新完成后重启实例生效。${tail}`,
        input,
      ),
    }
  }
  if (unknown === 0) {
    return {
      kind: 'message',
      tone: 'success',
      title: null,
      content: `当前 ${upToDate} 个 Mod 都是创意工坊上的最新版本。`,
    }
  }
  const lead = upToDate === 0
    ? `有 ${unknown} 个 Mod 无法判断版本`
    : `${upToDate} 个 Mod 已是最新，另有 ${unknown} 个无法判断版本`
  return {
    kind: 'message',
    tone: 'warning',
    title: null,
    content: appendUpstreamNotice(`${lead}：${REDOWNLOAD_HINT}`, input),
  }
}
