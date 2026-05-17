import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import path from 'path-browserify'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function resolveRoutePath(basePath?: string, routePath?: string) {
  return basePath ? path.resolve(basePath, routePath ?? '') : routePath ?? ''
}

/** 打开 Dialog/Modal 前调用，避免下拉菜单焦点残留在被 aria-hidden 的祖先节点内 */
export function blurFocusedElement() {
  const active = document.activeElement
  if (active instanceof HTMLElement) {
    active.blur()
  }
}
