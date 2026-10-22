import {test as base, expect} from 'vitest';
import { supabase } from '../../src/supabase.js';
import crypto from 'node:crypto';
import { createApp } from '../../src/app.js';

const test = base.extend({
  createAccount: async ({}, use) => {
    const createdIds = [];

    const createAccount = async (name, balance) => {
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          name,
          balance,
          api_token: crypto.randomBytes(32).toString('hex'),
        })
        .select()
        .single();
      if (error) throw error;

      createdIds.push(data.id)
      return data;
    };

    await use(createAccount);

    for (const id of createdIds) {
      await supabase.from('transfers').delete().or(`from_account_id.eq.${id},to_account_id.eq.${id}`);
      await supabase.from('accounts').delete().eq('id', id);
    }
  },

  app: async ({}, use) => {
    await use(createApp({ supabase }));
  },

  balanceOf: async ({}, use) => {
    await use(async(id) => {
      const {data, error} = await supabase.from('accounts').select('balance').eq('id', id).single();
      if (error) throw error;
      return Number(data.balance);
    });
  },

  alice: async ({ createAccount }, use) => {
    await use(await createAccount('test-alice', 500));
  },

  bob: async ({ createAccount }, use) => {
    await use(await createAccount('test-bob', 100));
  },
});

export { test, expect };