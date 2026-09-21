import type { MapDto, MapLegendEntryDto } from '@/api/modules/map'

/**
 * 地图面板的展示逻辑。
 *
 * 抽成纯函数是因为它们最容易被写错、又最难在界面上发现：时间文案错了没人报 bug，
 * 尺寸少写一个单位也没人会发现——但用户会看到"0 分钟前"这种明显不对的字样。
 * 放在这里就能用单测逐个钉死，而组件只负责把结果铺到模板上。
 */

/** 判定"何时该继续轮询"：只有生成中才轮询，到终态就停表，不给服务器添无谓请求 */
export function shouldPoll(status: MapDto['status'] | undefined): boolean {
  return status === 'generating'
}

/** 出图时间文案；时间缺失或非法时返回空串（界面据此少显示一行，而不是显示 Invalid Date） */
export function formatExportedAt(value: string | null | undefined): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}

/**
 * 相对时间文案。
 *
 * 注意 `ageSeconds` 为 **0** 时要说"刚刚"，不能说"0 秒前"——刚生成完就是 0 秒，
 * 而"0 秒前"读起来像坏了。
 */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return ''
  }
  if (seconds < 10) {
    return '刚刚'
  }
  if (seconds < 60) {
    return `${Math.floor(seconds)} 秒前`
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} 分钟前`
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)} 小时前`
  }
  return `${Math.floor(seconds / 86400)} 天前`
}

/** 地图尺寸文案；缺一不可，避免出现 "425 × " 这种半截字样 */
export function formatMapSize(width: number | null | undefined, height: number | null | undefined): string {
  if (!width || !height) {
    return ''
  }
  return `${width} × ${height}`
}

/** 已探索占比文案；0 是合法值（世界刚生成），必须能显示出来而不是被当成"空" */
export function formatFilledRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) {
    return ''
  }
  return `${Math.round(ratio * 100)}%`
}

/** 状态标签的文案与配色（组件只负责渲染，不负责判断） */
export function describeStatus(status: MapDto['status'] | undefined): {
  text: string
  tone: 'success' | 'info' | 'error' | null
} {
  switch (status) {
    case 'ready':
      return { text: '已生成', tone: 'success' }
    case 'generating':
      return { text: '生成中', tone: 'info' }
    case 'failed':
      return { text: '生成失败', tone: 'error' }
    default:
      return { text: '', tone: null }
  }
}

/** 主按钮文案：已有图时是"重新生成"，没有时是"生成地图" */
export function describePrimaryAction(hasImage: boolean): string {
  return hasImage ? '重新生成' : '生成地图'
}

/**
 * 图例拆成两组。
 *
 * 地形与地标不能混在一个列表里：前者每项都有占比、"谁大谁小"是重点；后者只有"有几处"，
 * 混排会让占比那一列出现一串空白，读起来像数据缺失。
 */
export function splitLegend(entries: MapLegendEntryDto[] | null | undefined): {
  terrain: MapLegendEntryDto[]
  landmarks: MapLegendEntryDto[]
} {
  const list = entries ?? []
  return {
    terrain: list.filter(entry => entry.kind === 'terrain'),
    landmarks: list.filter(entry => entry.kind === 'landmark'),
  }
}

/**
 * 图例里的占比文案。
 *
 * 地标项的 `ratio` 是 null（地标没有"占全图比例"这回事），必须返回空串而不是 "0%"——
 * "0%" 会被读成"这类地块占 0%"，与"这项不适用"完全是两回事。
 */
export function formatLegendRatio(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio) || ratio < 0) {
    return ''
  }
  const percent = ratio * 100
  if (percent === 0) {
    return '0%'
  }
  // 极小块（真机上有只占 0.007% 的地块）显示成 0.0% 会被当成没有，明确写成"小于 0.1%"
  if (percent < 0.1) {
    return '<0.1%'
  }
  return `${percent.toFixed(1)}%`
}

/** 地标总数文案；没有地标时不显示这一项，而不是显示"地标：0 处" */
export function formatLandmarkSummary(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count) || count <= 0) {
    return ''
  }
  return `地标：${Math.floor(count)} 处`
}

/**
 * 图例色块的形状样式。
 *
 * 必须与图上画的一致（图上：通道圆点、建筑方块、巢穴菱形，地形是方块）：
 * 19 类地标的颜色不可能两两都分得开，形状是第二条线索，图例对不上形状就白搭了。
 * 地形项的 `shape` 是 null，按方块渲染。
 */
export function legendShapeClass(shape: MapLegendEntryDto['shape']): string {
  switch (shape) {
    case 'circle':
      return 'rounded-full'
    case 'diamond':
      return 'rotate-45 rounded-[2px]'
    default:
      return 'rounded-sm'
  }
}

/** 地标项的数量文案 */
export function formatLandmarkCount(count: number): string {
  return `${count} 处`
}
