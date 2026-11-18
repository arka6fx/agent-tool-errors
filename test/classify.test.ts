import assert from "node:assert/strict"
import { test } from "node:test"

import { KINDS, classify, explain, logFields, messageOf, retryable, statusOf } from "../src/index.ts"

// Made-up failures, shaped like what real apps answer.
const CASES: Array<[unknown, string]> = [
  ["No connected account found for this app", "not_connected"],
  ["invalid_grant: Token has been expired or revoked.", "login"],
  [{ status: 401, message: "Unauthorized" }, "login"],
  ["403 Request had insufficient authentication scopes.", "scope"],
  ["missing_scope: chat:write", "scope"],
  ["quotaExceeded: The request cannot be completed because you have exceeded your quota.", "quota"],
  ["429 dailyLimitExceeded", "quota"],
  ["429 Too Many Requests", "rate_limit"],
  ["(#17) User request limit reached", "rate_limit"],
  [{ status: 429, message: "slow down" }, "rate_limit"],
  ["413 Payload Too Large", "too_large"],
  ["1 validation error for SendEmail\nto\n  Field required", "bad_args"],
  ["Param text is too long.", "bad_args"],
  [{ status: 404, message: "Requested entity was not found." }, "not_found"],
  ["The file does not exist", "not_found"],
  ["403 Forbidden", "forbidden"],
  ["400 Bad Request: malformed date", "bad_request"],
  [new DOMException("The operation timed out.", "TimeoutError"), "timeout"],
  [Object.assign(new Error("aborted"), { name: "AbortError" }), "timeout"],
  ["Request timeout after 30s", "timeout"],
  ["502 Bad Gateway", "server"],
  [{ statusCode: 503, message: "try later" }, "server"],
  [new TypeError("fetch failed", { cause: new Error("ECONNRESET") }), "connection"],
  ["something odd happened", "other"],
  [null, "other"],
]

for (const [input, kind] of CASES) {
  test(`${JSON.stringify(messageOf(input)).slice(0, 60)} is ${kind}`, () => {
    assert.equal(classify(input), kind)
  })
}

test("every kind has a hint and a retry rule", () => {
  for (const [kind, info] of Object.entries(KINDS)) {
    assert.ok(info.hint.length > 10, kind)
    assert.ok(["never", "soon", "tomorrow"].includes(info.retry), kind)
  }
})

test("explain gives the kind with what to do", () => {
  const out = explain("429 Too Many Requests")
  assert.equal(out.kind, "rate_limit")
  assert.equal(out.retry, "soon")
  assert.equal(out.report, false)
})

test("only transient failures are retryable", () => {
  assert.equal(retryable("503 Service Unavailable"), true)
  assert.equal(retryable("quotaExceeded"), false)
  assert.equal(retryable("invalid_grant"), false)
})

test("log fields never carry the message", () => {
  const error = { status: 404, message: "No file named Invoice-Jane-Doe.pdf" }
  const fields = logFields(error)
  assert.deepEqual(fields, { kind: "not_found", status: 404 })
  assert.ok(!JSON.stringify(fields).includes("Jane"))
})

test("messageOf reads nested error shapes", () => {
  assert.equal(messageOf({ error: { message: "nope" } }), "nope")
  assert.equal(messageOf({ detail: "bad" }), "bad")
  assert.match(messageOf(new Error("outer", { cause: "inner" })), /outer inner/)
})

test("statusOf ignores what isn't an HTTP status", () => {
  assert.equal(statusOf({ status: 418 }), 418)
  assert.equal(statusOf({ status: "500" }), null)
  assert.equal(statusOf({ status: 42 }), null)
})
