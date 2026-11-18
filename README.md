# agent-tool-errors

Sort tool and app failures into kinds an AI agent can act on.

When an agent's tool call fails, the model needs to know what to do next: ask the person to reconnect, wait and retry, give up until tomorrow, fix its own arguments, or say what went wrong. Raw error text doesn't tell it that, and logging raw error text leaks the person's data. This library turns any thrown value into one of 14 kinds, each with a retry rule and a hint for the model.

Zero dependencies. TypeScript, runs on Node 22.18+, Cloudflare Workers, Deno and Bun.

## Usage

```ts
import { explain, logFields } from "agent-tool-errors"

try {
  await calendar.createEvent(args)
} catch (error) {
  const { kind, retry, hint } = explain(error)
  console.warn("tool failed", logFields(error)) // { kind, status }: never the message
  return { ok: false, kind, retry, hint } // what the model sees
}
```

## Kinds

| Kind | Retry | Typical cause |
| --- | --- | --- |
| `not_connected` | never | The app was never connected |
| `login` | never | Expired or revoked sign-in, 401 |
| `scope` | never | The connection lacks a permission |
| `quota` | tomorrow | A daily quota is used up |
| `rate_limit` | soon | 429, Meta Graph throttling codes |
| `too_large` | never | 413, an answer too big to pass |
| `bad_args` | never | Schema or validation errors |
| `not_found` | never | 404, wrong id |
| `forbidden` | never | 403 |
| `bad_request` | never | 400, 422 |
| `timeout` | soon | Timeouts and aborts (check before repeating a write) |
| `server` | soon | 5xx |
| `connection` | soon | Network errors, resets |
| `other` | never | Anything else |

Checks run from the most specific to the most general: "403 insufficient scope" is `scope`, not `forbidden`, and a 429 that names a daily quota is `quota`, not `rate_limit`.

`KINDS[kind].report` is true for the kinds worth an alert (timeouts, outages, unknowns); the rest are the person's setup or input.

## API

- `classify(error): FailureKind`
- `explain(error): { kind, retry, report, hint }`
- `retryable(error): boolean`: true when retrying soon can help
- `logFields(error): { kind, status }`: safe to log
- `messageOf(error)`, `statusOf(error)`: read any error shape
- `KINDS`: the table above, to change hints or add your own wording

## Tests

```bash
npm test
```

## License

MIT
