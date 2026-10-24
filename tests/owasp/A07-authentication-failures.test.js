import request from 'supertest';
import { describe } from 'vitest';
import { test, expect } from '../support/fixtures.js';

describe('A07:2025 Authentication Failures', () => {
  test('blocks requests after 100 in a minute (429)', async ({ app }) => {
    for (let i = 0; i < 100; i++) {
      const res = await request(app).post('/transfer').send({});
      expect(res.status).toBe(401);
    }

    // the 101st is blocked
    const blocked = await request(app).post('/transfer').send({});
    expect(blocked.status).toBe(429);
  });

  test("after being blocked, even Alice's correct token is refused (429)", async ({ app, alice, bob, balanceOf }) => {
    for (let i = 0; i < 100; i++) {
      await request(app).post('/transfer').send({});
    }

    const res = await request(app)
      .post('/transfer')
      .set('Authorization', `Bearer ${alice.api_token}`)
      .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 50})
    
    expect(res.status).toBe(429);
    expect(await balanceOf(alice.id)).toBe(500);
    expect(await balanceOf(bob.id)).toBe(100);
  });
});