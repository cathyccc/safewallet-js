import request from 'supertest';
import { test, expect } from '../support/fixtures.js';

test('Alice can send money from her own account (control test)', async ({app, alice, bob}) => {
  const res = await request(app)
    .post('/transfer')
    .set('Authorization', `Bearer ${alice.api_token}`)
    .send({
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 50,
    });

  expect(res.status).toBe(200);
});

test("Bob's valid token cannot move money out of Alice's account (403)", async ({app, alice, bob}) => {
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