// OWASP A03 (Injection) / input validation.
// Every field is checked for type, format and range BEFORE it reaches the database.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Validates a transfer amount. Returns an error message, or null if valid.
 * Rules:
 *  - must be a JSON number (the string "50" is rejected, no silent coercion)
 *  - must be finite (no NaN / Infinity)
 *  - must be > 0 (no negative or zero transfers, which would reverse the money flow)
 *  - at most 2 decimal places (cents)
 *  - must not exceed the configured maximum
 */
export function validateAmount(amount, max) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return 'amount must be a number';
  }
  if (amount <= 0) {
    return 'amount must be greater than 0';
  }
  // Compare in integer cents to avoid floating point noise (e.g. 0.1 + 0.2).
  if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
    return 'amount can have at most 2 decimal places';
  }
  if (amount > max) {
    return `amount cannot exceed ${max}`;
  }
  return null;
}

/**
 * Validates the whole POST /transfer body.
 * Returns { error } or { value: { fromId, toId, amount } }.
 */
export function validateTransferBody(body, max) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'request body must be a JSON object' };
  }

  // Reject unexpected fields (mass-assignment protection).
  const allowed = new Set(['from_account_id', 'to_account_id', 'amount']);
  const extra = Object.keys(body).filter((k) => !allowed.has(k));
  if (extra.length) {
    return { error: `unexpected field(s): ${extra.join(', ')}` };
  }

  const { from_account_id: fromId, to_account_id: toId, amount } = body;

  if (!isUuid(fromId)) return { error: 'from_account_id must be a valid UUID' };
  if (!isUuid(toId)) return { error: 'to_account_id must be a valid UUID' };
  if (fromId.toLowerCase() === toId.toLowerCase()) {
    return { error: 'cannot transfer to the same account' };
  }

  const amountError = validateAmount(amount, max);
  if (amountError) return { error: amountError };

  return { value: { fromId, toId, amount } };
}
