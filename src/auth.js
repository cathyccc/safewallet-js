import crypto from 'node:crypto';

/**
 * Pulls the token out of "Authorization: Bearer <token>".
 * Returns null if the header is missing or malformed.
 */
export function extractBearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+([A-Za-z0-9._~+/=-]{1,512})$/);
  return match ? match[1] : null;
}

/**
 * Constant-time comparison of two tokens.
 * Plain `a === b` returns faster when the first characters differ, which
 * can leak the token one character at a time (timing attack).
 * Hashing first makes both buffers the same length, which timingSafeEqual requires.
 */
export function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
