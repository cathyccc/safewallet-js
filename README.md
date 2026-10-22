# SafeWallet API

A small practice banking API. Each account has a balance, and one endpoint, `POST /transfer`, moves money from one account to another.

**The goal of this project is testing, not banking.** The tests check that the API refuses bad requests and never lets one person move another person's money.

## What it does

- Accounts hold a balance. The demo accounts are Alice ($500) and Bob ($100).
- `POST /transfer` moves money between two accounts.
- Every successful transfer is saved in a `transfers` table as a record.

## What the tests check

- **Bad amounts are rejected:** negative, zero, text, empty, too many decimals, and too large.
- **Bad requests are rejected:** invalid account IDs, extra unexpected fields, and sending money to yourself.
- **Login checks work:** a missing or wrong token is refused, and tokens never appear in responses.
- **One user can't touch another user's money:** Bob's valid token can't take money from Alice's account.
- **Balances stay correct:** an account can't go below zero, sending more than the balance is declined, and sending the exact full balance works and leaves the sender at 0.
- **Missing accounts are handled:** a transfer to an account that doesn't exist is refused and no money moves.
- **Transfers are recorded:** every successful transfer is saved in the `transfers` table.
- **Parallel transfers are safe:** 10 transfers of $100 at the same time from a $500 account. Exactly 5 succeed.
- **Basic hardening:** security headers are present, and errors don't reveal internal details.

For every rejected request, the tests also check that **no money moved**.

## How it works (short version)

Bad requests are stopped in two places. The API checks the input first. The database then refuses bad values too (a balance can't go negative, and a transfer amount must be above zero). If one check is missed, the other one still catches it.

## Setup

1. Create a free project at [supabase.com](https://supabase.com).
2. In the Supabase SQL Editor, paste and run `supabase/schema.sql`. This creates the tables and the demo accounts.
3. Copy the settings file and fill it in:
   ```bash
   cp .env.example .env
   ```
   Add your `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (found in Project Settings, then API). Never commit the `.env` file.
4. Install and start:
   ```bash
   npm install
   npm run dev
   ```
5. Run the tests:
   ```bash
   npm test
   ```
   The tests create their own throwaway accounts and delete them afterwards.

## Using the API

**Request:** `POST /transfer`

- Header: `Authorization: Bearer <the sender's token>`
- Body: `{ "from_account_id": "<id>", "to_account_id": "<id>", "amount": 50 }`

**Responses:**

| Status | Meaning |
|---|---|
| 200 | Transfer done. Returns the sender's new balance |
| 400 | Invalid input |
| 401 | Token missing or badly formatted |
| 403 | Token doesn't belong to the sender |
| 404 | Recipient account not found |
| 422 | Not enough money |
| 429 | Too many requests |

## Security checks in plain words

| What could go wrong | What the project does | OWASP category |
|---|---|---|
| A negative amount adds money to the sender | Amounts must be a positive number with at most 2 decimals | Injection / input validation |
| A logged-in user moves someone else's money | The token must belong to the sender's account | Broken access control |
| Two transfers at once overspend an account | The database handles one transfer at a time per account | Insecure design |
| Someone guesses tokens | Long random tokens, plus a limit of 100 requests a minute | Authentication failures |
| Secrets or details leak | Secrets stay in `.env`, and error messages are generic | Security misconfiguration |
| No record of what happened | Every transfer is saved to the `transfers` table | Logging |

## Files

- `src/app.js`: the API and the `/transfer` endpoint
- `src/validation.js`: checks on the request input
- `src/auth.js`: checks the login token
- `supabase/schema.sql`: tables and the transfer function
- `tests/transfer.security.test.js`: the test suite