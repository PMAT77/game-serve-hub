import type { Ref } from 'vue'
import { onBeforeUnmount } from 'vue'

/**
 * 配置页未保存修改守卫：脏状态下拦截路由离开（确认弹窗）与页面刷新/关闭（浏览器原生提示）。
 * 在设置页 setup 中调用，传入脏状态 computed。
 */
export function useUnsavedChangesGuard(dirty: Ref<boolean>, message = '当前修改尚未保存，离开将丢失。确定离开吗？') {
  const router = useRouter()

  const removeRouteGuard = router.beforeEach(() => {
    if (!dirty.value) {
      return true
    }
    return window.confirm(message)
  })

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!dirty.value) {
      return
    }
    event.preventDefault()
    // 兼容旧浏览器需要的 returnValue 赋值
    event.returnValue = ''
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  onBeforeUnmount(() => {
    removeRouteGuard()
    window.removeEventListener('beforeunload', handleBeforeUnload)
  })
}
