import { addCollection } from '@iconify/vue'

// 注意：不要在此静态 import ./data.json（425KB 图标名清单）。
// 该文件由 scripts/generate.icons.ts 生成，仅供工具链与未来的图标选择器
// 按 await import('./data.json') 懒加载使用；静态引入会被打进首屏主包。
export async function downloadAndInstall(name: string) {
  const data = Object.freeze(await fetch(`./icons/${name}-raw.json`).then(r => r.json()))
  addCollection(data)
}
