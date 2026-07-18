import { randomBytes } from 'node:crypto'

const DEFAULT_TTL_MS = 60_000
const MAX_ACTIVE_TICKETS = 1_000

export interface ConsoleStreamTicketRecord {
  instanceId: string
  userId: string
  expiresAt: number
}

export interface CreateConsoleStreamTicketStoreOptions {
  now?: () => number
  ttlMs?: number
}

export interface IssueConsoleStreamTicketInput {
  instanceId: string
  userId: string
}

export function createConsoleStreamTicketStore(options: CreateConsoleStreamTicketStoreOptions = {}) {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
  const tickets = new Map<string, ConsoleStreamTicketRecord>()

  function removeExpiredTickets(currentTime = now()) {
    for (const [ticket, record] of tickets) {
      if (record.expiresAt <= currentTime) {
        tickets.delete(ticket)
      }
    }
  }

  function issue(input: IssueConsoleStreamTicketInput) {
    removeExpiredTickets()
    if (tickets.size >= MAX_ACTIVE_TICKETS) {
      const oldestTicket = tickets.keys().next().value
      if (oldestTicket) {
        tickets.delete(oldestTicket)
      }
    }

    const ticket = randomBytes(32).toString('base64url')
    const expiresAt = now() + ttlMs
    tickets.set(ticket, {
      instanceId: input.instanceId,
      userId: input.userId,
      expiresAt,
    })
    return { ticket, expiresAt }
  }

  function consume(ticket: string, instanceId: string): ConsoleStreamTicketRecord | null {
    removeExpiredTickets()
    const record = tickets.get(ticket)
    if (!record || record.instanceId !== instanceId) {
      return null
    }
    tickets.delete(ticket)
    return record
  }

  return {
    issue,
    consume,
  }
}

export const consoleStreamTicketStore = createConsoleStreamTicketStore()
