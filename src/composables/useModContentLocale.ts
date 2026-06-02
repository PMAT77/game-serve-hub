import type { ModContentLocale } from '../../shared/contracts/mod'
import { DEFAULT_MOD_CONTENT_LOCALE } from '../../shared/contracts/mod'
import { computed } from 'vue'

/**
 * Mod 内容展示 locale（名称、描述等）。
 * 当前固定为中文；接入 vue-i18n 后在此映射面板语言 → ModContentLocale。
 */
export function useModContentLocale() {
  const locale = computed<ModContentLocale>(() => DEFAULT_MOD_CONTENT_LOCALE)
  return {
    locale,
    defaultLocale: DEFAULT_MOD_CONTENT_LOCALE,
  }
}
