// The draw slot's hash must be read while SlotHashes still lists it. If nobody
// draws in time, a late draw has to re-arm on a new future slot, not use the
// oldest hash still listed: that one changes every slot, so the caller could
// pick the moment to call and with it the winner. Takes about four minutes.
import { Keypair, Transaction, check, finish, fund, launch, buy, send, conn, TIER_THRESHOLDS } from './lib.mjs';
import { ix, read, SLOT_HASHES } from '../client/rockhook.mjs';
import { createForge } from '../forge/forge.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const payer = Keypair.generate(), bot = Keypair.generate(), A = Keypair.generate(), B = Keypair.generate(), filler = Keypair.generate();
await Promise.all([payer, bot, A, B, filler].map((k) => fund(k.publicKey, k === filler ? 2000 : 100)));

const { mint, pool } = await launch(payer);
await send('init', new Transaction().add(
  ix.initForge({ admin: payer.publicKey, mint, thresholds: TIER_THRESHOLDS }),
  ix.initCollection({ admin: payer.publicKey, mint, name: 'RockHook Rockies', uri: 'https://rockhook.fun/c.json', uriBase: 'https://rockhook.fun/nft/meta/', royaltyBps: 500 }),
), [payer]);
await buy(A, pool, 1, 'A buys 1 SOL');
await buy(B, pool, 2, 'B buys 2 SOL');
await buy(A, pool, 0.5, 'A buys 0.5 SOL');
await buy(filler, pool, 1000, 'filler buys the rest of the curve');

// The bot runs until graduation is recorded, then stops before the draw.
const forge = createForge({ conn, payer: bot, mint, log: () => {} });
let phase = '';
for (let i = 0; i < 60 && phase !== 'waiting for the draw slot'; i++) { phase = (await forge.tick()).phase; await sleep(300); }
check(phase === 'waiting for the draw slot', 'graduation recorded; the bot is stopped before the draw');
let rockies = await read.rockies(conn, mint);
const target = rockies.drawSlot;

async function oldestListedSlot() {
  const d = (await conn.getAccountInfo(SLOT_HASHES, 'confirmed')).data;
  return Number(d.readBigUInt64LE(8 + (Number(d.readBigUInt64LE(0)) - 1) * 40));
}
console.log(`  draw slot ${target}; waiting until SlotHashes no longer lists it...`);
while ((await oldestListedSlot()) <= target) await sleep(5000);

await send('late draw', new Transaction().add(ix.draw({ mint })), [bot]);
rockies = await read.rockies(conn, mint);
check(!rockies.drawn && rockies.drawSlot > target, `a late draw re-arms on a future slot (${target} -> ${rockies.drawSlot}) instead of drawing`);

for (let i = 0; i < 60 && phase !== 'done'; i++) { phase = (await forge.tick()).phase; if (phase !== 'done') await sleep(700); }
check(phase === 'done', 'the bot finished graduation on the new draw slot');
rockies = await read.rockies(conn, mint);
const winners = new Set([rockies.lastBuySeq, rockies.biggestBuySeq, rockies.randomWinnerSeq]);
check(rockies.drawn && rockies.randomDone && winners.size === 3, 'three different Supernovas, the random one drawn from the new slot');
finish();
