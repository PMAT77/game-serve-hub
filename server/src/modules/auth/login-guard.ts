import { randomUUID } from 'node:crypto'
import { deleteRateLimitState, getRateLimitState, saveRateLimitState } from '../../shared/db/rate-limit-store'

export interface LoginGuardState {
  failedCount: number
  windowStart: number
  blockedUntil: number
}

export interface LoginGuardOptions {
  maxFailures: number
  captchaThreshold: number
  windowMs: number
  blockMs: number
  captchaTtlMs: number
}

export interface CaptchaChallenge {
  token: string
  question: string
  expiresInSec: number
}

interface CaptchaRecord {
  answer: string
  key: string
  expiresAt: number
}

// 登录失败/封锁状态持久化在 SQLite（重启不清零）；验证码挑战短生命周期，保持内存态
const captchaRecordMap = new Map<string, CaptchaRecord>()

function nowMs() {
  return Date.now()
}

function getDefaultState(now: number): LoginGuardState {
  return {
    failedCount: 0,
    windowStart: now,
    blockedUntil: 0,
  }
}

function ensureActiveWindow(state: LoginGuardState, options: LoginGuardOptions, now: number) {
  if (now - state.windowStart > options.windowMs) {
    state.failedCount = 0
    state.windowStart = now
    state.blockedUntil = 0
  }
}

function clearExpiredCaptchas(now: number) {
  for (const [token, record] of captchaRecordMap.entries()) {
    if (record.expiresAt <= now) {
      captchaRecordMap.delete(token)
    }
  }
}

export function getLoginGuardState(key: string, options: LoginGuardOptions): LoginGuardState {
  const now = nowMs()
  const state = getRateLimitState(key) ?? getDefaultState(now)
  ensureActiveWindow(state, options, now)
  saveRateLimitState(key, state)
  return state
}

export function shouldRequireCaptcha(state: LoginGuardState, options: LoginGuardOptions): boolean {
  return state.failedCount >= options.captchaThreshold
}

export function getBlockRemainingSeconds(state: LoginGuardState): number {
  if (state.blockedUntil <= 0) {
    return 0
  }
  return Math.max(0, Math.ceil((state.blockedUntil - nowMs()) / 1000))
}

export function isBlocked(state: LoginGuardState): boolean {
  return state.blockedUntil > nowMs()
}

export function issueCaptchaChallenge(key: string, options: LoginGuardOptions): CaptchaChallenge {
  const now = nowMs()
  clearExpiredCaptchas(now)
  const left = Math.floor(Math.random() * 10) + 1
  const right = Math.floor(Math.random() * 10) + 1
  const token = randomUUID()
  const expiresAt = now + options.captchaTtlMs
  captchaRecordMap.set(token, {
    key,
    answer: String(left + right),
    expiresAt,
  })
  return {
    token,
    question: `${left} + ${right} = ?`,
    expiresInSec: Math.ceil(options.captchaTtlMs / 1000),
  }
}

export function verifyCaptchaChallenge(
  key: string,
  token: string | undefined,
  answer: string | undefined,
): boolean {
  const now = nowMs()
  clearExpiredCaptchas(now)
  if (!token || !answer) {
    return false
  }
  const record = captchaRecordMap.get(token)
  if (!record) {
    return false
  }
  captchaRecordMap.delete(token)
  if (record.expiresAt <= now || record.key !== key) {
    return false
  }
  return answer.trim() === record.answer
}

export function clearLoginGuardState(key: string) {
  deleteRateLimitState(key)
}

export function recordLoginFailure(key: string, options: LoginGuardOptions): LoginGuardState {
  const now = nowMs()
  const state = getLoginGuardState(key, options)
  state.failedCount += 1
  if (state.failedCount >= options.maxFailures) {
    state.blockedUntil = now + options.blockMs
  }
  saveRateLimitState(key, state)
  return state
}
