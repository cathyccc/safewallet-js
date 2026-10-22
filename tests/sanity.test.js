import {test, expect} from './support/fixtures.js';

test('alice starts with 500', async ({alice}) => {
  expect(Number(alice.balance)).toBe(500);
})

test('bob starts with 100', async ({bob}) => {
  expect(Number(bob.balance)).toBe(100);
});

test('alice and bob are different accounts', async ({alice, bob}) => {
  expect(alice.id).not.toBe(bob.id);
  expect(alice.api_token).not.toBe(bob.api_token);
});