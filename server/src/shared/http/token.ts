export function normalizeRequestToken(tokenHeader: string | string[] | undefined): string {
  if (Array.isArray(tokenHeader)) {
    return tokenHeader[0] ?? ''
  }
  return typeof tokenHeader === 'string' ? tokenHeader : ''
}
