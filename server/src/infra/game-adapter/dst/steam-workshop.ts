import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type {
  ModContentLocale,
  ModInstallStatus,
  ModLocalizedTextMap,
  SteamModDetailDto,
  SteamModFetchErrorCode,
  SteamModListMeta,
  SteamModListQueryResult,
  SteamModSort,
  SteamModTrendDays,
  SteamModUpstreamSource,
} from '../../../../../shared/contracts/mod'
import {
  DEFAULT_MOD_CONTENT_LOCALE,
  resolveModLocalizedText,
} from '../../../../../shared/contracts/mod'

const WORKSHOP_BROWSE_URL = 'https://steamcommunity.com/workshop/browse/'
/** DST 专用服务器 Mod 标签，与 Steam 创意工坊「server_only_mod」筛选一致 */
const DST_SERVER_ONLY_MOD_TAG = 'server_only_mod'
const STEAM_API_BASE_URL = process.env.GSH_STEAM_WEBAPI_BASE_URL?.trim() || 'https://api.steampowered.com'
const STEAM_WEBAPI_KEY = process.env.GSH_STEAM_WEBAPI_KEY?.trim() || ''
const STEAM_RELAY_URL = process.env.GSH_STEAM_RELAY_URL?.trim() || ''
const STEAM_RELAY_TOKEN = process.env.GSH_STEAM_RELAY_TOKEN?.trim() || ''
const IS_UNIT_TEST = process.env.GSH_UNIT_TEST === '1'
const FETCH_TIMEOUT_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_FETCH_TIMEOUT_MS', 12_000)
const FETCH_RETRY_TIMES = readPositiveIntEnv('GSH_STEAM_WORKSHOP_FETCH_RETRY_TIMES', 2)
const FETCH_RETRY_BASE_DELAY_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_FETCH_RETRY_BASE_DELAY_MS', 300)
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const DEFAULT_SORT: SteamModSort = 'trend'
const DEFAULT_TREND_DAYS: SteamModTrendDays = 7
const CACHE_TTL_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_CACHE_TTL_MS', 2 * 60 * 1000)
const STALE_CACHE_TTL_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_STALE_TTL_MS', 30 * 60 * 1000)
const WORKSHOP_DETAIL_CACHE_TTL_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_DETAIL_CACHE_TTL_MS', 5 * 60 * 1000)
const WORKSHOP_RATING_CACHE_TTL_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_RATING_CACHE_TTL_MS', 10 * 60 * 1000)
const RATE_LIMIT_WINDOW_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_RATE_LIMIT_WINDOW_MS', 1000)
const RATE_LIMIT_PER_KEY = IS_UNIT_TEST
  ? 100_000
  : readPositiveIntEnv('GSH_STEAM_WORKSHOP_RATE_LIMIT_PER_KEY', 2)
const RATE_LIMIT_GLOBAL = IS_UNIT_TEST
  ? 100_000
  : readPositiveIntEnv('GSH_STEAM_WORKSHOP_RATE_LIMIT_GLOBAL', 8)
const CIRCUIT_BREAKER_FAIL_THRESHOLD = IS_UNIT_TEST
  ? 100_000
  : readPositiveIntEnv('GSH_STEAM_WORKSHOP_CIRCUIT_FAIL_THRESHOLD', 6)
const CIRCUIT_BREAKER_OPEN_MS = readPositiveIntEnv('GSH_STEAM_WORKSHOP_CIRCUIT_OPEN_MS', 30 * 1000)
const SHOULD_DISABLE_DISK_CACHE = process.env.GSH_STEAM_WORKSHOP_DISABLE_DISK_CACHE === '1'
  || process.env.NODE_ENV === 'test'
  || process.argv.includes('--test')
const DISK_CACHE_FILE = SHOULD_DISABLE_DISK_CACHE
  ? ''
  : process.env.GSH_STEAM_WORKSHOP_CACHE_FILE?.trim()
      || path.resolve(process.cwd(), 'data', 'cache', 'steam-workshop-mod-cache.json')

interface SteamModRawItem {
  workshopId: string
  title: string
  previewImage: string | null
  detailUrl: string
  rating: number | null
}

interface SteamModRawResult {
  keyword: string
  page: number
  pageSize: number
  sort: SteamModSort
  trendDays: SteamModTrendDays
  hasMore: boolean
  totalCount: number | null
  totalPages: number | null
  sourceUrl: string
  upstreamSource: SteamModUpstreamSource
  items: SteamModRawItem[]
}

interface SteamModCacheEntry {
  fetchedAt: number
  expiresAt: number
  staleExpiresAt: number
  data: SteamModRawResult
}

interface PersistedCachePayload {
  entries: Record<string, SteamModCacheEntry>
}

interface NormalizedSteamQuery {
  keyword: string
  page: number
  requestedPageSize: number
  sort: SteamModSort
  trendDays: SteamModTrendDays
}

interface SteamWorkshopSource {
  name: SteamModUpstreamSource
  enabled: boolean
  queryMods: (query: NormalizedSteamQuery) => Promise<SteamModRawResult>
}

interface SteamVoteData {
  score?: number
  votes_up?: number
  votes_down?: number
}

interface SteamQueryFilesResponseItem {
  publishedfileid?: string
  title?: string
  preview_url?: string
  file_url?: string
  url?: string
  vote_data?: SteamVoteData
}

interface SteamQueryFilesResponse {
  response?: {
    total?: number
    numperpage?: number
    next_cursor?: string
    publishedfiledetails?: SteamQueryFilesResponseItem[]
  }
}

interface SteamFetchMetrics {
  steam_fetch_success_total: number
  steam_fetch_success_by_source: Record<SteamModUpstreamSource, number>
  steam_fetch_fail_total: Record<string, number>
  steam_fetch_fail_by_source: Record<SteamModUpstreamSource, number>
  steam_fetch_latency_ms: number[]
  steam_cache_hit_total: {
    fresh: number
    stale: number
    miss: number
  }
  steam_circuit_open_total: number
  steam_last_success_source: SteamModUpstreamSource | null
  steam_last_success_at: number | null
}

const CACHE_SCHEMA_VERSION = 9
const steamModCache = new Map<string, SteamModCacheEntry>()
const WORKSHOP_DETAIL_CACHE_SCHEMA = 3

interface WorkshopDetailCacheData {
  workshopId: string
  previewImage: string | null
  fileSize: number | null
  tags: string[]
  publishedAt: string | null
  updatedAt: string | null
  detailUrl: string
  creatorName: string | null
  titles: ModLocalizedTextMap
  descriptions: ModLocalizedTextMap
}

const workshopDetailCache = new Map<string, { fetchedAt: number, schemaVersion: number, data: WorkshopDetailCacheData }>()
const workshopRatingCache = new Map<string, { rating: number | null, expiresAt: number }>()
const steamModInFlight = new Map<string, Promise<SteamModRawResult>>()
const steamBackgroundRefreshing = new Set<string>()
const execFileAsync = promisify(execFile)
const perKeyRequestBuckets = new Map<string, number[]>()
const globalRequestBucket: number[] = []
const steamFetchMetrics: SteamFetchMetrics = {
  steam_fetch_success_total: 0,
  steam_fetch_success_by_source: {
    official: 0,
    relay: 0,
    html: 0,
  },
  steam_fetch_fail_total: {},
  steam_fetch_fail_by_source: {
    official: 0,
    relay: 0,
    html: 0,
  },
  steam_fetch_latency_ms: [],
  steam_cache_hit_total: {
    fresh: 0,
    stale: 0,
    miss: 0,
  },
  steam_circuit_open_total: 0,
  steam_last_success_source: null,
  steam_last_success_at: null,
}
const steamCircuitState = {
  failedCount: 0,
  openUntil: 0,
}
let diskCacheLoaded = false
let diskPersistTimer: NodeJS.Timeout | null = null

export class SteamWorkshopFetchError extends Error {
  code: SteamModFetchErrorCode
  retryAfterMs?: number

  constructor(code: SteamModFetchErrorCode, message: string, retryAfterMs?: number) {
    super(message)
    this.name = 'SteamWorkshopFetchError'
    this.code = code
    this.retryAfterMs = retryAfterMs
  }
}

export function isSteamWorkshopFetchError(error: unknown): error is SteamWorkshopFetchError {
  return error instanceof SteamWorkshopFetchError
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const rawValue = process.env[key]
  if (!rawValue) {
    return fallback
  }
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }
  return parsed
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const value = Number.parseInt(String(code), 10)
      return Number.isFinite(value) ? String.fromCharCode(value) : ''
    })
}

function normalizePage(value: number | undefined): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return 1
  }
  return value
}

function normalizePageSize(value: number | undefined): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return DEFAULT_PAGE_SIZE
  }
  return Math.min(MAX_PAGE_SIZE, value)
}

function normalizeSort(value: string | undefined): SteamModSort {
  if (value === 'mostrecent' || value === 'totaluniquesubscribers' || value === 'relevance') {
    return value
  }
  return DEFAULT_SORT
}

function normalizeTrendDays(value: number | undefined): SteamModTrendDays {
  const accepted: SteamModTrendDays[] = [1, 7, 30, 90, 180, 365, -1]
  if (typeof value === 'number' && accepted.includes(value as SteamModTrendDays)) {
    return value as SteamModTrendDays
  }
  return DEFAULT_TREND_DAYS
}

function resolveBrowseSort(sort: SteamModSort): string {
  if (sort === 'relevance') {
    return 'textsearch'
  }
  return sort
}

function buildBrowseUrl(
  keyword: string,
  page: number,
  pageSize: number,
  sort: SteamModSort,
  trendDays: SteamModTrendDays,
): string {
  const browseSort = resolveBrowseSort(sort)
  const url = new URL(WORKSHOP_BROWSE_URL)
  url.searchParams.set('appid', '322330')
  url.searchParams.append('requiredtags[]', DST_SERVER_ONLY_MOD_TAG)
  url.searchParams.set('section', 'readytouseitems')
  url.searchParams.set('browsesort', browseSort)
  url.searchParams.set('actualsort', browseSort)
  if (sort === 'trend') {
    url.searchParams.set('days', String(trendDays))
  }
  url.searchParams.set('searchtext', keyword)
  url.searchParams.set('p', String(page))
  url.searchParams.set('numperpage', String(pageSize))
  return url.toString()
}

interface SsrWorkshopBrowseResult {
  publishedfileid?: string
  title?: string
  preview_url?: string
  score?: number
  star_rating?: number
  total_votes?: number
  vote_data?: SteamVoteData
}

interface SsrWorkshopBrowseData {
  current_page?: number
  total_pages?: number
  total_count?: number
  results?: SsrWorkshopBrowseResult[]
  next_cursor?: string
}

function decodeEmbeddedJsonParse(rawEscaped: string): unknown {
  return JSON.parse(JSON.parse(`"${rawEscaped}"`) as string)
}

function extractSsrWorkshopBrowseData(html: string): SsrWorkshopBrowseData | null {
  for (const match of html.matchAll(/JSON\.parse\("((?:\\.|[^"\\])*)"\)/g)) {
    try {
      const payload = decodeEmbeddedJsonParse(match[1]) as { queryData?: string }
      if (!payload.queryData) {
        continue
      }
      const queryData = JSON.parse(payload.queryData) as {
        queries?: Array<{ state?: { data?: SsrWorkshopBrowseData } }>
      }
      for (const query of queryData.queries ?? []) {
        const data = query.state?.data
        if (!data || !Array.isArray(data.results)) {
          continue
        }
        return data
      }
    }
    catch {
      // 尝试下一个 JSON.parse 块
    }
  }
  return null
}

function normalizeSteamRatingScore(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return null
  }
  const normalized = Math.min(1, Math.max(0, score))
  return Math.round(normalized * 50) / 10
}

function normalizePublishedFileVoteData(item: SteamQueryFilesResponseItem): SteamQueryFilesResponseItem {
  const voteDataRaw = (item as { vote_data?: unknown }).vote_data
  if (typeof voteDataRaw === 'string') {
    try {
      const parsed = JSON.parse(voteDataRaw) as SteamVoteData
      return { ...item, vote_data: parsed }
    }
    catch {
      return item
    }
  }
  return item
}

function resolveSsrStarRating(starRating: unknown): number | null {
  if (typeof starRating !== 'number' || !Number.isFinite(starRating)) {
    return null
  }
  if (starRating >= 1 && starRating <= 5) {
    return Math.round(starRating * 10) / 10
  }
  return null
}

function resolveItemRating(source: {
  vote_data?: SteamVoteData
  score?: number
  votes_up?: number
  votes_down?: number
  star_rating?: number
}): number | null {
  const ssrRating = resolveSsrStarRating(source.star_rating)
  if (ssrRating !== null) {
    return ssrRating
  }
  const voteData = source.vote_data
  if (typeof voteData?.score === 'number') {
    return normalizeSteamRatingScore(voteData.score)
  }
  if (typeof source.score === 'number') {
    return normalizeSteamRatingScore(source.score)
  }
  const votesUp = voteData?.votes_up ?? source.votes_up
  const votesDown = voteData?.votes_down ?? source.votes_down
  if (typeof votesUp === 'number' && typeof votesDown === 'number' && votesUp + votesDown > 0) {
    return normalizeSteamRatingScore((votesUp + 1) / (votesUp + votesDown + 2))
  }
  return null
}

function parseLegacyWorkshopItemRating(block: string): number | null {
  const tooltipMatch = block.match(/data-tooltip-html="([^"]+)"/i)
    ?? block.match(/data-tooltip-text="([^"]+)"/i)
  if (!tooltipMatch?.[1]) {
    return null
  }
  const decoded = decodeHtmlEntities(
    tooltipMatch[1]
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, '\''),
  )
  const percentMatch = decoded.match(/(\d{1,3})%/)
  if (!percentMatch) {
    return null
  }
  const percent = Number.parseInt(percentMatch[1], 10)
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return null
  }
  return normalizeSteamRatingScore(percent / 100)
}

function mapSsrWorkshopResults(results: SsrWorkshopBrowseResult[]): SteamModRawItem[] {
  const dedup = new Set<string>()
  const items: SteamModRawItem[] = []
  for (const result of results) {
    const workshopId = result.publishedfileid?.trim() ?? ''
    const title = result.title?.trim() ?? ''
    if (!workshopId || !title || dedup.has(workshopId)) {
      continue
    }
    items.push({
      workshopId,
      title,
      previewImage: result.preview_url?.trim() || null,
      detailUrl: buildWorkshopDetailUrl(workshopId),
      rating: resolveItemRating(result),
    })
    dedup.add(workshopId)
  }
  return items
}

function parseLegacyWorkshopItems(html: string): SteamModRawItem[] {
  const sectionMatch
    = html.match(/<div class="workshopBrowseItems">([\s\S]*?)<\/div>\s*<div class="workshopBrowsePagingControls">/i)
      ?? html.match(/<div id="searchResultsRows">([\s\S]*?)<\/div>\s*<div class="workshopBrowsePagingControls">/i)
  const source = sectionMatch?.[1] ?? html
  const cardRegex = /<div[^>]*class="workshopItem"[^>]*>[\s\S]*?<\/div>\s*<\/div>/gi
  const idRegex = /data-publishedfileid="(\d+)"/i
  const titleRegex = /<div class="workshopItemTitle[^"]*">([\s\S]*?)<\/div>/i
  const hrefRegex = /<a[^>]+href="(https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=\d+[^"]*)"/i
  const imageRegex = /<img[^>]+class="[^"]*workshopItemPreviewImage[^"]*"[^>]+(?:data-src|src)="([^"]+)"/i
  const items: SteamModRawItem[] = []
  const dedup = new Set<string>()

  for (const card of source.matchAll(cardRegex)) {
    const block = card[0] ?? ''
    const workshopId = block.match(idRegex)?.[1]?.trim()
    const rawTitle = (block.match(titleRegex)?.[1] ?? '').replace(/<[^>]+>/g, '')
    const title = decodeHtmlEntities(rawTitle).trim()
    const detailUrl = block.match(hrefRegex)?.[1]?.trim()
      ?? (workshopId ? buildWorkshopDetailUrl(workshopId) : '')
    if (!detailUrl || !workshopId || !title || dedup.has(workshopId)) {
      continue
    }
    const imageMatch = block.match(imageRegex)
    const previewImage = imageMatch?.[1]?.trim() || null
    items.push({
      workshopId,
      title,
      previewImage,
      detailUrl,
      rating: parseLegacyWorkshopItemRating(block),
    })
    dedup.add(workshopId)
  }
  return items
}

function parseWorkshopItems(html: string): SteamModRawItem[] {
  const ssrData = extractSsrWorkshopBrowseData(html)
  if (ssrData?.results) {
    const ssrItems = mapSsrWorkshopResults(ssrData.results)
    if (ssrItems.length > 0 || ssrData.total_count === 0) {
      return ssrItems
    }
  }
  return parseLegacyWorkshopItems(html)
}

function isKnownEmptyWorkshopBrowse(html: string): boolean {
  if (/searchNoResults/i.test(html)) {
    return true
  }
  const ssrData = extractSsrWorkshopBrowseData(html)
  return Boolean(ssrData && ssrData.total_count === 0)
}

function hasRecognizableWorkshopBrowsePayload(html: string): boolean {
  if (extractSsrWorkshopBrowseData(html)) {
    return true
  }
  if (/workshopItem/i.test(html)) {
    return true
  }
  if (/searchNoResults/i.test(html)) {
    return true
  }
  return false
}

function detectHasMoreFromHtml(html: string, page: number, pageSize: number): boolean {
  const pagination = resolveHtmlPaginationMeta(html, page, pageSize)
  return pagination.hasMore
}

function resolvePaginationTotals(input: {
  page: number
  pageSize: number
  totalCount: number | null
  totalPages: number | null
  hasMoreHint?: boolean
}): {
  hasMore: boolean
  totalCount: number | null
  totalPages: number | null
} {
  const { page, pageSize, totalCount } = input
  let totalPages = input.totalPages
  if (totalPages === null && totalCount !== null && pageSize > 0) {
    totalPages = totalCount === 0 ? 0 : Math.max(1, Math.ceil(totalCount / pageSize))
  }
  const hasMore = totalPages !== null
    ? page < totalPages
    : Boolean(input.hasMoreHint)
  return {
    hasMore,
    totalCount,
    totalPages,
  }
}

function resolveHtmlPaginationMeta(html: string, page: number, pageSize: number): {
  hasMore: boolean
  totalCount: number | null
  totalPages: number | null
} {
  const ssrData = extractSsrWorkshopBrowseData(html)
  if (ssrData) {
    const totalCount = typeof ssrData.total_count === 'number' && ssrData.total_count >= 0
      ? ssrData.total_count
      : null
    const upstreamTotalPages = typeof ssrData.total_pages === 'number' && ssrData.total_pages >= 0
      ? ssrData.total_pages
      : null
    const nextCursor = ssrData.next_cursor?.trim()
    const hasMoreHint = upstreamTotalPages !== null
      ? page < upstreamTotalPages
      : Boolean(nextCursor && nextCursor !== '*' && nextCursor !== '0')
    return resolvePaginationTotals({
      page,
      pageSize,
      totalCount,
      totalPages: upstreamTotalPages,
      hasMoreHint,
    })
  }
  const nextPage = page + 1
  const nextPagePattern = new RegExp(`[?&]p=${nextPage}(?:&|")`)
  return resolvePaginationTotals({
    page,
    pageSize,
    totalCount: null,
    totalPages: null,
    hasMoreHint: nextPagePattern.test(html),
  })
}

async function fetchWorkshopHtmlByPowerShell(sourceUrl: string): Promise<string> {
  if (process.platform !== 'win32') {
    throw new Error('native fetch failed')
  }
  const script = buildPowerShellWorkshopFetchScript(sourceUrl)
  const result = await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    timeout: FETCH_TIMEOUT_MS + 3000,
    maxBuffer: 20 * 1024 * 1024,
  })
  const output = result.stdout?.trim()
  if (!output) {
    throw new Error('Steam 页面内容为空')
  }
  return output
}

function normalizeQuery(input: {
  keyword?: string
  page?: number
  pageSize?: number
  sort?: string
  trendDays?: number
}): NormalizedSteamQuery {
  return {
    keyword: input.keyword?.trim() ?? '',
    page: normalizePage(input.page),
    requestedPageSize: normalizePageSize(input.pageSize),
    sort: normalizeSort(input.sort),
    trendDays: normalizeTrendDays(input.trendDays),
  }
}

function createCacheKey(query: NormalizedSteamQuery): string {
  return JSON.stringify({
    schemaVersion: CACHE_SCHEMA_VERSION,
    keyword: query.keyword,
    page: query.page,
    pageSize: query.requestedPageSize,
    sort: query.sort,
    trendDays: query.trendDays,
  })
}

function isPersistedCacheEntryCompatible(cacheKey: string, entry: SteamModCacheEntry): boolean {
  try {
    const parsed = JSON.parse(cacheKey) as { schemaVersion?: number }
    if (parsed.schemaVersion === CACHE_SCHEMA_VERSION) {
      return true
    }
  }
  catch {
    // ignore invalid cache key
  }
  return entry.data.totalPages != null || entry.data.totalCount != null
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRetryableSteamError(error: SteamWorkshopFetchError): boolean {
  return error.code === 'STEAM_TIMEOUT'
    || error.code === 'STEAM_RATE_LIMIT'
    || error.code === 'STEAM_UPSTREAM_UNAVAILABLE'
}

const STEAM_UPSTREAM_USER_MESSAGE = '无法连接 Steam 创意工坊'

const TECHNICAL_STEAM_ERROR_PATTERNS = [
  /^Command failed:/i,
  /powershell/i,
  /ParserError/i,
  /CategoryInfo/i,
  /FullyQualifiedErrorId/i,
  /At line:\d+/i,
  /Invoke-WebRequest/i,
  /IncompleteHashLiteral/i,
  /Unexpected token/i,
]

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replace(/'/g, "''")
}

function sanitizeSteamUserFacingMessage(message: string, fallback = STEAM_UPSTREAM_USER_MESSAGE): string {
  const normalized = message.trim()
  if (!normalized) {
    return fallback
  }
  if (TECHNICAL_STEAM_ERROR_PATTERNS.some(pattern => pattern.test(normalized))) {
    return fallback
  }
  return normalized
}

function buildPowerShellWorkshopFetchScript(sourceUrl: string): string {
  const escapedUrl = escapePowerShellSingleQuotedString(sourceUrl)
  return [
    '$ProgressPreference = \'SilentlyContinue\'',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    '$headers = @{ \'Accept-Language\' = \'zh-CN,zh;q=0.9,en;q=0.8\'; \'User-Agent\' = \'game-server-hub-mod-fetcher/1.0\' }',
    `(Invoke-WebRequest -UseBasicParsing -Uri '${escapedUrl}' -TimeoutSec 12 -Headers $headers).Content`,
  ].join('; ')
}

function mapUnknownToSteamError(error: unknown): SteamWorkshopFetchError {
  if (isSteamWorkshopFetchError(error)) {
    return error
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new SteamWorkshopFetchError('STEAM_TIMEOUT', '请求 Steam 超时')
    }
    if (error.message.includes('fetch failed')) {
      return new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', STEAM_UPSTREAM_USER_MESSAGE)
    }
    return new SteamWorkshopFetchError(
      'STEAM_UPSTREAM_UNAVAILABLE',
      sanitizeSteamUserFacingMessage(error.message),
    )
  }
  return new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', STEAM_UPSTREAM_USER_MESSAGE)
}

function pruneTimestampBucket(bucket: number[], now: number): number[] {
  const threshold = now - RATE_LIMIT_WINDOW_MS
  return bucket.filter(timestamp => timestamp > threshold)
}

function consumeRateLimit(map: Map<string, number[]>, key: string, limit: number, now: number): number {
  const current = pruneTimestampBucket(map.get(key) ?? [], now)
  map.set(key, current)
  if (current.length >= limit) {
    const retryAfter = RATE_LIMIT_WINDOW_MS - (now - current[0])
    return Math.max(100, retryAfter)
  }
  current.push(now)
  map.set(key, current)
  return 0
}

function assertRateLimit(cacheKey: string) {
  const now = Date.now()
  const globalRetryAfter = (() => {
    const next = pruneTimestampBucket(globalRequestBucket, now)
    globalRequestBucket.length = 0
    globalRequestBucket.push(...next)
    if (globalRequestBucket.length >= RATE_LIMIT_GLOBAL) {
      return Math.max(100, RATE_LIMIT_WINDOW_MS - (now - globalRequestBucket[0]))
    }
    globalRequestBucket.push(now)
    return 0
  })()
  const keyRetryAfter = consumeRateLimit(perKeyRequestBuckets, cacheKey, RATE_LIMIT_PER_KEY, now)
  const retryAfterMs = Math.max(globalRetryAfter, keyRetryAfter)
  if (retryAfterMs > 0) {
    throw new SteamWorkshopFetchError('STEAM_RATE_LIMIT', 'Steam 拉取频率过高，请稍后重试', retryAfterMs)
  }
}

function assertCircuitBreaker() {
  const now = Date.now()
  if (steamCircuitState.openUntil > now) {
    throw new SteamWorkshopFetchError(
      'STEAM_UPSTREAM_UNAVAILABLE',
      'Steam 创意工坊暂时不可用，请稍后重试',
      steamCircuitState.openUntil - now,
    )
  }
}

function markCircuitSuccess() {
  steamCircuitState.failedCount = 0
  steamCircuitState.openUntil = 0
}

function markCircuitFailure() {
  steamCircuitState.failedCount += 1
  if (steamCircuitState.failedCount >= CIRCUIT_BREAKER_FAIL_THRESHOLD) {
    steamCircuitState.openUntil = Date.now() + CIRCUIT_BREAKER_OPEN_MS
    steamCircuitState.failedCount = 0
    steamFetchMetrics.steam_circuit_open_total += 1
  }
}

function scheduleCachePersist() {
  if (!DISK_CACHE_FILE) {
    return
  }
  if (diskPersistTimer) {
    return
  }
  diskPersistTimer = setTimeout(async () => {
    diskPersistTimer = null
    try {
      const entries = Object.fromEntries(steamModCache.entries())
      fs.mkdirSync(path.dirname(DISK_CACHE_FILE), { recursive: true })
      await fs.promises.writeFile(
        DISK_CACHE_FILE,
        JSON.stringify({ entries } satisfies PersistedCachePayload),
        'utf8',
      )
    }
    catch {
      // 持久缓存写入失败不影响主流程
    }
  }, 200)
}

function loadDiskCacheOnce() {
  if (diskCacheLoaded) {
    return
  }
  diskCacheLoaded = true
  if (!DISK_CACHE_FILE) {
    return
  }
  try {
    if (!fs.existsSync(DISK_CACHE_FILE)) {
      return
    }
    const raw = fs.readFileSync(DISK_CACHE_FILE, 'utf8')
    if (!raw.trim()) {
      return
    }
    const payload = JSON.parse(raw) as PersistedCachePayload
    const now = Date.now()
    for (const [cacheKey, entry] of Object.entries(payload.entries ?? {})) {
      if (entry?.staleExpiresAt && entry.staleExpiresAt > now && entry.data) {
        if (!isPersistedCacheEntryCompatible(cacheKey, entry)) {
          continue
        }
        const normalizedEntry: SteamModCacheEntry = {
          ...entry,
          data: {
            ...entry.data,
            upstreamSource: entry.data.upstreamSource ?? 'html',
            totalCount: entry.data.totalCount ?? null,
            totalPages: entry.data.totalPages ?? null,
          },
        }
        steamModCache.set(cacheKey, normalizedEntry)
      }
    }
  }
  catch {
    // 读取失败时忽略持久缓存
  }
}

function toSteamResult(
  raw: SteamModRawResult,
  subscribedModStatusByWorkshopId: Map<string, ModInstallStatus>,
  pendingWorkshopIds: Set<string>,
  meta: SteamModListMeta,
): SteamModListQueryResult {
  return {
    ...raw,
    totalCount: raw.totalCount ?? null,
    totalPages: raw.totalPages ?? null,
    meta,
    pendingWorkshopIds: [...pendingWorkshopIds],
    items: raw.items.map((item) => {
      const subscribeStatus = subscribedModStatusByWorkshopId.get(item.workshopId) ?? null
      const subscribed = subscribeStatus !== null
      const isPending = pendingWorkshopIds.has(item.workshopId)
        || subscribeStatus === 'pending'
      return {
        ...item,
        rating: item.rating ?? null,
        subscribed,
        subscribeStatus,
        installed: subscribeStatus === 'ready',
        pendingDownload: isPending,
      }
    }),
  }
}

function buildWorkshopDetailUrl(workshopId: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${workshopId}`
}

interface PublishedFileDetailItem {
  publishedfileid?: string
  result?: number
  creator?: string
  title?: string
  description?: string
  preview_url?: string
  file_size?: number
  time_created?: number
  time_updated?: number
  tags?: Array<{ tag?: string }>
  vote_data?: SteamVoteData
}

function unixSecondsToIso(value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return new Date(value * 1000).toISOString()
}

function parsePublishedFileTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return []
  }
  const unique = new Set<string>()
  for (const item of tags) {
    if (typeof item === 'object' && item && 'tag' in item) {
      const tag = String((item as { tag?: string }).tag ?? '').trim()
      if (tag) {
        unique.add(tag)
      }
    }
  }
  return [...unique]
}

function acceptLanguageForLocale(locale: ModContentLocale): string {
  return locale === 'zh-CN'
    ? 'zh-CN,zh;q=0.9,en;q=0.8'
    : 'en-US,en;q=0.9,zh;q=0.8'
}

function mergeLocalizedText(
  map: ModLocalizedTextMap,
  locale: ModContentLocale,
  value: string,
): void {
  const trimmed = value.trim()
  if (!trimmed) {
    return
  }
  for (const existing of Object.values(map)) {
    if (existing?.trim() === trimmed) {
      return
    }
  }
  map[locale] = trimmed
}

function buildWorkshopDetailFromCache(
  data: WorkshopDetailCacheData,
  preferredLocale: ModContentLocale,
): Omit<SteamModDetailDto, 'subscribed' | 'subscribeStatus' | 'installed'> {
  const titleResolved = resolveModLocalizedText(data.titles, preferredLocale)
  const descriptionResolved = resolveModLocalizedText(data.descriptions, preferredLocale)
  const contentLocale = titleResolved.contentLocale === descriptionResolved.contentLocale
    ? titleResolved.contentLocale
    : preferredLocale
  return {
    workshopId: data.workshopId,
    title: titleResolved.value || `Workshop Mod ${data.workshopId}`,
    description: descriptionResolved.value,
    contentLocale,
    titles: { ...data.titles },
    descriptions: { ...data.descriptions },
    previewImage: data.previewImage,
    fileSize: data.fileSize,
    tags: [...data.tags],
    publishedAt: data.publishedAt,
    updatedAt: data.updatedAt,
    detailUrl: data.detailUrl,
    creatorName: data.creatorName,
  }
}

function mapPublishedFileDetailBase(item: PublishedFileDetailItem): Omit<WorkshopDetailCacheData, 'titles' | 'descriptions' | 'creatorName'> & {
  creatorSteamId: string | null
} {
  const workshopId = item.publishedfileid?.trim() ?? ''
  return {
    workshopId,
    previewImage: item.preview_url?.trim() || null,
    fileSize: typeof item.file_size === 'number' && Number.isFinite(item.file_size) && item.file_size >= 0
      ? item.file_size
      : null,
    tags: parsePublishedFileTags(item.tags),
    publishedAt: unixSecondsToIso(item.time_created),
    updatedAt: unixSecondsToIso(item.time_updated),
    detailUrl: buildWorkshopDetailUrl(workshopId),
    creatorSteamId: item.creator?.trim() || null,
  }
}

function mapPublishedFileDetailToDto(item: PublishedFileDetailItem): Omit<SteamModDetailDto, 'subscribed' | 'subscribeStatus' | 'installed'> {
  const base = mapPublishedFileDetailBase(item)
  const titles: ModLocalizedTextMap = {}
  const descriptions: ModLocalizedTextMap = {}
  mergeLocalizedText(titles, DEFAULT_MOD_CONTENT_LOCALE, item.title?.trim() || `Workshop Mod ${base.workshopId}`)
  mergeLocalizedText(descriptions, DEFAULT_MOD_CONTENT_LOCALE, item.description?.trim() ?? '')
  return buildWorkshopDetailFromCache({
    ...base,
    creatorName: null,
    titles,
    descriptions,
  }, DEFAULT_MOD_CONTENT_LOCALE)
}

async function fetchWorkshopLocalizedContent(
  workshopId: string,
  preferredLocale: ModContentLocale = DEFAULT_MOD_CONTENT_LOCALE,
): Promise<{
  base: Omit<WorkshopDetailCacheData, 'creatorName'>
  creatorSteamId: string | null
}> {
  const normalizedId = workshopId.trim()
  const fallbackLocale: ModContentLocale = preferredLocale === 'zh-CN' ? 'en-US' : 'zh-CN'

  async function fetchLocale(locale: ModContentLocale) {
    const items = await requestPublishedFileDetails([normalizedId], { locale })
    const item = items.find(row => row.publishedfileid?.trim() === normalizedId) ?? items[0]
    return { locale, item }
  }

  const primaryResult = await fetchLocale(preferredLocale)
  const localeResults: Array<{ locale: ModContentLocale, item: PublishedFileDetailItem | undefined }> = []
  if (primaryResult.item?.result === 1) {
    localeResults.push(primaryResult)
  }
  if (primaryResult.item?.result !== 1 || preferredLocale !== fallbackLocale) {
    const fallbackResult = await fetchLocale(fallbackLocale)
    if (fallbackResult.item?.result === 1 && !localeResults.some(entry => entry.locale === fallbackLocale)) {
      localeResults.push(fallbackResult)
    }
  }
  const validItems = localeResults.filter(entry => entry.item?.result === 1)
  const primary = validItems.find(entry => entry.locale === preferredLocale)?.item
    ?? validItems.find(entry => entry.locale === DEFAULT_MOD_CONTENT_LOCALE)?.item
    ?? validItems[0]?.item
  if (!primary) {
    throw new SteamWorkshopFetchError('STEAM_PARSE_FAILED', 'Mod 不存在或无法读取')
  }
  const baseFields = mapPublishedFileDetailBase(primary)
  const titles: ModLocalizedTextMap = {}
  const descriptions: ModLocalizedTextMap = {}
  for (const { locale, item } of validItems) {
    if (!item) {
      continue
    }
    mergeLocalizedText(titles, locale, item.title?.trim() || `Workshop Mod ${baseFields.workshopId}`)
    mergeLocalizedText(descriptions, locale, item.description?.trim() ?? '')
  }
  return {
    base: {
      ...baseFields,
      titles,
      descriptions,
    },
    creatorSteamId: primary.creator?.trim() || null,
  }
}

function parseSteamPersonaNameFromCommunityXml(xml: string): string | null {
  const matched = xml.match(/<steamID><!\[CDATA\[([^\]]+)\]\]><\/steamID>/i)
    ?? xml.match(/<steamID>([^<]+)<\/steamID>/i)
  const name = matched?.[1]?.trim()
  return name || null
}

async function fetchSteamPersonaName(steamId: string): Promise<string | null> {
  const normalizedId = steamId.trim()
  if (!normalizedId) {
    return null
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const summaryUrl = new URL(`${STEAM_API_BASE_URL}/ISteamUser/GetPlayerSummaries/v0002/`)
    summaryUrl.searchParams.set('steamids', normalizedId)
    if (STEAM_WEBAPI_KEY) {
      summaryUrl.searchParams.set('key', STEAM_WEBAPI_KEY)
    }
    const summaryResponse = await fetch(summaryUrl, {
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'game-server-hub-mod-fetcher/1.0',
      },
      signal: controller.signal,
    })
    if (summaryResponse.ok) {
      const payload = await summaryResponse.json() as {
        response?: {
          players?: Array<{ personaname?: string }>
        }
      }
      const personaName = payload.response?.players?.[0]?.personaname?.trim()
      if (personaName) {
        return personaName
      }
    }
    const profileResponse = await fetch(`https://steamcommunity.com/profiles/${normalizedId}/?xml=1`, {
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'game-server-hub-mod-fetcher/1.0',
      },
      signal: controller.signal,
    })
    if (!profileResponse.ok) {
      return null
    }
    const xml = await profileResponse.text()
    return parseSteamPersonaNameFromCommunityXml(xml)
  }
  catch {
    return null
  }
  finally {
    clearTimeout(timeout)
  }
}

async function requestPublishedFileDetails(
  workshopIds: string[],
  options?: { locale?: ModContentLocale },
): Promise<PublishedFileDetailItem[]> {
  const uniqueIds = [...new Set(workshopIds.map(id => id.trim()).filter(Boolean))]
  if (uniqueIds.length === 0) {
    return []
  }
  const url = `${STEAM_API_BASE_URL}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`
  const body = new URLSearchParams()
  body.set('itemcount', String(uniqueIds.length))
  for (let index = 0; index < uniqueIds.length; index++) {
    body.set(`publishedfileids[${index}]`, uniqueIds[index])
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'game-server-hub-mod-fetcher/1.0',
      'Accept-Language': acceptLanguageForLocale(options?.locale ?? DEFAULT_MOD_CONTENT_LOCALE),
    }
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
      const retryAfterMs = Number.isFinite(retryAfterSeconds) ? Math.max(1000, retryAfterSeconds * 1000) : 0
      throw new SteamWorkshopFetchError('STEAM_RATE_LIMIT', 'Steam 返回限流，请稍后重试', retryAfterMs || undefined)
    }
    if (!response.ok) {
      throw new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', `Steam 返回 ${response.status}`)
    }
    const payload = await response.json() as {
      response?: {
        publishedfiledetails?: PublishedFileDetailItem[]
      }
    }
    return payload.response?.publishedfiledetails ?? []
  }
  catch (error) {
    if (isSteamWorkshopFetchError(error)) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SteamWorkshopFetchError('STEAM_TIMEOUT', '请求 Steam 超时')
    }
    throw mapUnknownToSteamError(error)
  }
  finally {
    clearTimeout(timeout)
  }
}

export async function fetchWorkshopFileDetail(
  workshopId: string,
  preferredLocale: ModContentLocale = DEFAULT_MOD_CONTENT_LOCALE,
): Promise<Omit<SteamModDetailDto, 'subscribed' | 'subscribeStatus' | 'installed'>> {
  const normalizedId = workshopId.trim()
  if (!normalizedId) {
    throw new SteamWorkshopFetchError('STEAM_PARSE_FAILED', '创意工坊 ID 不能为空')
  }
  const cached = workshopDetailCache.get(normalizedId)
  if (
    cached
    && cached.schemaVersion === WORKSHOP_DETAIL_CACHE_SCHEMA
    && Date.now() - cached.fetchedAt < WORKSHOP_DETAIL_CACHE_TTL_MS
  ) {
    return buildWorkshopDetailFromCache(cached.data, preferredLocale)
  }
  const { base, creatorSteamId } = await fetchWorkshopLocalizedContent(normalizedId, preferredLocale)
  let creatorName: string | null = null
  if (creatorSteamId) {
    creatorName = await fetchSteamPersonaName(creatorSteamId)
  }
  const cacheData: WorkshopDetailCacheData = {
    ...base,
    creatorName,
  }
  workshopDetailCache.set(normalizedId, {
    fetchedAt: Date.now(),
    schemaVersion: WORKSHOP_DETAIL_CACHE_SCHEMA,
    data: cacheData,
  })
  return buildWorkshopDetailFromCache(cacheData, preferredLocale)
}

function resolveDegradedUpstreamMessage(error: SteamWorkshopFetchError): string {
  if (error.code === 'STEAM_TIMEOUT') {
    return '暂时无法连接 Steam 创意工坊，请稍后点击刷新重试'
  }
  if (error.code === 'STEAM_RATE_LIMIT') {
    return 'Steam 请求频率过高，请稍后点击刷新重试'
  }
  if (error.code === 'STEAM_PARSE_FAILED') {
    return 'Steam 页面解析失败，请稍后点击刷新重试'
  }
  if (error.code === 'STEAM_UPSTREAM_UNAVAILABLE') {
    return '暂时无法连接 Steam 创意工坊，请稍后点击刷新重试'
  }
  return sanitizeSteamUserFacingMessage(
    error.message,
    '暂时无法连接 Steam 创意工坊，请稍后点击刷新重试',
  )
}

function buildDegradedEmptySteamResult(
  query: NormalizedSteamQuery,
  subscribedModStatusByWorkshopId: Map<string, ModInstallStatus>,
  pendingWorkshopIds: Set<string>,
  steamError: SteamWorkshopFetchError,
  traceId: string,
): SteamModListQueryResult {
  const cacheKey = createCacheKey(query)
  scheduleBackgroundRefresh(cacheKey, query)
  const sourceUrl = buildBrowseUrl(
    query.keyword,
    query.page,
    query.requestedPageSize,
    query.sort,
    query.trendDays,
  )
  return toSteamResult(
    {
      keyword: query.keyword,
      page: query.page,
      pageSize: query.requestedPageSize,
      sort: query.sort,
      trendDays: query.trendDays,
      hasMore: false,
      totalCount: null,
      totalPages: null,
      sourceUrl,
      upstreamSource: 'html',
      items: [],
    },
    subscribedModStatusByWorkshopId,
    pendingWorkshopIds,
    enrichMeta({
      cached: false,
      stale: false,
      cacheAgeMs: 0,
      source: 'live',
      fetchTraceId: traceId,
      upstreamUnavailable: true,
      upstreamMessage: resolveDegradedUpstreamMessage(steamError),
      retryAfterMs: steamError.retryAfterMs,
      steamErrorCode: steamError.code,
    }, 'html'),
  )
}

function enrichMeta(
  meta: Omit<SteamModListMeta, 'upstreamSource' | 'lastSuccessSource' | 'lastSuccessAt'>,
  upstreamSource: SteamModUpstreamSource,
): SteamModListMeta {
  return {
    ...meta,
    upstreamSource,
    lastSuccessSource: steamFetchMetrics.steam_last_success_source ?? undefined,
    lastSuccessAt: steamFetchMetrics.steam_last_success_at
      ? new Date(steamFetchMetrics.steam_last_success_at).toISOString()
      : undefined,
  }
}

async function fetchWorkshopHtmlByNative(sourceUrl: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(sourceUrl, {
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'game-server-hub-mod-fetcher/1.0',
      },
      signal: controller.signal,
    })
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
      const retryAfterMs = Number.isFinite(retryAfterSeconds) ? Math.max(1000, retryAfterSeconds * 1000) : 0
      throw new SteamWorkshopFetchError('STEAM_RATE_LIMIT', 'Steam 返回限流，请稍后重试', retryAfterMs || undefined)
    }
    if (response.status >= 500) {
      throw new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', `Steam 返回 ${response.status}`)
    }
    if (!response.ok) {
      throw new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', `Steam 返回 ${response.status}`)
    }
    const html = await response.text()
    if (!html.trim()) {
      throw new SteamWorkshopFetchError('STEAM_PARSE_FAILED', 'Steam 页面内容为空')
    }
    return html
  }
  catch (error) {
    if (error instanceof SteamWorkshopFetchError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SteamWorkshopFetchError('STEAM_TIMEOUT', '请求 Steam 超时')
    }
    if (error instanceof Error && error.message.includes('fetch failed')) {
      throw new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', '无法连接 Steam 创意工坊')
    }
    throw mapUnknownToSteamError(error)
  }
  finally {
    clearTimeout(timeout)
  }
}

async function fetchJsonWithTimeout(url: string, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      headers: {
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'User-Agent': 'game-server-hub-mod-fetcher/1.0',
        ...(headers ?? {}),
      },
      signal: controller.signal,
    })
    if (response.status === 429) {
      const retryAfterSeconds = Number.parseInt(response.headers.get('Retry-After') ?? '', 10)
      const retryAfterMs = Number.isFinite(retryAfterSeconds) ? Math.max(1000, retryAfterSeconds * 1000) : 0
      throw new SteamWorkshopFetchError('STEAM_RATE_LIMIT', 'Steam 返回限流，请稍后重试', retryAfterMs || undefined)
    }
    if (response.status >= 500) {
      throw new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', `Steam 返回 ${response.status}`)
    }
    if (!response.ok) {
      throw new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', `Steam 返回 ${response.status}`)
    }
    return await response.json()
  }
  catch (error) {
    if (isSteamWorkshopFetchError(error)) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SteamWorkshopFetchError('STEAM_TIMEOUT', '请求 Steam 超时')
    }
    if (error instanceof Error && error.message.includes('fetch failed')) {
      throw new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', '无法连接 Steam 创意工坊')
    }
    throw mapUnknownToSteamError(error)
  }
  finally {
    clearTimeout(timeout)
  }
}

async function fetchSteamWorkshopHtml(sourceUrl: string): Promise<string> {
  try {
    return await fetchWorkshopHtmlByNative(sourceUrl)
  }
  catch (error) {
    if (process.platform !== 'win32' || process.env.GSH_STEAM_WORKSHOP_DISABLE_POWERSHELL_FALLBACK === '1') {
      throw error
    }
    if (isSteamWorkshopFetchError(error) && error.code === 'STEAM_RATE_LIMIT') {
      throw error
    }
    try {
      return await fetchWorkshopHtmlByPowerShell(sourceUrl)
    }
    catch (fallbackError) {
      throw mapUnknownToSteamError(fallbackError)
    }
  }
}

function resolveQueryType(sort: SteamModSort): number {
  if (sort === 'relevance') {
    return 12
  }
  if (sort === 'mostrecent') {
    return 1
  }
  if (sort === 'totaluniquesubscribers') {
    return 9
  }
  return 3
}

function normalizeQueryFilesItems(payload: unknown): SteamQueryFilesResponseItem[] {
  if (typeof payload !== 'object' || !payload) {
    return []
  }
  const typed = payload as SteamQueryFilesResponse
  if (!Array.isArray(typed.response?.publishedfiledetails)) {
    return []
  }
  return typed.response.publishedfiledetails
}

function hasNextCursor(payload: unknown): boolean {
  if (typeof payload !== 'object' || !payload) {
    return false
  }
  const typed = payload as SteamQueryFilesResponse
  const nextCursor = typed.response?.next_cursor?.trim()
  return Boolean(nextCursor && nextCursor !== '*' && nextCursor !== '0')
}

function resolveTotalFromQueryFiles(payload: unknown): number | null {
  if (typeof payload !== 'object' || !payload) {
    return null
  }
  const typed = payload as SteamQueryFilesResponse
  const total = typed.response?.total
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : null
}

function mapPublishedFileDetailsToRatingMap(items: SteamQueryFilesResponseItem[]): Map<string, number | null> {
  const result = new Map<string, number | null>()
  for (const rawItem of items) {
    const item = normalizePublishedFileVoteData(rawItem)
    const workshopId = item.publishedfileid?.trim() ?? ''
    if (!workshopId) {
      continue
    }
    result.set(workshopId, resolveItemRating(item))
  }
  return result
}

function mapQueryFilesItems(items: SteamQueryFilesResponseItem[]): SteamModRawItem[] {
  const dedup = new Set<string>()
  const result: SteamModRawItem[] = []
  for (const item of items) {
    const workshopId = item.publishedfileid?.trim() ?? ''
    const title = item.title?.trim() ?? ''
    if (!workshopId || !title || dedup.has(workshopId)) {
      continue
    }
    const normalizedItem = normalizePublishedFileVoteData(item)
    result.push({
      workshopId,
      title,
      previewImage: normalizedItem.preview_url?.trim() || null,
      detailUrl: normalizedItem.file_url?.trim() || normalizedItem.url?.trim() || buildWorkshopDetailUrl(workshopId),
      rating: resolveItemRating(normalizedItem),
    })
    dedup.add(workshopId)
  }
  return result
}

async function fetchSteamDetailsMap(workshopIds: string[]): Promise<Map<string, SteamModRawItem>> {
  const apiKey = process.env.GSH_STEAM_WEBAPI_KEY?.trim() || ''
  if (!apiKey || workshopIds.length === 0) {
    return new Map()
  }
  const detailsUrl = new URL('/IPublishedFileService/GetDetails/v1/', STEAM_API_BASE_URL)
  detailsUrl.searchParams.set('key', apiKey)
  detailsUrl.searchParams.set('includevotes', 'true')
  detailsUrl.searchParams.set('return_vote_data', 'true')
  detailsUrl.searchParams.set('appid', '322330')
  for (let index = 0; index < workshopIds.length; index++) {
    detailsUrl.searchParams.set(`publishedfileids[${index}]`, workshopIds[index])
  }
  const payload = await fetchJsonWithTimeout(detailsUrl.toString())
  const items = normalizeQueryFilesItems(payload)
  const ratingMap = mapPublishedFileDetailsToRatingMap(items)
  const fullItems = mapQueryFilesItems(items)
  const result = new Map(fullItems.map(item => [item.workshopId, item]))
  for (const workshopId of workshopIds) {
    if (result.has(workshopId)) {
      const existing = result.get(workshopId)!
      if (existing.rating === null) {
        existing.rating = ratingMap.get(workshopId) ?? null
      }
      continue
    }
    const rating = ratingMap.get(workshopId)
    if (rating === undefined) {
      continue
    }
    result.set(workshopId, {
      workshopId,
      title: '',
      previewImage: null,
      detailUrl: buildWorkshopDetailUrl(workshopId),
      rating,
    })
  }
  return result
}

async function fetchWorkshopRatingsByGetDetails(workshopIds: string[]): Promise<Map<string, number | null>> {
  const uniqueIds = [...new Set(workshopIds.map(id => id.trim()).filter(Boolean))]
  const result = new Map<string, number | null>()
  if (uniqueIds.length === 0) {
    return result
  }
  const apiKey = process.env.GSH_STEAM_WEBAPI_KEY?.trim() || ''
  if (!apiKey) {
    for (const workshopId of uniqueIds) {
      result.set(workshopId, null)
    }
    return result
  }
  const detailsUrl = new URL('/IPublishedFileService/GetDetails/v1/', STEAM_API_BASE_URL)
  detailsUrl.searchParams.set('key', apiKey)
  detailsUrl.searchParams.set('includevotes', 'true')
  detailsUrl.searchParams.set('return_vote_data', 'true')
  detailsUrl.searchParams.set('appid', '322330')
  for (let index = 0; index < uniqueIds.length; index++) {
    detailsUrl.searchParams.set(`publishedfileids[${index}]`, uniqueIds[index])
  }
  const payload = await fetchJsonWithTimeout(detailsUrl.toString())
  const ratingMap = mapPublishedFileDetailsToRatingMap(normalizeQueryFilesItems(payload))
  for (const workshopId of uniqueIds) {
    result.set(workshopId, ratingMap.get(workshopId) ?? null)
  }
  return result
}

async function enrichWorkshopItemRatings(items: SteamModRawItem[]): Promise<void> {
  const missingIds = items
    .filter(item => item.rating === null)
    .map(item => item.workshopId)
  const apiKey = process.env.GSH_STEAM_WEBAPI_KEY?.trim() || ''
  if (missingIds.length === 0 || !apiKey) {
    return
  }
  try {
    const ratingMap = await fetchWorkshopRatingsByGetDetails(missingIds)
    for (const item of items) {
      if (item.rating === null) {
        item.rating = ratingMap.get(item.workshopId) ?? null
      }
    }
  }
  catch {
    // 评分补全失败不影响主流程
  }
}

function parseRelayItems(payload: unknown): SteamModRawItem[] {
  if (typeof payload !== 'object' || !payload) {
    return []
  }
  const directItems = (payload as { items?: unknown }).items
  if (!Array.isArray(directItems)) {
    return []
  }
  const dedup = new Set<string>()
  const result: SteamModRawItem[] = []
  for (const item of directItems) {
    if (typeof item !== 'object' || !item) {
      continue
    }
    const row = item as Record<string, unknown>
    const workshopId = typeof row.workshopId === 'string' ? row.workshopId.trim() : ''
    const title = typeof row.title === 'string' ? row.title.trim() : ''
    if (!workshopId || !title || dedup.has(workshopId)) {
      continue
    }
    result.push({
      workshopId,
      title,
      previewImage: typeof row.previewImage === 'string' && row.previewImage.trim() ? row.previewImage : null,
      detailUrl: typeof row.detailUrl === 'string' && row.detailUrl.trim()
        ? row.detailUrl
        : buildWorkshopDetailUrl(workshopId),
      rating: typeof row.rating === 'number'
        ? normalizeSteamRatingScore(row.rating)
        : resolveItemRating(row as { vote_data?: SteamVoteData, score?: number }),
    })
    dedup.add(workshopId)
  }
  return result
}

async function queryByOfficialApi(query: NormalizedSteamQuery): Promise<SteamModRawResult> {
  if (query.sort === 'relevance' && !query.keyword) {
    throw new SteamWorkshopFetchError('STEAM_PARSE_FAILED', '相关性排序需要搜索关键词')
  }
  const queryFilesUrl = new URL('/IPublishedFileService/QueryFiles/v1/', STEAM_API_BASE_URL)
  queryFilesUrl.searchParams.set('key', STEAM_WEBAPI_KEY)
  const inputJson: Record<string, unknown> = {
    query_type: resolveQueryType(query.sort),
    cursor: '*',
    page: query.page,
    numperpage: query.requestedPageSize,
    creator_appid: 322330,
    appid: 322330,
    search_text: query.keyword,
    filetype: 18,
    return_previews: true,
    return_short_description: true,
    return_vote_data: true,
    strip_description_bbcode: true,
    requiredtags: DST_SERVER_ONLY_MOD_TAG,
    cache_max_age_seconds: query.sort === 'relevance' ? 0 : Math.max(30, Math.floor(CACHE_TTL_MS / 1000)),
  }
  if (query.sort === 'relevance') {
    Object.assign(inputJson, {
      search_text_target: 0,
    })
  }
  else {
    inputJson.language = 6 // schinese
  }
  if (query.sort === 'trend') {
    const trendDays = query.trendDays === -1 ? 7 : Math.min(7, query.trendDays)
    Object.assign(inputJson, {
      days: trendDays,
      include_recent_votes_only: true,
    })
  }
  queryFilesUrl.searchParams.set('input_json', JSON.stringify(inputJson))
  const payload = await fetchJsonWithTimeout(queryFilesUrl.toString())
  const items = mapQueryFilesItems(normalizeQueryFilesItems(payload))
  const total = resolveTotalFromQueryFiles(payload)
  const totalCount = total
  const pagination = resolvePaginationTotals({
    page: query.page,
    pageSize: query.requestedPageSize,
    totalCount,
    totalPages: null,
    hasMoreHint: hasNextCursor(payload),
  })
  const { hasMore, totalPages } = pagination
  if (items.length === 0 && query.keyword && !hasNextCursor(payload)) {
    return {
      keyword: query.keyword,
      page: query.page,
      pageSize: query.requestedPageSize,
      sort: query.sort,
      trendDays: query.trendDays,
      hasMore,
      totalCount,
      totalPages,
      sourceUrl: queryFilesUrl.toString(),
      upstreamSource: 'official',
      items: [],
    }
  }
  if (items.length === 0) {
    throw new SteamWorkshopFetchError('STEAM_PARSE_FAILED', 'Steam QueryFiles 返回空结果')
  }
  const missingDetailIds = items
    .filter(item => !item.previewImage || !item.detailUrl)
    .map(item => item.workshopId)
  if (missingDetailIds.length > 0) {
    const detailsMap = await fetchSteamDetailsMap(missingDetailIds)
    for (const item of items) {
      const detail = detailsMap.get(item.workshopId)
      if (!detail) {
        continue
      }
      item.previewImage = item.previewImage || detail.previewImage
      item.detailUrl = item.detailUrl || detail.detailUrl
      item.rating = item.rating ?? detail.rating
    }
  }
  await enrichWorkshopItemRatings(items)
  return {
    keyword: query.keyword,
    page: query.page,
    pageSize: query.requestedPageSize,
    sort: query.sort,
    trendDays: query.trendDays,
    hasMore,
    totalCount: pagination.totalCount,
    totalPages,
    sourceUrl: queryFilesUrl.toString(),
    upstreamSource: 'official',
    items,
  }
}

async function queryByRelayApi(query: NormalizedSteamQuery): Promise<SteamModRawResult> {
  const relayUrl = new URL('/query-files', STEAM_RELAY_URL.endsWith('/') ? STEAM_RELAY_URL : `${STEAM_RELAY_URL}/`)
  relayUrl.searchParams.set('keyword', query.keyword)
  relayUrl.searchParams.set('page', String(query.page))
  relayUrl.searchParams.set('pageSize', String(query.requestedPageSize))
  relayUrl.searchParams.set('sort', query.sort)
  relayUrl.searchParams.set('trendDays', String(query.trendDays))
  relayUrl.searchParams.set('requiredtags', DST_SERVER_ONLY_MOD_TAG)
  const payload = await fetchJsonWithTimeout(relayUrl.toString(), STEAM_RELAY_TOKEN
    ? {
        Authorization: `Bearer ${STEAM_RELAY_TOKEN}`,
      }
    : undefined)
  const relayItems = parseRelayItems(payload)
  const items = relayItems.length > 0 ? relayItems : mapQueryFilesItems(normalizeQueryFilesItems(payload))
  if (items.length === 0) {
    throw new SteamWorkshopFetchError('STEAM_PARSE_FAILED', 'Relay 返回空结果')
  }
  const relayMeta = payload as {
    hasMore?: unknown
    totalCount?: unknown
    totalPages?: unknown
    sourceUrl?: unknown
    next_cursor?: unknown
    response?: { next_cursor?: unknown, total?: unknown }
  }
  const relayTotalCount = typeof relayMeta.totalCount === 'number'
    ? relayMeta.totalCount
    : typeof relayMeta.response?.total === 'number'
      ? relayMeta.response.total
      : null
  const relayUpstreamTotalPages = typeof relayMeta.totalPages === 'number'
    ? relayMeta.totalPages
    : null
  const relayHasMoreHint = typeof relayMeta.hasMore === 'boolean'
    ? relayMeta.hasMore
    : Boolean(
        relayMeta.next_cursor
        || relayMeta.response?.next_cursor,
      )
  const relayPagination = resolvePaginationTotals({
    page: query.page,
    pageSize: query.requestedPageSize,
    totalCount: relayTotalCount,
    totalPages: relayUpstreamTotalPages,
    hasMoreHint: relayHasMoreHint,
  })
  await enrichWorkshopItemRatings(items)
  return {
    keyword: query.keyword,
    page: query.page,
    pageSize: query.requestedPageSize,
    sort: query.sort,
    trendDays: query.trendDays,
    hasMore: relayPagination.hasMore,
    totalCount: relayPagination.totalCount,
    totalPages: relayPagination.totalPages,
    sourceUrl: typeof relayMeta.sourceUrl === 'string' && relayMeta.sourceUrl.trim()
      ? relayMeta.sourceUrl
      : relayUrl.toString(),
    upstreamSource: 'relay',
    items,
  }
}

async function queryByHtml(query: NormalizedSteamQuery): Promise<SteamModRawResult> {
  const sourceUrl = buildBrowseUrl(
    query.keyword,
    query.page,
    query.requestedPageSize,
    query.sort,
    query.trendDays,
  )
  const html = await fetchSteamWorkshopHtml(sourceUrl)
  const items = parseWorkshopItems(html)
  if (items.length === 0 && !isKnownEmptyWorkshopBrowse(html) && !hasRecognizableWorkshopBrowsePayload(html)) {
    throw new SteamWorkshopFetchError('STEAM_PARSE_FAILED', 'Steam 页面结构变更，解析失败')
  }
  const pagination = resolveHtmlPaginationMeta(html, query.page, query.requestedPageSize)
  await enrichWorkshopItemRatings(items)
  return {
    keyword: query.keyword,
    page: query.page,
    pageSize: query.requestedPageSize,
    sort: query.sort,
    trendDays: query.trendDays,
    hasMore: pagination.hasMore,
    totalCount: pagination.totalCount,
    totalPages: pagination.totalPages,
    sourceUrl,
    upstreamSource: 'html',
    items,
  }
}

const steamSources: SteamWorkshopSource[] = [
  {
    name: 'official',
    enabled: Boolean(STEAM_WEBAPI_KEY),
    queryMods: queryByOfficialApi,
  },
  {
    name: 'relay',
    enabled: Boolean(STEAM_RELAY_URL),
    queryMods: queryByRelayApi,
  },
  {
    name: 'html',
    enabled: true,
    queryMods: queryByHtml,
  },
]

function resolveSteamSourcesForQuery(query: NormalizedSteamQuery): SteamWorkshopSource[] {
  const enabled = steamSources.filter(source => source.enabled)
  if (query.sort === 'relevance' && query.keyword) {
    const preferredOrder = ['html', 'official', 'relay']
    return preferredOrder
      .map(name => enabled.find(source => source.name === name))
      .filter((source): source is SteamWorkshopSource => Boolean(source))
  }
  return enabled
}

async function fetchLiveWithPolicy(query: NormalizedSteamQuery, cacheKey: string, traceId: string): Promise<SteamModRawResult> {
  let lastError: SteamWorkshopFetchError | null = null
  const enabledSources = resolveSteamSourcesForQuery(query)
  for (const source of enabledSources) {
    for (let attempt = 0; attempt <= FETCH_RETRY_TIMES; attempt++) {
      try {
        assertCircuitBreaker()
        assertRateLimit(cacheKey)
        const startedAt = Date.now()
        const payload = await source.queryMods(query)
        steamFetchMetrics.steam_fetch_success_total += 1
        steamFetchMetrics.steam_fetch_success_by_source[source.name] += 1
        steamFetchMetrics.steam_fetch_latency_ms.push(Date.now() - startedAt)
        steamFetchMetrics.steam_last_success_source = source.name
        steamFetchMetrics.steam_last_success_at = Date.now()
        markCircuitSuccess()
        if (process.env.NODE_ENV !== 'test') {
          console.info(`[steam-workshop] fetch_success trace=${traceId} key=${cacheKey} source=${source.name}`)
        }
        return payload
      }
      catch (error) {
        const steamError = mapUnknownToSteamError(error)
        lastError = steamError
        steamFetchMetrics.steam_fetch_fail_total[steamError.code] = (steamFetchMetrics.steam_fetch_fail_total[steamError.code] ?? 0) + 1
        steamFetchMetrics.steam_fetch_fail_by_source[source.name] += 1
        markCircuitFailure()
        const shouldRetry = isRetryableSteamError(steamError) && attempt < FETCH_RETRY_TIMES
        if (!shouldRetry) {
          break
        }
        const retryAfter = steamError.retryAfterMs ?? 0
        const jitter = Math.floor(Math.random() * 100)
        const backoff = FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt + jitter
        await waitFor(Math.max(backoff, retryAfter))
      }
    }
  }
  throw (lastError ?? new SteamWorkshopFetchError('STEAM_UPSTREAM_UNAVAILABLE', 'Steam 上游不可用'))
}

function setCacheEntry(cacheKey: string, raw: SteamModRawResult) {
  const now = Date.now()
  steamModCache.set(cacheKey, {
    fetchedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    staleExpiresAt: now + STALE_CACHE_TTL_MS,
    data: raw,
  })
  scheduleCachePersist()
}

async function getOrCreateLiveFetchTask(cacheKey: string, query: NormalizedSteamQuery, traceId: string): Promise<SteamModRawResult> {
  const currentTask = steamModInFlight.get(cacheKey)
  if (currentTask) {
    return await currentTask
  }
  const task = (async () => {
    const raw = await fetchLiveWithPolicy(query, cacheKey, traceId)
    setCacheEntry(cacheKey, raw)
    return raw
  })()
  steamModInFlight.set(cacheKey, task)
  try {
    return await task
  }
  finally {
    steamModInFlight.delete(cacheKey)
  }
}

function scheduleBackgroundRefresh(cacheKey: string, query: NormalizedSteamQuery) {
  if (steamBackgroundRefreshing.has(cacheKey) || steamModInFlight.has(cacheKey)) {
    return
  }
  steamBackgroundRefreshing.add(cacheKey)
  const traceId = randomUUID()
  void getOrCreateLiveFetchTask(cacheKey, query, traceId)
    .catch(() => {
      // 后台刷新失败不影响本次请求
    })
    .finally(() => {
      steamBackgroundRefreshing.delete(cacheKey)
    })
}

export async function fetchDstSteamWorkshopMods(input: {
  keyword?: string
  page?: number
  pageSize?: number
  sort?: string
  trendDays?: number
  subscribedModStatusByWorkshopId: Map<string, ModInstallStatus>
  pendingWorkshopIds?: Set<string>
}): Promise<SteamModListQueryResult> {
  loadDiskCacheOnce()
  const query = normalizeQuery(input)
  const pendingWorkshopIds = input.pendingWorkshopIds ?? new Set<string>()
  const subscribedModStatusByWorkshopId = input.subscribedModStatusByWorkshopId
  const cacheKey = createCacheKey(query)
  const traceId = randomUUID()
  const now = Date.now()
  const cacheEntry = steamModCache.get(cacheKey)
  if (cacheEntry && cacheEntry.expiresAt > now) {
    steamFetchMetrics.steam_cache_hit_total.fresh += 1
    return toSteamResult(cacheEntry.data, subscribedModStatusByWorkshopId, pendingWorkshopIds, enrichMeta({
      cached: true,
      stale: false,
      cacheAgeMs: now - cacheEntry.fetchedAt,
      source: 'cache-fresh',
      fetchTraceId: traceId,
    }, cacheEntry.data.upstreamSource))
  }
  if (cacheEntry && cacheEntry.staleExpiresAt > now) {
    steamFetchMetrics.steam_cache_hit_total.stale += 1
    scheduleBackgroundRefresh(cacheKey, query)
    return toSteamResult(cacheEntry.data, subscribedModStatusByWorkshopId, pendingWorkshopIds, enrichMeta({
      cached: true,
      stale: true,
      cacheAgeMs: now - cacheEntry.fetchedAt,
      source: 'cache-stale',
      fetchTraceId: traceId,
    }, cacheEntry.data.upstreamSource))
  }
  steamFetchMetrics.steam_cache_hit_total.miss += 1
  try {
    const liveData = await getOrCreateLiveFetchTask(cacheKey, query, traceId)
    return toSteamResult(liveData, subscribedModStatusByWorkshopId, pendingWorkshopIds, enrichMeta({
      cached: false,
      stale: false,
      cacheAgeMs: 0,
      source: 'live',
      fetchTraceId: traceId,
    }, liveData.upstreamSource))
  }
  catch (error) {
    const stale = steamModCache.get(cacheKey)
    if (stale && stale.staleExpiresAt > Date.now()) {
      const steamError = mapUnknownToSteamError(error)
      return toSteamResult(stale.data, subscribedModStatusByWorkshopId, pendingWorkshopIds, enrichMeta({
        cached: true,
        stale: true,
        cacheAgeMs: Date.now() - stale.fetchedAt,
        source: 'cache-stale',
        retryAfterMs: steamError.retryAfterMs,
        fetchTraceId: traceId,
      }, stale.data.upstreamSource))
    }
    return buildDegradedEmptySteamResult(
      query,
      subscribedModStatusByWorkshopId,
      pendingWorkshopIds,
      mapUnknownToSteamError(error),
      traceId,
    )
  }
}

/** 面板启动后后台预热默认 Mod 市场列表（sort=trend, page=1） */
export function scheduleWarmSteamWorkshopModCache(): void {
  if (process.env.GSH_STEAM_WORKSHOP_WARM_CACHE === '0') {
    return
  }
  loadDiskCacheOnce()
  const query = normalizeQuery({
    keyword: '',
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    sort: DEFAULT_SORT,
    trendDays: DEFAULT_TREND_DAYS,
  })
  const cacheKey = createCacheKey(query)
  const entry = steamModCache.get(cacheKey)
  const now = Date.now()
  if (entry && entry.expiresAt > now) {
    return
  }
  scheduleBackgroundRefresh(cacheKey, query)
}

export async function fetchWorkshopPreviewImages(workshopIds: string[]): Promise<Map<string, string | null>> {
  const uniqueIds = [...new Set(workshopIds.map(id => id.trim()).filter(Boolean))]
  const result = new Map<string, string | null>()
  if (uniqueIds.length === 0) {
    return result
  }
  try {
    const items = await requestPublishedFileDetails(uniqueIds, { locale: DEFAULT_MOD_CONTENT_LOCALE })
    for (const item of items) {
      const workshopId = item.publishedfileid?.trim()
      if (!workshopId) {
        continue
      }
      result.set(workshopId, item.preview_url?.trim() || null)
    }
  }
  catch {
    // 补图失败不影响主流程
  }
  for (const workshopId of uniqueIds) {
    if (!result.has(workshopId)) {
      result.set(workshopId, null)
    }
  }
  return result
}

export async function fetchWorkshopRatings(workshopIds: string[]): Promise<Map<string, number | null>> {
  const uniqueIds = [...new Set(workshopIds.map(id => id.trim()).filter(Boolean))]
  const result = new Map<string, number | null>()
  if (uniqueIds.length === 0) {
    return result
  }
  const now = Date.now()
  const missingIds: string[] = []
  for (const workshopId of uniqueIds) {
    const cached = workshopRatingCache.get(workshopId)
    if (cached && cached.expiresAt > now) {
      result.set(workshopId, cached.rating)
    }
    else {
      missingIds.push(workshopId)
    }
  }
  if (missingIds.length === 0) {
    return result
  }
  const apiKey = process.env.GSH_STEAM_WEBAPI_KEY?.trim() || ''
  if (apiKey) {
    try {
      const fromGetDetails = await fetchWorkshopRatingsByGetDetails(missingIds)
      for (const [workshopId, rating] of fromGetDetails) {
        if (rating !== null) {
          result.set(workshopId, rating)
          workshopRatingCache.set(workshopId, { rating, expiresAt: now + WORKSHOP_RATING_CACHE_TTL_MS })
        }
      }
    }
    catch {
      // fallback below
    }
  }
  const stillMissingIds = missingIds.filter(workshopId => !result.has(workshopId))
  if (stillMissingIds.length > 0) {
    try {
      const items = await requestPublishedFileDetails(stillMissingIds, { locale: DEFAULT_MOD_CONTENT_LOCALE })
      for (const item of items) {
        const workshopId = item.publishedfileid?.trim()
        if (!workshopId) {
          continue
        }
        const rating = resolveItemRating(item)
        if (rating !== null) {
          result.set(workshopId, rating)
          workshopRatingCache.set(workshopId, { rating, expiresAt: now + WORKSHOP_RATING_CACHE_TTL_MS })
        }
      }
    }
    catch {
      // 评分补全失败不影响主流程
    }
  }
  for (const workshopId of uniqueIds) {
    if (!result.has(workshopId)) {
      result.set(workshopId, null)
      workshopRatingCache.set(workshopId, { rating: null, expiresAt: now + WORKSHOP_RATING_CACHE_TTL_MS })
    }
  }
  return result
}

export function getSteamWorkshopMetricsSnapshot(): Readonly<SteamFetchMetrics> {
  return {
    steam_fetch_success_total: steamFetchMetrics.steam_fetch_success_total,
    steam_fetch_success_by_source: { ...steamFetchMetrics.steam_fetch_success_by_source },
    steam_fetch_fail_total: { ...steamFetchMetrics.steam_fetch_fail_total },
    steam_fetch_fail_by_source: { ...steamFetchMetrics.steam_fetch_fail_by_source },
    steam_fetch_latency_ms: [...steamFetchMetrics.steam_fetch_latency_ms],
    steam_cache_hit_total: { ...steamFetchMetrics.steam_cache_hit_total },
    steam_circuit_open_total: steamFetchMetrics.steam_circuit_open_total,
    steam_last_success_source: steamFetchMetrics.steam_last_success_source,
    steam_last_success_at: steamFetchMetrics.steam_last_success_at,
  }
}

function resetSteamWorkshopRuntimeForTests() {
  steamModCache.clear()
  steamModInFlight.clear()
  steamBackgroundRefreshing.clear()
  workshopDetailCache.clear()
  workshopRatingCache.clear()
  perKeyRequestBuckets.clear()
  globalRequestBucket.length = 0
  steamCircuitState.failedCount = 0
  steamCircuitState.openUntil = 0
  if (diskPersistTimer) {
    clearTimeout(diskPersistTimer)
    diskPersistTimer = null
  }
}

export const __steamWorkshopTestUtils = {
  buildPowerShellWorkshopFetchScript,
  sanitizeSteamUserFacingMessage,
  parseWorkshopItems,
  detectHasMoreFromHtml,
  resolveHtmlPaginationMeta,
  resolvePaginationTotals,
  extractSsrWorkshopBrowseData,
  isKnownEmptyWorkshopBrowse,
  createCacheKey,
  normalizeQuery,
  normalizeSort,
  resolveQueryType,
  resolveBrowseSort,
  buildBrowseUrl,
  mapUnknownToSteamError,
  mapPublishedFileDetailToDto,
  parseSteamPersonaNameFromCommunityXml,
  resolveModLocalizedText,
  normalizeSteamRatingScore,
  resolveItemRating,
  parseLegacyWorkshopItemRating,
  enrichWorkshopItemRatings,
  clearWorkshopDetailCache: () => {
    workshopDetailCache.clear()
  },
  clearSteamModListCache: () => {
    steamModCache.clear()
    steamModInFlight.clear()
    steamBackgroundRefreshing.clear()
  },
  resetRuntimeForTests: resetSteamWorkshopRuntimeForTests,
}
