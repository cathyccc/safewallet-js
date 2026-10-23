import request from 'supertest';
import { describe } from 'vitest';
import { test, expect } from '../support/fixtures.js';

describe('A05:2025 Injection', () => {
  describe('Injection payloads', () => {
    test.for([
      ['SQL tautology', "' OR 1=1 --"],
      ['stacked query', "'; DROP TABLE accounts; --"],
      ['UNION select', "' UNION SELECT api_token FROM accounts --"],
      ['PostgREST filter syntax', 'x,id.neq.0'],
      ['script tag', '<script>alert(1)</script>'],
      ['object instead of string', { $ne: null }],
    ])('rejects %s in from_account_id and moves no money', async ([label, payload], { app, alice, bob, balanceOf }) => {
      const res = await request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: payload, to_account_id: bob.id, amount: 50 });
  
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/from_account_id/);
      expect(await balanceOf(bob.id)).toBe(100);
    });
  
    test.for([
      ['SQL tautology', "' OR 1=1 --"],
      ['stacked query', "'; DROP TABLE accounts; --"],
      ['UNION select', "' UNION SELECT api_token FROM accounts --"],
      ['PostgREST filter syntax', 'x,id.neq.0'],
      ['script tag', '<script>alert(1)</script>'],
      ['object instead of string', { $ne: null }],
    ])('rejects %s in to_account_id and moves no money', async ([label, payload], { app, alice, bob, balanceOf }) => {
      const res = await request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: alice.id, to_account_id: payload, amount: 50 });
  
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/to_account_id/);
      expect(await balanceOf(alice.id)).toBe(500);
    });
  });
  
  describe('Input validation', () => {
    test.for([
      ['negative number', -50],
      ['zero', 0],
      ['text', 'fifty'],
      ['a number written as text', '50'],
      ['null', null],
      ['a boolean', true],
      ['an array', [50]],
      ['too many decimals', 10.555],
      ['over the limit', 10000.01]
    ])('rejects %s as the amount and moves no money', async ([label, amount], { app, alice, bob, balanceOf }) => {
      const res = await request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: alice.id, to_account_id: bob.id, amount: amount });
  
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/amount/);
      expect(await balanceOf(alice.id)).toBe(500);
      expect(await balanceOf(bob.id)).toBe(100);
    });
  
    test('rejects a missing amount (400)', async ({app, alice, bob, balanceOf}) => {
      const res = await request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: alice.id, to_account_id: bob.id});
    
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/amount/);
      expect(await balanceOf(alice.id)).toBe(500);
      expect(await balanceOf(bob.id)).toBe(100);
    });
  
    test('rejects extra fields like balance (mass assignment) (400)', async ({app, alice, bob, balanceOf}) => {
      const res = await request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: alice.id, to_account_id: bob.id, amount: 50, balance: 1000000});
    
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/unexpected field/);
      expect(await balanceOf(alice.id)).toBe(500);
      expect(await balanceOf(bob.id)).toBe(100);
    });
    
    test('rejects sending money to your own account (400)', async ({app, alice, balanceOf}) => {
      const res = await request(app)
        .post('/transfer')
        .set('Authorization', `Bearer ${alice.api_token}`)
        .send({ from_account_id: alice.id, to_account_id: alice.id, amount: 50});
    
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/same account/);
      expect(await balanceOf(alice.id)).toBe(500);
    })
  })
});