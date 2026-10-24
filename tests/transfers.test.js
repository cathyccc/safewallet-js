import request from 'supertest';
import crypto from 'node:crypto';
import { describe } from 'vitest';
import { test, expect } from './support/fixtures.js';
import { supabase } from '../src/supabase.js';

describe('Transfers', () => {
  test('transfers an amount with cents (200)', async ({ app, alice, bob, balanceOf }) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 12.34});
    expect(res.status).toBe(200);
    expect(await balanceOf(alice.id)).toBe(487.66);
    expect(await balanceOf(bob.id)).toBe(112.34);
  });

  test('rejects a transfer to an account that does not exist (404)', async ({ app, alice, balanceOf }) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: crypto.randomUUID(), amount: 12.34});
    expect(res.status).toBe(404);
    expect(await balanceOf(alice.id)).toBe(500);
    expect(res.body.error).toMatch(/account not found/);
  });

  test('saves every successful transfer to the transfers table', async ({ app, alice, bob }) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 7.77});
    expect(res.status).toBe(200);

    const { data } = await supabase
      .from('transfers')
      .select('*')
      .eq('from_account_id', alice.id)
      .eq('to_account_id', bob.id)
      .eq('amount', 7.77);

    expect(data).toHaveLength(1);
  });
});