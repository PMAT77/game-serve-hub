const DEFAULT_APP_TITLE = 'Game Server Hub'

export function resolveAppTitle(rawTitle: unknown = import.meta.env.VITE_APP_TITLE) {
  const normalizedTitle = String(rawTitle ?? '').trim()
  if (!normalizedTitle) {
    return DEFAULT_APP_TITLE
  }
  const normalizedLowerTitle = normalizedTitle.toLowerCase()
  if (normalizedLowerTitle === 'undefined' || normalizedLowerTitle === 'null') {
    return DEFAULT_APP_TITLE
  }
  return normalizedTitle
}

export const APP_TITLE = resolveAppTitle()
