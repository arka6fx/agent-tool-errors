/**
 * Sort a tool or app failure into one kind an agent can act on: ask the person to
 * reconnect, retry soon, retry tomorrow, fix its own arguments, or tell the person.
 *
 * The kind is safe to log. The error text often carries the person's data (a file
 * name, an address, a subject line), so log the kind, never the message.
 */

export type FailureKind =
  | "not_connected"
  | "login"
  | "scope"
  | "quota"
  | "rate_limit"
  | "too_large"
  | "bad_args"
  | "not_found"
  | "forbidden"
  | "bad_request"
  | "timeout"
  | "server"
  | "connection"
  | "other"

/** When trying the same call again can work. */
export type Retry = "never" | "soon" | "tomorrow"

export type KindInfo = {
  /** Whether a retry can help, and when. */
  retry: Retry
  /** Whether the failure is yours to look at (a bug or an outage), not the person's. */
  report: boolean
  /** A short note for the model on what to do next. */
  hint: string
}

export const KINDS: Record<FailureKind, KindInfo> = {
  not_connected: {
    retry: "never",
    report: false,
    hint: "The app isn't connected. Ask the person to connect it, then try again.",
  },
  login: {
    retry: "never",
    report: false,
    hint: "The app's sign-in has expired or was revoked. Ask the person to reconnect it.",
  },
  scope: {
    retry: "never",
    report: false,
    hint: "The connection lacks a permission this call needs. Ask the person to reconnect and allow it.",
  },
  quota: {
    retry: "tomorrow",
    report: false,
    hint: "The app's daily quota is used up. Retrying today will fail again; say when it resets.",
  },
  rate_limit: {
    retry: "soon",
    report: false,
    hint: "The app is rate limiting. Wait a little, then try once more.",
  },
  too_large: {
    retry: "never",
    report: false,
    hint: "The request or answer is too large. Ask for less (a smaller page, fewer items).",
  },
  bad_args: {
    retry: "never",
    report: false,
    hint: "The app rejected the arguments. Check the tool's schema and fix the call.",
  },
  not_found: {
    retry: "never",
    report: false,
    hint: "The item doesn't exist or isn't visible to this account. Check the id.",
  },
  forbidden: {
    retry: "never",
    report: false,
    hint: "This account isn't allowed to do that. Tell the person.",
  },
  bad_request: {
    retry: "never",
    report: false,
    hint: "The app refused the request as invalid. Change the request, don't repeat it.",
  },
  timeout: {
    retry: "soon",
    report: true,
    hint: "The call timed out. It may or may not have happened: check before repeating a write.",
  },
  server: {
    retry: "soon",
    report: true,
    hint: "The app had a server error. Try once more, then tell the person.",
  },
  connection: {
    retry: "soon",
    report: true,
    hint: "The app couldn't be reached. Try once more, then tell the person.",
  },
  other: {
    retry: "never",
    report: true,
    hint: "The call failed. Tell the person what you tried.",
  },
}

/** The text of a thrown value or an error field, whatever its shape. */
export function messageOf(error: unknown): string {
  if (error == null) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) {
    const cause = error.cause === undefined ? "" : ` ${messageOf(error.cause)}`
    return `${error.name}: ${error.message}${cause}`
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    for (const key of ["message", "error", "detail", "error_description"]) {
      const value = record[key]
      if (value != null && value !== error) return messageOf(value)
    }
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

/** An HTTP status carried on the error (`status` or `statusCode`), when there is one. */
export function statusOf(error: unknown): number | null {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>
    for (const key of ["status", "statusCode"]) {
      const value = record[key]
      if (typeof value === "number" && value >= 100 && value <= 599) return value
    }
  }
  return null
}

// Meta's Graph API throttling codes: (#4) app, (#17) user, (#341) application limit.
const GRAPH_THROTTLED = /\(#(?:4|17|341)\)/
// Google's and YouTube's daily limits: retrying soon only fails again.
const DAILY_QUOTA =
  /daily ?limit ?exceeded|quotaexceeded|quota exceeded|exceeded your quota|uploadlimitexceeded/
const LOGIN =
  /invalid_grant|token (?:has been )?(?:expired|revoked)|expired token|unauthenticated|\b401\b|unauthori[sz]ed|re-?authenticate|reconnect/
const SCOPE = /insufficient[a-z ]*scope|missing_scope|required scope|insufficientpermissions/
const NOT_CONNECTED = /not connected|no connected account|no connection found/
const RATE = /rate[ _-]?limit|\b429\b|too many requests|slow down/
const TOO_LARGE = /\b413\b|payload too large|request entity too large|content too large/
const BAD_ARGS =
  /invalid[ _-]?(?:parameter|argument)|validation errors? for|field required|input should be|missing required|is too long|must be one of/
const NOT_FOUND = /\b404\b|not found|notfound|does not exist|no such/
const BAD_REQUEST = /\b(?:400|422)\b|bad request|malformed|unable to parse|not supported/
const FORBIDDEN = /\b403\b|forbidden|permission denied|access denied|not allowed/
const TIMEOUT = /timed? ?out|timeout|deadline exceeded/
const SERVER = /\b5\d\d\b|internal (?:server )?error|server error|service unavailable|bad gateway/
const CONNECTION =
  /connection (?:error|lost|reset|refused)|econnreset|econnrefused|enotfound|fetch failed|socket hang up|network error/

const BY_STATUS: Record<number, FailureKind> = {
  401: "login",
  403: "forbidden",
  404: "not_found",
  408: "timeout",
  413: "too_large",
  422: "bad_args",
  429: "rate_limit",
}

/**
 * One kind for a failure. The checks run from the most specific to the most general, so
 * "403 insufficient scope" is `scope`, not `forbidden`, and a 429 that names a daily
 * quota is `quota`, not `rate_limit`.
 */
export function classify(error: unknown): FailureKind {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "timeout"
  }
  const low = messageOf(error).toLowerCase()
  if (NOT_CONNECTED.test(low)) return "not_connected"
  if (SCOPE.test(low)) return "scope"
  if (DAILY_QUOTA.test(low)) return "quota"
  if (RATE.test(low) || GRAPH_THROTTLED.test(low)) return "rate_limit"
  if (TOO_LARGE.test(low)) return "too_large"
  if (BAD_ARGS.test(low)) return "bad_args"
  if (LOGIN.test(low)) return "login"
  const status = statusOf(error)
  if (status !== null && BY_STATUS[status]) return BY_STATUS[status]
  if (NOT_FOUND.test(low)) return "not_found"
  if (FORBIDDEN.test(low)) return "forbidden"
  if (BAD_REQUEST.test(low) || status === 400) return "bad_request"
  if (TIMEOUT.test(low)) return "timeout"
  if (SERVER.test(low) || (status !== null && status >= 500)) return "server"
  if (CONNECTION.test(low)) return "connection"
  return "other"
}

/** The kind with what to do about it. */
export function explain(error: unknown): KindInfo & { kind: FailureKind } {
  const kind = classify(error)
  return { kind, ...KINDS[kind] }
}

/** Whether retrying soon can help. */
export function retryable(error: unknown): boolean {
  return KINDS[classify(error)].retry === "soon"
}

/** Fields that are safe to log: the kind and status, never the error's text. */
export function logFields(error: unknown): { kind: FailureKind; status: number | null } {
  return { kind: classify(error), status: statusOf(error) }
}
