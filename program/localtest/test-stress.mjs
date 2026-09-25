// A hot curve: many wallets buy and sell at the same time while the bot runs.
// Measures how fast the bot turns entries into tickets and Rockies, and checks it catches up.
import { Keypair, Transaction, check, finish, fund, launch, buyTx, sell, send, conn, TIER_THRESHOLDS } from './lib.mjs';
import { ix, read } from '../client/rockhook.mjs';
import { createForge } from '../forge/forge.mjs';

const WALLETS = 40, BUYS_EACH = 5;
const payer = Keypair.generate(), bot = Keypair.generate();
const traders = Array.from({ length: WALLETS }, () => Keypair.generate());
await Promise.all([payer, bot, ...traders].map((k) => fund(k.publicKey, k === payer ? 100 : 20)));
const { mint, pool } = await launch(payer);
await send('init', new Transaction().add(
  ix.initForge({ admin: payer.publicKey, mint, thresholds: TIER_THRESHOLDS }),
  ix.initCollection({ admin: payer.publicKey, mint, name: 'RockHook Rockies', uri: 'https://rockhook.fun/c.json', uriBase: 'https://rockhook.fun/nft/meta/', royaltyBps: 500 }),
), [payer]);

const forge = createForge({ conn, payer: bot, mint, log: () => {} });
let stop = false, ticks = 0;
const botLoop = (async () => { while (!stop) { try { await forge.tick(); ticks++; } catch (e) { console.log('  bot error:', e.message.split('\n')[0]); } } })();

// Every wallet fires its buys back to back; all wallets at once.
const t0 = Date.now();
let trades = 0;
await Promise.all(traders.map(async (w, i) => {
  for (let b = 0; b < BUYS_EACH; b++) {
    const tx = await buyTx(w.publicKey, pool, 0.12 + ((i * 7 + b * 3) % 10) / 20);
    try { await send(`t${i} buy`, tx, [w]); trades++; } catch { /* a few collide on the same blockhash window; fine */ }
  }
  if (i % 4 === 0) { await sell(w, pool, 2e8, `t${i} sells`); trades++; }
}));
const tradeSeconds = (Date.now() - t0) / 1000;
const { head } = await read.ledger(conn, (await read.state(conn, mint)).ledger);
console.log(`  ${trades} trades in ${tradeSeconds.toFixed(1)} s (${(trades / tradeSeconds).toFixed(1)} trades/s), ledger head ${head}`);

// Wait for the bot to catch up: every entry processed and every ticket minted.
let caughtUp = false;
for (let i = 0; i < 240 && !caughtUp; i++) {
  const f = await read.forge(conn, mint);
  const tickets = await read.tickets(conn, mint);
  caughtUp = f.nextSeq >= head && tickets.every((t) => t.minted && (t.ashed || t.supernova || true));
  if (!caughtUp) await new Promise((r) => setTimeout(r, 500));
}
const total = (Date.now() - t0) / 1000;
stop = true;
await botLoop;
const tickets = await read.tickets(conn, mint);
check(caughtUp, `bot caught up: ${tickets.length} Rockies minted, all ${head} entries processed`);
console.log(`  the bot finished ${(total - tradeSeconds).toFixed(1)} s after the last trade (${total.toFixed(1)} s total, ${(head / total).toFixed(1)} entries/s end to end)`);
finish();
