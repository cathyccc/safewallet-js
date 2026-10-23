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
