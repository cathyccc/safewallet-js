import request from 'supertest';
import { describe } from 'vitest';
import { test, expect } from '../support/fixtures.js';
import crypto from 'node:crypto';

describe('A06:2025 Insecure Design', () => {
  test('parallel transfers can never overdraw the sender', async ({app, alice, bob, balanceOf}) => {
    const sendOne = () => {
      return request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 100})
    }

    const results = await Promise.all(Array.from({ length: 10 }, sendOne));

    const succeeded = results.filter((r) => r.status === 200).length;
    expect(succeeded).toBe(5);
    const refused = results.filter((r) => r.status === 422).length;
    expect(refused).toBe(5);
    expect(await balanceOf(alice.id)).toBe(0);
    expect(await balanceOf(bob.id)).toBe(600);
  });

  test('rejects a transfer larger than the balance (422)', async ({ app, alice, bob, balanceOf }) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 500.01})

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/insufficient funds/);
    expect(await balanceOf(alice.id)).toBe(500);
    expect(await balanceOf(bob.id)).toBe(100);
  });

  test('allows sending the exact full balance, leaving 0 (200)', async({app, alice, bob, balanceOf}) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 500})

    expect(res.status).toBe(200);
    expect(await balanceOf(alice.id)).toBe(0);
    expect(await balanceOf(bob.id)).toBe(600);
  });

  test('rejects a request body over 10 KB (413)', async ({ app, alice }) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: 'x'.repeat(20000) });   // about 20 KB

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'request body too large' });
  });

  test('rejects a transfer to an account that does not exist, and no money is lost (404)', async ({ app, alice, balanceOf }) => {
    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: crypto.randomUUID(), amount: 12.34});
    expect(res.status).toBe(404);
    expect(await balanceOf(alice.id)).toBe(500);
    expect(res.body.error).toMatch(/account not found/);
  });
});
