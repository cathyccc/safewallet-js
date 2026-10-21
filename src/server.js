import 'dotenv/config';
import { createApp } from './app.js';
import { supabase } from './supabase.js';

const PORT = Number(process.env.PORT) || 3000;
const MAX = Number(process.env.MAX_TRANSFER_AMOUNT) || 10000;

const app = createApp({ supabase, maxTransferAmount: MAX });

app.listen(PORT, () => {
  console.log(`SafeWallet API listening on http://localhost:${PORT}`);
});
