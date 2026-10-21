# SafeWallet API

A minimal micro-banking ledger: **accounts** hold a balance, and **POST /transfer** moves money between them, secured against the OWASP Top 10.

```
safewallet-api/
├── supabase/schema.sql              # tables, RLS, atomic transfer function
├── src/
│   ├── server.js                    # starts the server
│   ├── app.js                       # Express app + POST /transfer
│   ├── supabase.js                  # supabase-js client (server-side)
│   ├── validation.js                # input validation rules
│   └── auth.js                      # bearer token parsing + constant-time compare
├── tests/transfer.security.test.js  # vitest security suite (runs against Supabase)
├── vitest.config.js
├── package.json
├── .env.example
└── .gitignore
```

---

## 1. Setup

1. **Create a Supabase project** at supabase.com.
2. **Create the schema:** Dashboard → SQL Editor → paste all of `supabase/schema.sql` → Run. This creates `accounts`, `transfers`, the `transfer_funds` function, and demo accounts Alice ($500) and Bob ($100).
3. **Configure env vars:**
   ```bash
   cp .env.example .env
   ```
   Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API). Optionally add `SUPABASE_ANON_KEY` to enable the RLS test.
4. **Install and run:**
   ```bash
   npm install
   npm run dev
   ```
5. **Try a transfer.** Get the demo tokens with `select id, name, api_token from accounts;` in the SQL editor, then:
   ```bash
   curl -X POST http://localhost:3000/transfer \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <ALICE_API_TOKEN>" \
     -d '{"from_account_id":"<ALICE_ID>","to_account_id":"<BOB_ID>","amount":50}'
   ```
6. **Run the security tests:** `npm test` (creates and deletes its own throwaway accounts).

---

## 2. API

### `POST /transfer`

| | |
|---|---|
| Header | `Authorization: Bearer <sender's api_token>` |
| Body | `{ "from_account_id": "<uuid>", "to_account_id": "<uuid>", "amount": 50 }` |

| Status | Meaning |
|---|---|
| 200 | Transfer done; returns sender's new balance |
| 400 | Invalid input (bad amount, bad UUID, extra fields, same account, bad JSON) |
| 401 | Authorization header missing or malformed |
| 403 | Token doesn't belong to the sender (or sender doesn't exist) |
| 404 | Recipient account not found |
| 422 | Insufficient funds |
| 429 | Rate limit exceeded |

---

## 3. OWASP Top 10 security guide

### ✅ Required check 1 — Input validation (A03: Injection)

**Threat:** sending `amount: -500` from Alice to Bob would *add* $500 to Alice. Strings like `"50"` or `"abc"` can be silently coerced or cause DB errors.

**Implementation** (`src/validation.js`, `validateAmount`): the amount must be

- a real JSON **number**, `typeof amount === 'number'`, so `"50"`, `null`, `true`, arrays and objects are rejected;
- **finite** (`Number.isFinite`), so no `NaN`/`Infinity`;
- **greater than 0**, so negatives and zero are rejected;
- at most **2 decimal places** (whole cents);
- no larger than `MAX_TRANSFER_AMOUNT`.

Account IDs must be valid UUIDs, the sender and receiver must differ, and unknown body fields (e.g. `"balance": 1000000`) are rejected.

**Defence in depth:** even if the API check were bypassed, the database refuses it: `transfer_funds` re-checks `p_amount > 0`, the `transfers.amount` column has `check (amount > 0)`, and `accounts.balance` has `check (balance >= 0)`. supabase-js also sends values as parameters, never as concatenated SQL.

### ✅ Required check 2 — Authorization header matches sender (A01: Broken Access Control)

**Threat:** Bob has a valid token. Without an ownership check, Bob could send `from_account_id: <Alice>` and drain her account. Authentication ("is this a real token?") is not authorization ("is this *your* account?").

**Implementation** (`src/app.js` step 3 + `src/auth.js`):

1. Parse `Authorization: Bearer <token>`; missing/malformed → **401**.
2. Load the **sender's** row from Supabase by `from_account_id`.
3. Compare the header token with the sender's `api_token` using `crypto.timingSafeEqual` (via SHA-256 so lengths match). A normal `===` compare leaks timing information an attacker can use to guess the token character by character.
4. No match → **403**. The same 403 and message are returned when the sender doesn't exist, so the endpoint can't be used to discover valid account IDs.

### Other OWASP categories covered

| OWASP 2021 | What the project does |
|---|---|
| **A01 Broken Access Control** | Row Level Security is **on with no policies** for `accounts` and `transfers`, so the public anon key can read nothing (including tokens). Only the server's service role key has access. `transfer_funds` is executable only by `service_role`. |
| **A02 Cryptographic Failures** | Tokens are 256-bit random values (`gen_random_bytes(32)`). Secrets live in `.env`, which is git-ignored. Tokens are never returned in responses. |
| **A04 Insecure Design** | Money moves in one Postgres function with `SELECT … FOR UPDATE` row locks, so parallel requests can't double-spend (tested: 10 parallel $100 transfers from $500 → exactly 5 succeed). Body size capped at 10 kb; max transfer limit. |
| **A05 Security Misconfiguration** | `helmet` security headers, `X-Powered-By` removed, app refuses to start without env vars, generic 500 errors with no stack traces or SQL details. |
| **A07 Auth Failures** | Rate limiting on `/transfer` (100 req/min per IP) slows token brute-forcing. |
| **A09 Logging & Monitoring** | Every successful transfer is written to the `transfers` audit table; unexpected errors are logged server-side. |

### Production hardening (next steps)

- **Hash tokens at rest.** Store `sha256(api_token)` instead of the raw token, then hash the incoming header and compare. A database leak then doesn't expose usable tokens.
- **Use HTTPS only** (handled by your host, e.g. Render, Fly, Railway).
- **Token rotation/expiry**, plus an endpoint to revoke a token.
- **Idempotency keys** (`Idempotency-Key` header) so a retried request can't send money twice.
- **Run `npm audit`** regularly (A06: Vulnerable Components).
- Point tests at a **separate Supabase project** rather than production.

---

## 4. What the tests check

`tests/transfer.security.test.js`:

- **Input validation:** negative, zero, string, `null`, boolean, array, object, 3-decimal, over-limit, `Infinity`, missing amount, SQL-injection-style IDs, self-transfer, extra fields, insufficient funds. Every rejected case also asserts **no money moved**.
- **Access control:** no header (401), malformed header (401), random token (403), **Bob's valid token on Alice's account** (403), truncated token (403), nonexistent sender gets the same 403, tokens never leak.
- **Race condition:** parallel transfers can't overdraw.
- **Misconfiguration:** no `X-Powered-By`, helmet headers present, broken JSON gives a clean 400.
- **RLS:** anon key can't read `api_token` (when `SUPABASE_ANON_KEY` is set).
