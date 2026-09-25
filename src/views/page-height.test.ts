import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

/**
 * 布局内的页面不能靠绝对定位去「铺满内容区」。
 *
 * 主内容区（`layouts/index.vue` 的 `.main`）的高度由页面内容决定，而绝对定位的根元素
 * 不贡献高度：父级算出来是 0，再被 `.main` 的 `overflow: hidden` 整块裁掉，页面就只剩底色。
 * 0.9.0 的「主页一片空白」（Mod 市场、Mod 详情同时中招）正是这么来的——这三页此前
 * 分别写着 `size-full absolute` 与 `absolute inset-0`，改布局时谁也没看出它们靠父级高度活着。
 *
 * 需要整屏高度的页面用 layout 提供的 `h-[var(--g-main-content-height)]`。
 * 这条断言只能钉住「根元素」这一层，但回归就是从这一层漏出去的。
 */

const viewsRoot = fileURLToPath(new URL('.', import.meta.url))

/** 不经过 layout 的顶层页面，自己管高度，不适用这条约定 */
const LAYOUT_LESS_PAGES = new Set(['login.vue', 'force-change-password.vue', '[...all].vue'])

/** 页面自己拆出去的组件（弹窗、覆盖层等）允许绝对定位，它们不是页面根元素 */
const SKIPPED_DIRS = new Set(['components'])

function collectPages(dir: string, result: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) {
        collectPages(join(dir, entry.name), result)
      }
      continue
    }
    if (entry.name.endsWith('.vue')) {
      result.push(join(dir, entry.name))
    }
  }
  return result
}

/** 取 `<template>` 里第一个标签的属性文本（跳过其上的模板注释） */
function rootTagAttrs(source: string): string | null {
  const templateStart = source.indexOf('<template>')
  if (templateStart === -1) {
    return null
  }
  const rest = source.slice(templateStart).replace(/<!--[\s\S]*?-->/g, '')
  const matched = rest.match(/^\s*<template>\s*<[A-Za-z][\w.-]*((?:"[^"]*"|'[^']*'|[^>])*)>/)
  return matched ? matched[1] : null
}

describe('布局内页面的高度约定', () => {
  it('页面根元素不用绝对定位铺满内容区——那样父级高度是 0，整页会被裁掉', () => {
    const offenders: string[] = []

    for (const file of collectPages(viewsRoot)) {
      const name = relative(viewsRoot, file).replace(/\\/g, '/')
      if (LAYOUT_LESS_PAGES.has(name)) {
        continue
      }
      const attrs = rootTagAttrs(readFileSync(file, 'utf8'))
      if (!attrs) {
        continue
      }
      const classAttr = attrs.match(/class="([^"]*)"/)?.[1] ?? attrs.match(/class='([^']*)'/)?.[1] ?? ''
      if (/\babsolute\b/.test(classAttr) || /\b(inset-0|size-full)\b/.test(classAttr)) {
        offenders.push(`${name} → ${classAttr.trim()}`)
      }
    }

    assert.deepEqual(
      offenders,
      [],
      `这些页面的根元素用绝对定位铺满内容区，高度会被算成 0：\n  ${offenders.join('\n  ')}\n`
      + '需要整屏高度请用 h-[var(--g-main-content-height)]，否则让根元素回到普通文档流。',
    )
  })
})
