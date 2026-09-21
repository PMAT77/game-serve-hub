import type { MapDto } from '../../../shared/contracts/map'
import type { ShardId } from '../../../shared/contracts/shard'
import api from '../index'
import { resolveApiBaseUrl, withTrailingSlash } from '../base-url'

export type { MapDto, MapLegendEntryDto, MapStatus } from '../../../shared/contracts/map'

/**
 * 地形图的 URL 拼装。
 *
 * 图片是给 `<img src>` 用的，浏览器不会给它带自定义请求头，因此令牌只能进查询参数
 *（后端对这个接口显式开了 `allowQueryToken`）。这里集中拼一次，避免各处手写出错。
 */
export function buildMapImageUrl(imagePath: string, token: string): string {
  const base = withTrailingSlash(resolveApiBaseUrl({
    dev: import.meta.env.DEV,
    proxyEnabled: import.meta.env.VITE_ENABLE_PROXY,
    configured: import.meta.env.VITE_APP_API_BASEURL,
  }))
  return `${base}${imagePath}${imagePath.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`
}

export default {
  getMap: (instanceId: string, shard: ShardId) => api.get('app/instance/map', {
    params: { instanceId, shard },
  }) as Promise<{ data: MapDto }>,
  refreshMap: (payload: { instanceId: string, shard: ShardId, force?: boolean }) =>
    api.post('app/instance/map/refresh', payload) as Promise<{ data: MapDto }>,
}
