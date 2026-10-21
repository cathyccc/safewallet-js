import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { validateTransferBody } from './validation.js';
import { extractBearerToken, tokensMatch } from './auth.js';

// Map known database errors (raised in transfer_funds) to safe HTTP responses.
const DB_ERRORS = {
  INSUFFICIENT_FUNDS: { status: 422, error: 'insufficient funds' },
  ACCOUNT_NOT_FOUND: { status: 404, error: 'account not found' },
  INVALID_AMOUNT: { status: 400, error: 'invalid amount' },
  SAME_ACCOUNT: { status: 400, error: 'cannot transfer to the same account' },
};

/**
 * Builds the Express app. The Supabase client is passed in so tests can
 * reuse the same app with their own client.
 */
export function createApp({ supabase, maxTransferAmount = 10000, rateLimitMax = 100 }) {
  const app = express();

  // OWASP A05 (Security Misconfiguration): secure headers, hide framework.
  app.disable('x-powered-by');
  app.use(helmet());

  // OWASP A04 (Insecure Design): cap body size to stop oversized payloads.
  app.use(express.json({ limit: '10kb' }));

  // OWASP A07 (Auth Failures): slow down token guessing / brute force.
  app.use(
    '/transfer',
    rateLimit({ windowMs: 60_000, limit: rateLimitMax, standardHeaders: 'draft-7', legacyHeaders: false })
  );

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.post('/transfer', async (req, res, next) => {
    try {
      // 1. Authentication: a well-formed bearer token must be present.
      const token = extractBearerToken(req.get('authorization'));
      if (!token) {
        return res.status(401).json({ error: 'missing or malformed Authorization header' });
      }

      // 2. Input validation (OWASP A03): reject bad types, negatives, zero, NaN, etc.
      const { error, value } = validateTransferBody(req.body, maxTransferAmount);
      if (error) {
        return res.status(400).json({ error });
      }
      const { fromId, toId, amount } = value;

      // 3. Access control (OWASP A01): the token must belong to the SENDER.
      //    Having *a* valid token is not enough; it must be the from-account's own token.
      const { data: sender, error: lookupError } = await supabase
        .from('accounts')
        .select('id, api_token')
        .eq('id', fromId)
        .maybeSingle();

      if (lookupError) throw lookupError;

      // Same response whether the account doesn't exist or the token is wrong,
      // so attackers can't use this endpoint to discover which account IDs exist.
      if (!sender || !tokensMatch(token, sender.api_token)) {
        return res.status(403).json({ error: 'not authorized to transfer from this account' });
      }

      // 4. Move the money atomically inside Postgres (row locks + balance check).
      const { data, error: rpcError } = await supabase.rpc('transfer_funds', {
        p_from: fromId,
        p_to: toId,
        p_amount: amount,
      });

      if (rpcError) {
        const known = Object.keys(DB_ERRORS).find((code) => rpcError.message?.includes(code));
        if (known) {
          const { status, error: msg } = DB_ERRORS[known];
          return res.status(status).json({ error: msg });
        }
        throw rpcError;
      }

      const row = Array.isArray(data) ? data[0] : data;
      return res.status(200).json({
        status: 'success',
        from_account_id: fromId,
        to_account_id: toId,
        amount,
        from_balance: Number(row.from_balance),
      });
    } catch (err) {
      next(err);
    }
  });

  app.use((_req, res) => res.status(404).json({ error: 'not found' }));

  // OWASP A09/A05: log details server-side, return a generic message to the client
  // (no stack traces, SQL errors or table names leaked).
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid JSON body' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'request body too large' });
    }
    console.error('[safewallet] unhandled error:', err.message);
    return res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
