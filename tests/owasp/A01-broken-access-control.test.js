import request from 'supertest';
import crypto from 'node:crypto';
import { test, expect } from '../support/fixtures.js';

test('Alice can send money from her own account (control test)', async ({app, alice, bob, balanceOf}) => {
  const res = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${alice.api_token}`)
    .send({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 50,
    });

  expect(res.status).toBe(200);
  expect(await balanceOf(alice.id)).toBe(450);
  expect(await balanceOf(bob.id)).toBe(150);
});

test("Bob's valid token cannot move money out of Alice's account (403)", async ({app, alice, bob, balanceOf}) => {
  const res = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${bob.api_token}`)
    .send({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 50,
    });

  expect(res.status).toBe(403);
  expect(await balanceOf(alice.id)).toBe(500);
  expect(await balanceOf(bob.id)).toBe(100);
});

test("No authorization header cannot move money out of Alice's account (401)", async ({app, alice, bob, balanceOf}) => {
  const res = await request(app)
    .post('/transfer')
    .send({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 50,
    });

  expect(res.status).toBe(401);
  expect(await balanceOf(alice.id)).toBe(500);
  expect(await balanceOf(bob.id)).toBe(100);
});

test('malformed header cannot move money out of Alice\'s account (401)', async ({app, alice, bob, balanceOf}) => {
  const res = await request(app)
    .post('/transfer')
    .set('Authorization', `${alice.api_token}`) // her token, but no "Bearer " in front
    .send({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 50,
    });

  expect(res.status).toBe(401);
  expect(await balanceOf(alice.id)).toBe(500);
  expect(await balanceOf(bob.id)).toBe(100);
});

test('made-up token cannot move money out of Alice\'s account (403)', async ({app, alice, bob, balanceOf}) => {
  const res = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${crypto.randomBytes(32).toString('hex')}`)
    .send({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 50,
    });

  expect(res.status).toBe(403);
  expect(await balanceOf(alice.id)).toBe(500);
  expect(await balanceOf(bob.id)).toBe(100);
});

test('tampered token cannot move money out of Alice\'s account (403)', async ({app, alice, bob, balanceOf}) => {
  const res = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${alice.api_token.slice(0,1)}`)
    .send({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 50,
    });

  expect(res.status).toBe(403);
  expect(await balanceOf(alice.id)).toBe(500);
  expect(await balanceOf(bob.id)).toBe(100);
});

test('a non-existent sender gets the same 403 as a wrong token (no account enumeration)', async ({ app, alice, bob }) => {
  const realAccount = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${bob.api_token}`)
    .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 1 });

  const fakeAccount = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${bob.api_token}`)
    .send({ from_account_id: crypto.randomUUID(), to_account_id: bob.id, amount: 1 });   // a random ID that doesn't exist

  expect(fakeAccount.status).toBe(403);
  expect(fakeAccount.body).toEqual(realAccount.body);   // must match the other response exactly
});

test('tokens never appear in any response', async ({ app, alice, bob }) => {
  const success = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${alice.api_token}`)
    .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 1 });

  const denied = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${crypto.randomUUID()}`)    // whose token gets denied here?
    .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 1 });

  expect(success.text).not.toContain(alice.api_token);
  expect(success.text).not.toContain(bob.api_token);
  expect(denied.text).not.toContain(alice.api_token);
  expect(denied.text).not.toContain(bob.api_token);
})

test('the public anon key cannot read accounts or tokens', async ({ alice, anonClient }) => {
  const { data } = await anonClient
    .from('accounts')
    .select('id, api_token')
    .eq('id', alice.id);

  expect(data ?? []).toHaveLength(0);
});