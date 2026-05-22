import type { FormProps } from 'naive-ui'
import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import { computed } from 'vue'

/** 与 Tailwind `md` 一致：<768px 视为手机宽度 */
export function useNarrowFormLayout(desktopLabelWidth = 120) {
  const breakpoints = useBreakpoints(breakpointsTailwind)
  const isNarrowViewport = breakpoints.smaller('md')
  const formLabelPlacement = computed<NonNullable<FormProps['labelPlacement']>>(() =>
    isNarrowViewport.value ? 'top' : 'left',
  )
  const formLabelWidth = computed(() =>
    isNarrowViewport.value ? undefined : desktopLabelWidth,
  )
  return { isNarrowViewport, formLabelPlacement, formLabelWidth }
}
