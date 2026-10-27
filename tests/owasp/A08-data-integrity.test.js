import request from 'supertest';
import { describe } from 'vitest';
import { test, expect } from '../support/fixtures.js';
import { supabase } from '../../src/supabase.js';

// Reads every transfer record sent FROM an account, and adds up the amounts
async function recordsFrom(accountId) {
  const { data: records, error } = await supabase
    .from('transfers')
    .select('amount')
    .eq('from_account_id', accountId);
  if (error) throw error;

  const total = records.reduce((sum, r) => sum + Number(r.amount), 0);
  return { records, total };
}

describe('A08:2025 Software or Data Integrity Failures', () => {
  test('transfer records add up to the money that actually moved', async({app, alice, bob, balanceOf}) => {
    const send = (amount) => request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount})

    expect((await send(50)).status).toBe(200);
    expect((await send(25)).status).toBe(200);

    const { records, total } = await recordsFrom(alice.id);

    expect(records).toHaveLength(2);
    expect(total).toBe(75);
    expect(await balanceOf(alice.id)).toBe(500 - total);
    expect(await balanceOf(alice.id) + await balanceOf(bob.id)).toBe(600);
  })

  test('a refused transfer leaves no record', async({app, alice, bob, balanceOf}) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 500.01});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/insufficient funds/);

    const {records} = await recordsFrom(alice.id);
    expect(records).toHaveLength(0);
    expect(await balanceOf(alice.id)).toBe(500);
  });

  test('parallel transfers leave exactly one record per successful transfer', async ({ app, alice, bob, balanceOf }) => {
    const sendOne = () => {
      return request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 100 });
    };

    const results = await Promise.all(Array.from({ length: 10 }, sendOne));
    const succeeded = results.filter((r) => r.status === 200).length;

    const { records, total } = await recordsFrom(alice.id);

    expect(records).toHaveLength(succeeded);
    expect(total).toBe(500);
    expect(await balanceOf(alice.id)).toBe(500 - total);
  });

  test('stores amounts with cents exactly, with no rounding errors (200)', async ({ app, alice, bob, balanceOf }) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 12.34 });

    expect(res.status).toBe(200);
    expect(await balanceOf(alice.id)).toBe(487.66);
    expect(await balanceOf(bob.id)).toBe(112.34);

    const { total } = await recordsFrom(alice.id);
    expect(total).toBe(12.34);
  });

  test('the public anon key cannot insert a fake transfer record', async ({ alice, bob, anonClient }) => {
    const { data, error } = await anonClient
      .from('transfers')
      .insert({ from_account_id: bob.id, to_account_id: alice.id, amount: 1000 })
      .select();

    // Safety net: if the forgery wrongly succeeded, remove it so it isn't left behind
    if (data?.length) await supabase.from('transfers').delete().eq('id', data[0].id);

    expect(error).not.toBeNull();

    const { records } = await recordsFrom(bob.id);
    expect(records).toHaveLength(0);
  });
})