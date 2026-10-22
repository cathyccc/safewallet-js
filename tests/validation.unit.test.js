import { describe, it, expect } from 'vitest';
import { isUuid, validateAmount, validateTransferBody } from '../src/validation.js';

const MAX = 10000;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('isUuid', () => {
  it('accepts a valid UUID, in either case', () => {
    expect(isUuid(A)).toBe(true);
    expect(isUuid(A.toUpperCase())).toBe(true);
  });
  it.each([["' OR 1=1 --"], [123], [undefined]])('rejects %s', (value) => {
    expect(isUuid(value)).toBe(false);
  });
});

describe('validateAmount', () => {
  it.each([[1], [0.01], [12.34], [499.99], [MAX]])('accepts %s', (amount) => {
    expect(validateAmount(amount, MAX)).toBeNull();
  });

  it.each([
    [-1, /greater than 0/],
    [0, /greater than 0/],
    ['50', /must be a number/],
    [null, /must be a number/],
    [NaN, /must be a number/],
    [Infinity, /must be a number/],
    [10.555, /2 decimal places/],
    [MAX + 0.01, /cannot exceed/],
  ])('rejects %s', (amount, message) => {
    expect(validateAmount(amount, MAX)).toMatch(message);
  });
});

describe('validateTransferBody', () => {
  it('returns the parsed values for a valid body', () => {
    const result = validateTransferBody({ from_account_id: A, to_account_id: B, amount: 50 }, MAX);
    expect(result).toEqual({ value: { fromId: A, toId: B, amount: 50 } });
  });

  it('rejects unexpected fields', () => {
    const result = validateTransferBody({ from_account_id: A, to_account_id: B, amount: 50, balance: 1 }, MAX);
    expect(result.error).toMatch(/unexpected field/);
  });

  it('rejects the same account, even in a different letter case', () => {
    const result = validateTransferBody({ from_account_id: A, to_account_id: A.toUpperCase(), amount: 50 }, MAX);
    expect(result.error).toMatch(/same account/);
  });

  it.each([[null], [[]]])('rejects a body that is not an object (%s)', (body) => {
    expect(validateTransferBody(body, MAX).error).toMatch(/JSON object/);
  });

  it('rejects an invalid account id', () => {
    expect(validateTransferBody({ from_account_id: 'nope', to_account_id: B, amount: 50 }, MAX).error)
      .toMatch(/from_account_id/);
  });
});