#!/usr/bin/env node
/**
 * 整页转场护栏：`<KeepAlive>` 不得与 `mode="out-in"` / `mode="in-out"` 写在同一处。
 *
 * 背景：这个组合会永久白屏，且只有整页刷新能恢复——实测必现，不是概率问题。
 * - out-in 把「等上一页离场」记在 BaseTransition 的 `state.isLeaving` 上，而它的 render 第一步就是
 *   `if (state.isLeaving) return emptyPlaceholder(child)`，排在所有其他判断之前。一旦为真，
 *   RouterView 区域从此只渲染一个空占位符，后续任何导航都不会再 patch 页面组件。
 * - 清除它的唯一出口是 `leavingHooks.afterLeave`，而 `afterLeave` 全库唯一的调用点在 renderer 的
 *   `remove()` 里，也就是 DOM 元素真的被移除的那一刻。
 * - 被 KeepAlive 缓存的页面切走时走的是 `deactivate()`：DOM 只是被 move 进一个隐藏容器，
 *   没有 `hostRemove`，也就永远到不了 `remove()`——开关就此永久卡住。
 * - in-out 不置位 `state.isLeaving`，但它同样把「旧节点何时从 DOM 移除」交给 `remove()` 里的
 *   `delayLeave`，keepAlive 页面切走时那段时序也走不到，离场动画会半失效——一并禁掉。
 * - `menu-routes.ts` 里有 5 个页面开了 `keepAlive`，所以本仓库不存在 out-in / in-out 的可用场景。
 *
 * 维护规则：注释里提到这些写法不算违规——本脚本先剥离 HTML 注释再匹配，所以可以放心在
 * 注释里解释为什么不能用它们。判定范围是整个文件（模板与脚本都算），避免只写在 `<script>`
 * 里的 `<Transition>` 渲染函数漏网。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scanRoot = path.join(repoRoot, 'src')

const KEEP_ALIVE = /<KeepAlive\b/
const EXCLUSIVE_MODE = /\bmode\s*=\s*["'](?:out-in|in-out)["']/g

/** 把 HTML 注释替换成等量空白（保留换行）：既不误伤注释里的示例，也不打乱行号 */
function blankHtmlComments(source) {
  return source.replace(/<!--[\s\S]*?-->/g, match => match.replace(/[^\n]/g, ' '))
}

function walk(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') {
      continue
    }
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full))
      continue
    }
    if (entry.name.endsWith('.vue')) {
      out.push(full)
    }
  }
  return out
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length
}

const findings = []

for (const file of walk(scanRoot)) {
  const source = blankHtmlComments(fs.readFileSync(file, 'utf8'))
  if (!KEEP_ALIVE.test(source)) {
    continue
  }
  const lines = source.split('\n')
  for (const match of source.matchAll(EXCLUSIVE_MODE)) {
    const line = lineOf(source, match.index)
    findings.push({
      file: path.relative(repoRoot, file).replaceAll('\\', '/'),
      line,
      text: (lines[line - 1] ?? '').trim().slice(0, 100),
    })
  }
}

if (findings.length > 0) {
  console.error('检测到 <KeepAlive> 与互斥转场模式出现在同一处：切页后主内容区会永久空白，且只有刷新能恢复。')
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.text}`)
  }
  console.error('\n请改成默认模式（不写 mode）：离场与入场各自独立触发、互不阻塞，不会因为连续切换被锁死。')
  console.error('完整原因见 src/layouts/index.vue 中 RouterView 上方的注释。')
  process.exit(1)
}

console.log('页面转场检查通过：KeepAlive 未与 out-in / in-out 组合。')
