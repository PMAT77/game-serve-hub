import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'
import {
  __steamWorkshopTestUtils,
  fetchDstSteamWorkshopMods,
  fetchWorkshopFileDetail,
  getSteamWorkshopMetricsSnapshot,
} from './steam-workshop.ts'

const originalFetch = globalThis.fetch
const testDir = path.dirname(fileURLToPath(import.meta.url))
const steamSampleHtmlPath = path.resolve(testDir, '../../../scripts/steam-sample.html')

function createSteamWorkshopHtml(page = 1, withRating = false): string {
  const nextPage = page + 1
  const ratingMarkup = withRating
    ? '<div class="fileRating" data-tooltip-html="&lt;b&gt;Positive ratings&lt;/b&gt;&lt;br&gt;80% of the 100 ratings are positive"></div>'
    : ''
  return `
  <div id="searchResultsRows">
    <div class="workshopItem" data-publishedfileid="1234567890">
      <a href="https://steamcommunity.com/sharedfiles/filedetails/?id=1234567890">
        <img class="workshopItemPreviewImage" src="https://example.com/a.png">
      </a>
      <div class="workshopItemTitle">Test &amp; Mod</div>
      ${ratingMarkup}
    </div></div>
  </div>
  <div class="workshopBrowsePagingControls">
    <a href="https://steamcommunity.com/workshop/browse/?appid=322330&p=${nextPage}">Next</a>
  </div>
  `
}

function createSsrWorkshopHtml(): string {
  const queryData = JSON.stringify({
    queries: [{
      state: {
        data: {
          current_page: 1,
          total_pages: 3,
          total_count: 2,
          next_cursor: 'abc',
          results: [
            {
              publishedfileid: '3733207761',
              title: 'SSR Test Mod',
              preview_url: 'https://example.com/ssr.png',
              star_rating: 4,
              total_votes: 44,
            },
            {
              publishedfileid: '3732945756',
              title: 'Another SSR Mod',
              preview_url: '',
            },
          ],
        },
      },
    }],
  })
  const payload = JSON.stringify({
    queryData,
  })
  const escaped = JSON.stringify(payload).slice(1, -1)
  return `<html><body><script>JSON.parse("${escaped}")</script></body></html>`
}

afterEach(() => {
  globalThis.fetch = originalFetch
  __steamWorkshopTestUtils.resetRuntimeForTests()
})

describe('steam workshop parser', () => {
  it('parses legacy item and detects next page', () => {
    const html = createSteamWorkshopHtml(1)
    const items = __steamWorkshopTestUtils.parseWorkshopItems(html)
    assert.equal(items.length, 1)
    assert.equal(items[0].workshopId, '1234567890')
    assert.equal(items[0].title, 'Test & Mod')
    assert.equal(__steamWorkshopTestUtils.detectHasMoreFromHtml(html, 1, 20), true)
  })

  it('parses SSR embedded workshop results', () => {
    const html = createSsrWorkshopHtml()
    const items = __steamWorkshopTestUtils.parseWorkshopItems(html)
    assert.equal(items.length, 2)
    assert.equal(items[0].workshopId, '3733207761')
    assert.equal(items[0].title, 'SSR Test Mod')
    assert.equal(items[0].previewImage, 'https://example.com/ssr.png')
    assert.equal(items[0].rating, 4)
    assert.equal(items[0].detailUrl, 'https://steamcommunity.com/sharedfiles/filedetails/?id=3733207761')
    const pagination = __steamWorkshopTestUtils.resolveHtmlPaginationMeta(html, 1, 20)
    assert.equal(pagination.totalCount, 2)
    assert.equal(pagination.totalPages, 3)
    assert.equal(pagination.hasMore, true)
    assert.equal(__steamWorkshopTestUtils.detectHasMoreFromHtml(html, 1, 20), true)
    assert.equal(__steamWorkshopTestUtils.resolveHtmlPaginationMeta(html, 3, 20).hasMore, false)
  })

  it('derives totalPages from totalCount when upstream pages missing', () => {
    const totals = __steamWorkshopTestUtils.resolvePaginationTotals({
      page: 1,
      pageSize: 20,
      totalCount: 1965,
      totalPages: null,
    })
    assert.equal(totals.totalPages, 99)
    assert.equal(totals.hasMore, true)
  })

  it('cache key includes schema version and page size', () => {
    const key = __steamWorkshopTestUtils.createCacheKey(__steamWorkshopTestUtils.normalizeQuery({
      keyword: '',
      page: 2,
      pageSize: 20,
      sort: 'trend',
      trendDays: 7,
    }))
    const parsed = JSON.parse(key) as { schemaVersion?: number, pageSize?: number, page?: number }
    assert.equal(parsed.schemaVersion, 8)
    assert.equal(parsed.pageSize, 20)
    assert.equal(parsed.page, 2)
  })

  it('normalizes relevance sort and maps to ranked-by-text-search query type', () => {
    assert.equal(__steamWorkshopTestUtils.normalizeSort('relevance'), 'relevance')
    assert.equal(__steamWorkshopTestUtils.resolveQueryType('relevance'), 12)
    assert.equal(__steamWorkshopTestUtils.resolveQueryType('mostrecent'), 1)
    assert.equal(__steamWorkshopTestUtils.resolveQueryType('totaluniquesubscribers'), 9)
    assert.equal(__steamWorkshopTestUtils.resolveQueryType('trend'), 3)
  })

  it('maps relevance browse sort to Steam textsearch URL parameter', () => {
    assert.equal(__steamWorkshopTestUtils.resolveBrowseSort('relevance'), 'textsearch')
    assert.equal(__steamWorkshopTestUtils.resolveBrowseSort('trend'), 'trend')
    const url = __steamWorkshopTestUtils.buildBrowseUrl('backpack', 1, 20, 'relevance', 7)
    assert.match(url, /browsesort=textsearch/)
    assert.match(url, /actualsort=textsearch/)
    assert.match(url, /searchtext=backpack/)
    assert.doesNotMatch(url, /requiredtags/)
  })

  it('parses real Steam SSR sample when available', () => {
    if (!fs.existsSync(steamSampleHtmlPath)) {
      return
    }
    const html = fs.readFileSync(steamSampleHtmlPath, 'utf8')
    const items = __steamWorkshopTestUtils.parseWorkshopItems(html)
    assert.ok(items.length > 0)
    assert.equal(typeof items[0].workshopId, 'string')
    assert.equal(typeof items[0].title, 'string')
    assert.equal(__steamWorkshopTestUtils.detectHasMoreFromHtml(html, 1, 20), true)
    assert.equal(__steamWorkshopTestUtils.isKnownEmptyWorkshopBrowse(html), false)
  })

  it('parses legacy item rating from fileRating tooltip', () => {
    const html = createSteamWorkshopHtml(1, true)
    const items = __steamWorkshopTestUtils.parseWorkshopItems(html)
    assert.equal(items.length, 1)
    assert.equal(items[0].rating, 4)
  })

  it('enriches missing ratings via GetDetails when api key is set', async () => {
    const previousKey = process.env.GSH_STEAM_WEBAPI_KEY
    process.env.GSH_STEAM_WEBAPI_KEY = 'test-key'
    try {
      globalThis.fetch = async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('GetDetails')) {
          assert.ok(url.includes('includevotes=true'))
          return new Response(JSON.stringify({
            response: {
              publishedfiledetails: [{
                publishedfileid: '1234567890',
                title: 'Rated Mod',
                vote_data: { score: 0.9 },
              }],
            },
          }), { status: 200 })
        }
        return new Response('', { status: 404 })
      }
      const items = [{
        workshopId: '1234567890',
        title: 'Rated Mod',
        previewImage: null,
        detailUrl: 'https://example.com',
        rating: null,
      }]
      await __steamWorkshopTestUtils.enrichWorkshopItemRatings(items)
      assert.equal(items[0].rating, 4.5)
    }
    finally {
      if (previousKey === undefined) {
        delete process.env.GSH_STEAM_WEBAPI_KEY
      }
      else {
        process.env.GSH_STEAM_WEBAPI_KEY = previousKey
      }
    }
  })
})

describe('fetchDstSteamWorkshopMods', () => {
  it('retries on 429 and eventually returns live payload', async () => {
    const uniqueKeyword = `retry-${Date.now()}`
    let requestCount = 0
    globalThis.fetch = async () => {
      requestCount += 1
      if (requestCount === 1) {
        return new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })
      }
      return new Response(createSteamWorkshopHtml(1), { status: 200 })
    }
    const result = await fetchDstSteamWorkshopMods({
      keyword: uniqueKeyword,
      page: 1,
      pageSize: 20,
      sort: 'trend',
      trendDays: 7,
      installedWorkshopIds: new Set<string>(),
    })
    assert.ok(requestCount >= 2)
    assert.equal(result.meta.source, 'live')
    assert.equal(result.meta.upstreamSource, 'html')
    assert.equal(result.meta.cached, false)
    assert.equal(result.items.length, 1)
  })

  it('exposes metrics snapshot structure', () => {
    const snapshot = getSteamWorkshopMetricsSnapshot()
    assert.equal(typeof snapshot.steam_fetch_success_total, 'number')
    assert.equal(typeof snapshot.steam_fetch_success_by_source.html, 'number')
    assert.equal(typeof snapshot.steam_cache_hit_total.fresh, 'number')
    assert.equal(typeof snapshot.steam_circuit_open_total, 'number')
  })

  it('returns degraded empty result when live fetch fails without cache', async () => {
    __steamWorkshopTestUtils.clearSteamModListCache()
    const keyword = `degraded-${Date.now()}`
    globalThis.fetch = async () => new Response('upstream down', { status: 503 })
    const result = await fetchDstSteamWorkshopMods({
      keyword,
      page: 1,
      pageSize: 20,
      sort: 'trend',
      trendDays: 7,
      installedWorkshopIds: new Set<string>(),
    })
    assert.equal(result.items.length, 0)
    assert.equal(result.meta.upstreamUnavailable, true)
    assert.ok(result.meta.upstreamMessage)
    assert.equal(result.meta.steamErrorCode, 'STEAM_UPSTREAM_UNAVAILABLE')
  })
})

describe('resolveModLocalizedText', () => {
  it('prefers zh-CN when available', () => {
    const resolved = __steamWorkshopTestUtils.resolveModLocalizedText({
      'zh-CN': '中文描述',
      'en-US': 'English description',
    }, 'zh-CN')
    assert.equal(resolved.value, '中文描述')
    assert.equal(resolved.contentLocale, 'zh-CN')
  })

  it('falls back to en-US when zh-CN missing', () => {
    const resolved = __steamWorkshopTestUtils.resolveModLocalizedText({
      'en-US': 'English only',
    }, 'zh-CN')
    assert.equal(resolved.value, 'English only')
    assert.equal(resolved.contentLocale, 'en-US')
  })

  it('returns empty string when map has no content', () => {
    const resolved = __steamWorkshopTestUtils.resolveModLocalizedText({}, 'zh-CN')
    assert.equal(resolved.value, '')
    assert.equal(resolved.contentLocale, 'zh-CN')
  })
})

describe('fetchWorkshopFileDetail', () => {
  it('maps published file detail fields', () => {
    const dto = __steamWorkshopTestUtils.mapPublishedFileDetailToDto({
      publishedfileid: '1234567890',
      result: 1,
      title: 'Test Mod',
      description: 'A test mod description',
      preview_url: 'https://example.com/preview.png',
      file_size: 2048,
      time_created: 1_700_000_000,
      time_updated: 1_800_000_000,
      tags: [{ tag: 'server_only_mod' }, { tag: 'Mod' }],
    })
    assert.equal(dto.workshopId, '1234567890')
    assert.equal(dto.title, 'Test Mod')
    assert.equal(dto.description, 'A test mod description')
    assert.equal(dto.previewImage, 'https://example.com/preview.png')
    assert.equal(dto.fileSize, 2048)
    assert.deepEqual(dto.tags, ['server_only_mod', 'Mod'])
    assert.equal(dto.publishedAt, new Date(1_700_000_000 * 1000).toISOString())
    assert.equal(dto.updatedAt, new Date(1_800_000_000 * 1000).toISOString())
    assert.equal(dto.detailUrl, 'https://steamcommunity.com/sharedfiles/filedetails/?id=1234567890')
    assert.equal(dto.creatorName, null)
    assert.equal(dto.contentLocale, 'zh-CN')
    assert.equal(dto.titles['zh-CN'], 'Test Mod')
    assert.equal(dto.descriptions['zh-CN'], 'A test mod description')
  })

  it('parses creator name from community profile xml', () => {
    const name = __steamWorkshopTestUtils.parseSteamPersonaNameFromCommunityXml(
      '<?xml version="1.0"?><profile><steamID><![CDATA[Mod Author]]></steamID></profile>',
    )
    assert.equal(name, 'Mod Author')
  })

  it('fetches detail from Steam API and uses cache', async () => {
    __steamWorkshopTestUtils.clearWorkshopDetailCache()
    let requestCount = 0
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requestCount += 1
      const url = String(input)
      if (url.includes('GetPlayerSummaries')) {
        return new Response(JSON.stringify({
          response: {
            players: [{ personaname: 'Workshop Creator' }],
          },
        }), { status: 200 })
      }
      if (url.includes('steamcommunity.com/profiles/')) {
        return new Response('', { status: 404 })
      }
      const headers = init?.headers
      let acceptLanguage = ''
      if (headers instanceof Headers) {
        acceptLanguage = headers.get('Accept-Language') ?? ''
      }
      else if (headers && typeof headers === 'object') {
        acceptLanguage = String((headers as Record<string, string>)['Accept-Language'] ?? '')
      }
      const isEnglish = acceptLanguage.startsWith('en-US')
      return new Response(JSON.stringify({
        response: {
          publishedfiledetails: [{
            publishedfileid: '9876543210',
            result: 1,
            creator: '76561198987654321',
            title: isEnglish ? 'English Mod' : '中文 Mod',
            description: isEnglish ? 'English body' : '中文描述',
            preview_url: 'https://example.com/cached.png',
            file_size: 4096,
            time_created: 1_700_000_000,
            time_updated: 1_800_000_000,
            tags: [{ tag: 'Mod' }],
          }],
        },
      }), { status: 200 })
    }
    const first = await fetchWorkshopFileDetail('9876543210')
    const second = await fetchWorkshopFileDetail('9876543210')
    assert.equal(requestCount, 3)
    assert.equal(first.title, '中文 Mod')
    assert.equal(first.description, '中文描述')
    assert.equal(first.contentLocale, 'zh-CN')
    assert.equal(first.titles['zh-CN'], '中文 Mod')
    assert.equal(first.titles['en-US'], 'English Mod')
    assert.equal(second.title, '中文 Mod')
    assert.equal(first.fileSize, 4096)
    assert.equal(first.creatorName, 'Workshop Creator')
  })

  it('resolves en-US locale from cache without refetch', async () => {
    __steamWorkshopTestUtils.clearWorkshopDetailCache()
    let requestCount = 0
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      requestCount += 1
      const url = String(input)
      if (url.includes('GetPublishedFileDetails')) {
        const headers = init?.headers
        let acceptLanguage = ''
        if (headers instanceof Headers) {
          acceptLanguage = headers.get('Accept-Language') ?? ''
        }
        else if (headers && typeof headers === 'object') {
          acceptLanguage = String((headers as Record<string, string>)['Accept-Language'] ?? '')
        }
        const isEnglish = acceptLanguage.startsWith('en-US')
        return new Response(JSON.stringify({
          response: {
            publishedfiledetails: [{
              publishedfileid: '555',
              result: 1,
              title: isEnglish ? 'English Mod' : '中文 Mod',
              description: isEnglish ? 'English body' : '中文描述',
            }],
          },
        }), { status: 200 })
      }
      return new Response(JSON.stringify({ response: { players: [] } }), { status: 200 })
    }
    await fetchWorkshopFileDetail('555')
    requestCount = 0
    const english = await fetchWorkshopFileDetail('555', 'en-US')
    assert.equal(requestCount, 0)
    assert.equal(english.title, 'English Mod')
    assert.equal(english.description, 'English body')
    assert.equal(english.contentLocale, 'en-US')
  })

  it('throws when mod detail is unavailable', async () => {
    __steamWorkshopTestUtils.clearWorkshopDetailCache()
    globalThis.fetch = async () => new Response(JSON.stringify({
      response: {
        publishedfiledetails: [{
          publishedfileid: '111',
          result: 9,
        }],
      },
    }), { status: 200 })
    await assert.rejects(
      () => fetchWorkshopFileDetail('111'),
      (error: unknown) => error instanceof Error && error.message.includes('Mod 不存在'),
    )
  })

  it('normalizes steam rating score to 0-5 stars', () => {
    assert.equal(__steamWorkshopTestUtils.normalizeSteamRatingScore(0.555555582046508789), 2.8)
    assert.equal(__steamWorkshopTestUtils.normalizeSteamRatingScore(1), 5)
    assert.equal(__steamWorkshopTestUtils.normalizeSteamRatingScore(null), null)
  })

  it('resolves vote_data score to star rating', () => {
    assert.equal(__steamWorkshopTestUtils.resolveItemRating({
      vote_data: { score: 0.8 },
    }), 4)
  })

  it('resolves votes_up and votes_down to star rating', () => {
    assert.equal(__steamWorkshopTestUtils.resolveItemRating({
      vote_data: { votes_up: 80, votes_down: 20 },
    }), 4)
  })

  it('treats star_rating -1 as missing rating', () => {
    assert.equal(__steamWorkshopTestUtils.resolveItemRating({
      star_rating: -1,
    }), null)
  })
})
