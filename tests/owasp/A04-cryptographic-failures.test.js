import { describe } from 'vitest';
import { test, expect } from '../support/fixtures.js';
import { supabase } from '../../src/supabase.js';

describe('A04:2025 Cryptographic Failures', () => {
  test('the database refuses a token shorter than 32 characters', async () => {
    const { data, error } = await supabase
      .from('accounts')
      .insert({ name: 'test-weak-token', balance: 0, api_token: 'a'.repeat(31) })
      .select()
      .single();

    // Safety net: if the database wrongly accepted it, delete the row so it isn't left behind
    if (data) await supabase.from('accounts').delete().eq('id', data.id);

    expect(error).not.toBeNull();
    expect(error.code).toBe('23514');   // Postgres's code for "a check rule was broken"
  });

  test("the database refuses a token that's already in use", async ({ alice }) => {
     const { data, error } = await supabase
      .from('accounts')
      .insert({ name: 'test-duplicate-token', balance: 0, api_token: alice.api_token })
      .select()
      .single();

    if (data) await supabase.from('accounts').delete().eq('id', data.id);

    expect(error).not.toBeNull();
    expect(error.code).toBe('23505'); // Postgres's code for "a unique rule was broken"
  });
});