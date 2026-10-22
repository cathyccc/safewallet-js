/**
 * SafeWallet security tests — run against your REAL Supabase project.
 *
 * Each run creates its own throwaway accounts (named "vitest-..."),
 * and deletes them afterwards, so your demo data is never touched.
 *
 *   npm test
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { supabase } from '../src/supabase.js';

const app = createApp({ supabase, maxTransferAmount: 10000, rateLimitMax: 1000 });

const newToken = () => crypto.randomBytes(32).toString('hex');
const runId = crypto.randomBytes(4).toString('hex');

let alice; // sender
let bob; // receiver
const createdIds = [];

async function createAccount(name, balance) {
  const { data, error } = await supabase
    .from('accounts')
    .insert({ name: `vitest-${runId}-${name}`, balance, api_token: newToken() })
    .select()
    .single();
  if (error) throw error;
  createdIds.push(data.id);
  return data;
}

async function balanceOf(id) {
  const { data, error } = await supabase.from('accounts').select('balance').eq('id', id).single();
  if (error) throw error;
  return Number(data.balance);
}

async function resetBalances() {
  await supabase.from('accounts').update({ balance: 500 }).eq('id', alice.id);
  await supabase.from('accounts').update({ balance: 100 }).eq('id', bob.id);
}

const transfer = (body, token) => {
  const req = request(app).post('/transfer').set('Content-Type', 'application/json');
  if (token !== undefined) req.set('Authorization', token);
  return req.send(body);
};

beforeAll(async () => {
  alice = await createAccount('alice', 500);
  bob = await createAccount('bob', 100);
});

beforeEach(resetBalances);

afterAll(async () => {
  if (createdIds.length) {
    await supabase.from('transfers').delete().or(
      `from_account_id.in.(${createdIds.join(',')}),to_account_id.in.(${createdIds.join(',')})`
    );
    await supabase.from('accounts').delete().in('id', createdIds);
  }
});

// ---------------------------------------------------------------------------
describe('Happy path', () => {
  it('transfers money when the sender is authorized and the amount is valid', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: bob.id, amount: 50 },
      `Bearer ${alice.api_token}`
    );

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(await balanceOf(alice.id)).toBe(450);
    expect(await balanceOf(bob.id)).toBe(150);
  });

  it('accepts cents (2 decimal places)', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: bob.id, amount: 12.34 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(200);
    expect(await balanceOf(alice.id)).toBe(487.66);
  });
});

describe('Edge cases and records', () => {
  it('returns 404 when the recipient account does not exist, and moves no money', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: crypto.randomUUID(), amount: 10 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(404);
    expect(await balanceOf(alice.id)).toBe(500);
  });

  it('allows transferring the full balance, leaving the sender at 0', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: bob.id, amount: 500 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(200);
    expect(await balanceOf(alice.id)).toBe(0);
    expect(await balanceOf(bob.id)).toBe(600);
  });

  it('writes a record to the transfers table', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: bob.id, amount: 7.77 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(200);

    const { data, error } = await supabase
      .from('transfers')
      .select('*')
      .eq('from_account_id', alice.id)
      .eq('to_account_id', bob.id)
      .eq('amount', 7.77);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('Input validation (amount)', () => {
  const badAmounts = [
    ['negative number', -50],
    ['zero', 0],
    ['negative tiny', -0.01],
    ['numeric string', '50'],
    ['non-numeric string', 'fifty'],
    ['null', null],
    ['boolean', true],
    ['array', [50]],
    ['object', { value: 50 }],
    ['more than 2 decimals', 10.555],
    ['above the max limit', 10000.01],
  ];

  it.each(badAmounts)('rejects %s and moves no money', async (_label, amount) => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: bob.id, amount },
      `Bearer ${alice.api_token}`
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/amount/i);
    expect(await balanceOf(alice.id)).toBe(500);
    expect(await balanceOf(bob.id)).toBe(100);
  });

  it('rejects a missing amount', async () => {
    const res = await transfer({ from_account_id: alice.id, to_account_id: bob.id }, `Bearer ${alice.api_token}`);
    expect(res.status).toBe(400);
  });

  it('rejects transferring to yourself', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: alice.id, amount: 10 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(400);
  });

  it('rejects unexpected fields (mass assignment, e.g. trying to set a balance)', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: bob.id, amount: 10, balance: 1_000_000 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(400);
  });

  it('rejects transfers larger than the sender balance, leaving balances unchanged', async () => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: bob.id, amount: 500.01 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(422);
    expect(await balanceOf(alice.id)).toBe(500);
    expect(await balanceOf(bob.id)).toBe(100);
  });
});

describe('A05: Injection (account id fields)', () => {
  const payloads = [
    ['SQL tautology', "' OR 1=1 --"],
    ['stacked query', "'; DROP TABLE accounts; --"],
    ['UNION select', "' UNION SELECT api_token FROM accounts --"],
    ['PostgREST filter syntax', 'x,id.neq.0'],
    ['script tag', '<script>alert(1)</script>'],
    ['object instead of string', { $ne: null }],
  ];

  it.each(payloads)('rejects %s in from_account_id', async (_label, payload) => {
    const res = await transfer(
      { from_account_id: payload, to_account_id: bob.id, amount: 10 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(400);
    expect(await balanceOf(alice.id)).toBe(500); // accounts table still intact and untouched
  });

  it.each(payloads)('rejects %s in to_account_id', async (_label, payload) => {
    const res = await transfer(
      { from_account_id: alice.id, to_account_id: payload, amount: 10 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(400);
    expect(await balanceOf(bob.id)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
describe('OWASP A01: Broken access control (Authorization header)', () => {
  const body = () => ({ from_account_id: alice.id, to_account_id: bob.id, amount: 50 });

  it("rejects Bob's VALID token used to move Alice's money (403)", async () => {
    // The key broken-access-control test: a real, valid token
    // that belongs to someone other than the sender.
    const res = await transfer(body(), `Bearer ${bob.api_token}`);
    expect(res.status).toBe(403);
    expect(await balanceOf(alice.id)).toBe(500);
    expect(await balanceOf(bob.id)).toBe(100);
  });

  it("rejects a token that is only a prefix of the real one (403)", async () => {
    const res = await transfer(body(), `Bearer ${alice.api_token.slice(0, -1)}`);
    expect(res.status).toBe(403);
  });

  it('gives the same 403 for a non-existent sender (no account enumeration)', async () => {
    const res = await transfer(
      { from_account_id: crypto.randomUUID(), to_account_id: bob.id, amount: 1 },
      `Bearer ${alice.api_token}`
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not authorized to transfer from this account');
  });

  it('never leaks api_token values in responses', async () => {
    const res = await transfer(body(), `Bearer ${alice.api_token}`);
    expect(JSON.stringify(res.body)).not.toContain(alice.api_token);
    expect(JSON.stringify(res.body)).not.toContain(bob.api_token);
  });

  it('never leaks api_token values in error responses', async () => {
    const res = await transfer(body(), `Bearer ${bob.api_token}`);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(alice.api_token);
    expect(JSON.stringify(res.body)).not.toContain(bob.api_token);
  });
});

// ---------------------------------------------------------------------------
describe('Race conditions (double spend)', () => {
  it('parallel transfers can never overdraw the sender', async () => {
    // Alice has 500. Fire 10 parallel transfers of 100: exactly 5 should succeed..
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        transfer({ from_account_id: alice.id, to_account_id: bob.id, amount: 100 }, `Bearer ${alice.api_token}`)
      )
    );

    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBe(5);
    expect(await balanceOf(alice.id)).toBe(0);
    expect(await balanceOf(bob.id)).toBe(600);
  });
});

// ---------------------------------------------------------------------------
describe('OWASP A02: Security misconfiguration', () => {
  it('does not expose the X-Powered-By header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('sends security headers (helmet)', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

// ---------------------------------------------------------------------------
describe('Database-level protection (Row Level Security)', () => {
  it.skipIf(!process.env.SUPABASE_ANON_KEY)('the public anon key cannot read accounts or api tokens', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const { data } = await anon.from('accounts').select('api_token');
    expect(data ?? []).toHaveLength(0);
  });
});

describe('Exceptional Conditions', () => {
  it('returns a generic 500 with no internals when the database fails', async () => {
    const broken = { from: () => { throw new Error('connection refused db.internal:5432'); } };
    const res = await request(createApp({ supabase: broken }))
      .post('/transfer')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${newToken()}`)
      .send({ from_account_id: crypto.randomUUID(), to_account_id: crypto.randomUUID(), amount: 5 });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal server error' });
    expect(JSON.stringify(res.body)).not.toMatch(/connection refused|db\.internal|5432/);
  });

  it('returns a generic error for broken JSON (no stack trace)', async () => {
    const res = await request(app)
      .post('/transfer')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send('{not json');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });

  it('rejects NaN / Infinity sent as raw JSON tokens', async () => {
    // JSON has no NaN/Infinity, so these arrive as invalid JSON and must be refused.
    const res = await request(app)
      .post('/transfer')
      .set('Content-Type', 'application/json')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send(`{"from_account_id":"${alice.id}","to_account_id":"${bob.id}","amount":Infinity}`);
    expect(res.status).toBe(400);
    expect(await balanceOf(alice.id)).toBe(500);
  });
});