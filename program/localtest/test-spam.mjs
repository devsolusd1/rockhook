// A flood of cheap sends must never cost a buyer their ticket: buys have their own
// ledger ring. Two wallets ping-pong 1 base unit of $ROCK more times than the out
// ring holds, with the bot down, while others buy. Every buy still gets its ticket,
// and the bot gets past the overwritten sends on its own.
import { ComputeBudgetProgram, Keypair, Transaction, check, finish, fund, launch, buy, send, conn, transferIxs, TIER_THRESHOLDS } from './lib.mjs';
import { OUT_CAPACITY, backlog, ix, read } from '../client/rockhook.mjs';
import { createForge } from '../forge/forge.mjs';

const payer = Keypair.generate(), bot = Keypair.generate(), X = Keypair.generate(), Y = Keypair.generate();
const buyers = Array.from({ length: 8 }, () => Keypair.generate());
await Promise.all([payer, bot, X, Y, ...buyers].map((k) => fund(k.publicKey, 100)));

const { mint, pool, ledger } = await launch(payer);
await send('init', new Transaction().add(
  ix.initForge({ admin: payer.publicKey, mint, thresholds: TIER_THRESHOLDS }),
  ix.initCollection({ admin: payer.publicKey, mint, name: 'RockHook Rockies', uri: 'https://rockhook.fun/c.json', uriBase: 'https://rockhook.fun/nft/meta/', royaltyBps: 500 }),
), [payer]);

await buy(buyers[0], pool, 0.5, 'a buy before the flood');
await buy(X, pool, 0.2, 'the attacker buys a little $ROCK');
const [openY, xToY] = await transferIxs(X.publicKey, Y.publicKey, mint, 1);
const [, yToX] = await transferIxs(Y.publicKey, X.publicKey, mint, 1);
await send('the attacker opens a second wallet', new Transaction().add(openY, xToY), [X]);

// The flood: 30 sends per transaction, well past what the out ring holds.
const PER_TX = 30;
const rounds = Math.ceil((OUT_CAPACITY + 1500) / PER_TX);
const t0 = Date.now();
const flood = (async () => {
  for (let r = 0; r < rounds; r++) {
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: r + 1 }), // keeps each transaction unique
    );
    for (let i = 0; i < PER_TX; i++) tx.add(i % 2 ? yToX : xToY);
    await send(`flood ${r}`, tx, [X, Y]);
  }
})();
const buysDuring = (async () => {
  for (const [i, b] of buyers.slice(1, 6).entries()) {
    await new Promise((r) => setTimeout(r, 3000 + i * 4000));
    await buy(b, pool, 0.3 + i * 0.1, `buy ${i + 1} during the flood`);
  }
})();
await Promise.all([flood, buysDuring]);
const floodSeconds = (Date.now() - t0) / 1000;
await buy(buyers[6], pool, 0.4, 'a buy after the flood');
await buy(buyers[7], pool, 1, 'another buy after the flood');

let decoded = await read.ledger(conn, ledger);
console.log(`  ${decoded.outCount} sends in ${floodSeconds.toFixed(0)} s; out ring holds ${OUT_CAPACITY}; ${decoded.buyCount} buys recorded`);
check(decoded.outCount > OUT_CAPACITY, `the flood overran the out ring (${decoded.outCount} sends > ${OUT_CAPACITY})`);

// Now the bot starts, far behind.
const forge = createForge({ conn, payer: bot, mint, log: () => {} });
const t1 = Date.now();
let caughtUp = false;
for (let i = 0; i < 200 && !caughtUp; i++) {
  await forge.tick();
  const f = await read.forge(conn, mint);
  decoded = await read.ledger(conn, ledger);
  caughtUp = backlog(f, decoded) === 0 && (await read.tickets(conn, mint)).every((t) => t.minted);
}
const f = await read.forge(conn, mint);
console.log(`  the bot caught up in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${f.lostOuts} overwritten sends skipped`);
check(caughtUp, 'the bot caught up on its own, recovering past the overwritten sends');
check(f.lostBuys === 0 && f.lostOuts > 0, `no buy lost (${f.lostBuys}); ${f.lostOuts} sends lost, as expected`);

const tickets = await read.tickets(conn, mint);
const expected = [buyers[0], X, ...buyers.slice(1)].map((k) => k.publicKey.toBase58()).sort();
const got = tickets.map((t) => t.wallet.toBase58()).sort();
check(JSON.stringify(got) === JSON.stringify(expected), `every buy has its ticket: ${tickets.length} of ${expected.length}, the right wallets`);
check(tickets.every((t) => t.minted), 'and every ticket has its Rocky');
const hX = await read.holder(conn, mint, X.publicKey);
const tX = tickets.find((t) => t.wallet.equals(X.publicKey));
check(hX.burnBeforeSeq > tX.seq, "the attacker's own Rocky burnt out (its latest sends were read)");
finish();
