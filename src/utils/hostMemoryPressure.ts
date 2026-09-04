import type { HostMemoryPressureData } from '../../shared/contracts/host-memory-pressure'
import type { NotificationApi } from 'naive-ui'
import { h } from 'vue'

/** 通知动作：跳转监控台查看主机内存占用（动态引入 router，避免模块初始化顺序问题） */
function renderMonitorAction() {
  return h(
    'button',
    {
      class: 'text-sm text-primary underline cursor-pointer bg-transparent border-none p-0',
      type: 'button',
      onClick: async () => {
        const { default: router } = await import('@/router/index')
        await router.push('/console/monitor')
      },
    },
    '查看主机内存占用',
  )
}

/** 与 shared/constants/error-code.ts 中 HOST_MEMORY_PRESSURE 保持一致 */
export const HOST_MEMORY_PRESSURE_CODE = 'HOST_MEMORY_PRESSURE'

export interface HostMemoryPressureErrorPayload {
  status?: number
  error?: string
  code?: string
  data?: HostMemoryPressureData
}

export function isHostMemoryPressureError(payload: unknown): payload is HostMemoryPressureErrorPayload & {
  code: typeof HOST_MEMORY_PRESSURE_CODE
  error: string
  data: HostMemoryPressureData
} {
  if (!payload || typeof payload !== 'object') {
    return false
  }
  const item = payload as HostMemoryPressureErrorPayload
  return item.code === HOST_MEMORY_PRESSURE_CODE
    && typeof item.error === 'string'
    && typeof item.data?.detail === 'string'
}

export function showHostMemoryPressureNotification(
  notification: NotificationApi,
  payload: HostMemoryPressureErrorPayload & { data: HostMemoryPressureData },
) {
  notification.warning({
    title: '宿主机可用内存不足',
    content: () => h('div', { class: 'space-y-2 max-w-md' }, [
      h('div', {
        class: 'text-sm leading-relaxed whitespace-pre-wrap',
      }, payload.data.detail),
      h('p', { class: 'text-xs text-muted-foreground' }, '安装日志中也会保留完整说明。'),
    ]),
    duration: 0,
    closable: true,
    action: () => renderMonitorAction(),
  })
}

export function tryNotifyHostMemoryPressure(
  notification: NotificationApi,
  error: unknown,
): boolean {
  if (!isHostMemoryPressureError(error)) {
    return false
  }
  showHostMemoryPressureNotification(notification, error)
  return true
}
