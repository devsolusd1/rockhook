// Phase 4: launch day, simulated. Trades happen while the forge bot runs on its
// own; at the end every Rocky must match an independent recount from the ledger.
import { Keypair, Transaction, check, finish, fund, launch, buy, sell, transferIxs, send, sendExpectError, conn, rock, short, TIER_THRESHOLDS } from './lib.mjs';
import { ix, pdas, read, TIER_NAMES } from '../client/rockhook.mjs';
import { createForge } from '../forge/forge.mjs';

const URI_BASE = 'https://rockhook.fun/nft/meta/';
const SLUGS = ['ember', 'flame', 'white-hot', 'blue-flame', 'plasma'];
const payer = Keypair.generate(), bot = Keypair.generate(), whale = Keypair.generate();
const buyers = Array.from({ length: 12 }, () => Keypair.generate());
await Promise.all([payer, bot, whale, ...buyers].map((k) => fund(k.publicKey, k === payer ? 5000 : 400)));
const names = new Map([[payer, 'filler'], [whale, 'whale'], ...buyers.map((k, i) => [k, `u${i + 1}`])].map(([k, n]) => [k.publicKey.toBase58(), n]));
const nameOf = (pk) => names.get(pk.toBase58()) ?? short(pk);

// Launch: hook, forge and collection set up before trading opens.
const { mint, pool } = await launch(payer);
await send('init forge + collection', new Transaction().add(
  ix.initForge({ admin: payer.publicKey, mint, thresholds: TIER_THRESHOLDS }),
  ix.initCollection({ admin: payer.publicKey, mint, name: 'RockHook Rockies', uri: `${URI_BASE}collection.json`, uriBase: URI_BASE, royaltyBps: 500 }),
), [payer]);
const { ledger } = await read.state(conn, mint);
const closeLedger = (admin) => new Transaction().add(ix.closeLedger({ admin: admin.publicKey, mint, ledger }));
check(/NotGraduated/.test(await sendExpectError('close ledger', closeLedger(payer), [payer]) ?? ''), 'the ledger can\'t be closed before graduation');

// The bot runs on its own loop from the start.
const forge = createForge({ conn, payer: bot, mint, log: (m) => console.log(`    [forge] ${m}`) });
let phase = '', stop = false;
const botLoop = (async () => {
  while (!stop) {
    try { phase = (await forge.tick()).phase; } catch (e) { console.log(`    [forge] error: ${e.message.split('\n')[0]}`); }
    if (phase === 'done') return;
    await new Promise((r) => setTimeout(r, 500));
  }
})();

// Trading day.
const sizes = [0.3, 1.2, 0.05, 0.6, 2, 0.15, 0.8, 0.07, 3, 0.4, 1, 0.25];
for (let i = 0; i < buyers.length; i++) await buy(buyers[i], pool, sizes[i], `u${i + 1} buys ${sizes[i]} SOL`);
await buy(whale, pool, 150, 'whale buys 150 SOL');
await sell(buyers[1], pool, 1e9, 'u2 sells 1 ROCK');
await send('u4 sends 0.2 ROCK to u5', new Transaction().add(...await transferIxs(buyers[3].publicKey, buyers[4].publicKey, mint, 2e8)), [buyers[3]]);
await buy(buyers[1], pool, 0.5, 'u2 buys back 0.5 SOL');
await buy(buyers[5], pool, 0.9, 'u6 buys 0.9 SOL');
await buy(payer, pool, 1000, 'filler completes the curve');
console.log('  trading closed: the curve graduated; waiting for the forge...');

const deadline = Date.now() + 180_000;
while (phase !== 'done' && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1000));
stop = true;
await botLoop;
check(phase === 'done', 'the bot ran graduation to the end on its own');

// ---- Independent recount from the ledger -------------------------------------------------
const state = await read.state(conn, mint);
const { entries } = await read.ledger(conn, state.ledger);
const expected = new Map(); // seq -> { wallet, amount }
const lastOut = new Map();
for (const e of entries) {
  if (e.kind === 1) expected.set(e.seq, { wallet: e.to, amount: e.amount });
  else lastOut.set(e.from.toBase58(), e.seq);
}
const tickets = await read.tickets(conn, mint);
const rockies = await read.rockies(conn, mint);
check(tickets.length === expected.size, `${tickets.length} tickets = ${expected.size} buys of at least 0.1 SOL (2 small buys left out)`);

const winners = new Set([rockies.lastBuySeq, rockies.biggestBuySeq, rockies.randomWinnerSeq]);
check(winners.size === 3, 'three different Supernovas');
let allRight = true;
console.log('\n  Rocky            owner     ROCK      art');
for (const t of tickets) {
  const asset = await read.asset(conn, pdas.rocky(mint, t.seq));
  const burnt = (lastOut.get(t.wallet.toBase58()) ?? -1) >= t.seq;
  const slug = winners.has(t.seq) ? 'supernova' : burnt ? 'burnt-out' : SLUGS[TIER_THRESHOLDS.filter((x) => t.amount >= x).length];
  const ok = asset && asset.owner.equals(t.wallet) && asset.uri === `${URI_BASE}${slug}.json`;
  if (!ok) allRight = false;
  console.log(`  ${(asset?.name ?? '(none)').padEnd(16)} ${nameOf(t.wallet).padEnd(8)} ${rock(t.amount).toFixed(3).padStart(8)}  ${asset?.uri.replace(URI_BASE, '') ?? '-'}${ok ? '' : `   <- expected ${slug}`}`);
}
check(allRight, 'every Rocky is minted to its buyer with the art the recount expects');
check(rockies.thawed, 'the collection is thawed after graduation');
const forgeState = await read.forge(conn, mint);
check(forgeState.biggestWallet.equals(whale.publicKey), `biggest buyer is the whale (${rock(forgeState.biggestTotal).toFixed(3)} ROCK)`);
check(forgeState.lastBuyWallet.equals(payer.publicKey), 'the filling buy is the filler\'s');

// Once graduation is done, the admin gets the ledger's rent back.
check(/ConstraintHasOne|has.one/i.test(await sendExpectError('close ledger', closeLedger(bot), [bot]) ?? ''), 'only the admin can close the ledger');
const rent = (await conn.getAccountInfo(ledger, 'confirmed')).lamports;
const before = await conn.getBalance(payer.publicKey, 'confirmed');
await send('close ledger', closeLedger(payer), [payer]);
const back = (await conn.getBalance(payer.publicKey, 'confirmed')) - before;
check(!(await conn.getAccountInfo(ledger, 'confirmed')) && back > rent - 100_000, `ledger closed: ${(back / 1e9).toFixed(3)} SOL of rent back to the admin`);
finish();
