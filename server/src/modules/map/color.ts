/**
 * 颜色小工具。
 *
 * 单独成文件，是为了让「只有数据的色板目录」（`terrain-catalog.ts`）与「只有绘制的渲染器」
 * （`terrain-render.ts`）都不必为对方负责：目录要能查到颜色，渲染要能把颜色调暗、转成
 * CSS 用的十六进制，两者都只需要这几个纯函数。
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** 线性混合：`t=0` 取 `a`，`t=1` 取 `b`；`t` 会被钳到 0–1 */
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const ratio = Math.min(1, Math.max(0, t))
  return {
    r: Math.round(a.r + (b.r - a.r) * ratio),
    g: Math.round(a.g + (b.g - a.g) * ratio),
    b: Math.round(a.b + (b.b - a.b) * ratio),
  }
}

/** 调暗：`amount=0` 原色，`amount=1` 全黑 */
export function darken(color: Rgb, amount: number): Rgb {
  return mix(color, { r: 0, g: 0, b: 0 }, amount)
}

/** 转 `#rrggbb`；图例要把颜色直接交给 CSS，必须带前导零 */
export function toHexColor(color: Rgb): string {
  const part = (value: number) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

/**
 * HSL → RGB。
 *
 * 只有"给没收录的地块派生一个颜色"这一处用它，所以不做色域映射之类的高级处理，
 * 按标准公式算就行。
 */
function hslToRgb(hue: number, saturation: number, lightness: number): Rgb {
  const c = (1 - Math.abs(2 * lightness - 1)) * saturation
  const h = ((hue % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((h % 2) - 1))
  const [r1, g1, b1] = h < 1
    ? [c, x, 0]
    : h < 2
      ? [x, c, 0]
      : h < 3
        ? [0, c, x]
        : h < 4
          ? [0, x, c]
          : h < 5
            ? [x, 0, c]
            : [c, 0, x]
  const m = lightness - c / 2
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  }
}

/**
 * 未收录地块的派生色。
 *
 * 为什么不是一律洋红：真机上遇到没收录的地块时（游戏新增了地块，面板还没跟上），
 * 洋红会把地图画得很难看，而用户真正需要的是"看得懂的地图 + 一条该补配色的提示"。
 * 这里按 ID 散出色相（黄金角），保证不同 ID 分得开、同一个 ID 每次都一样，
 * 至于"这个地块还没收录"由**图例**去说，而不是靠把地图涂花来说。
 */
export function deriveTileColor(id: number): Rgb {
  const hue = (Math.abs(id) * 137.508) % 360
  return hslToRgb(hue, 0.5, 0.6)
}
