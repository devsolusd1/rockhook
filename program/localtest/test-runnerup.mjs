// The buy that fills the curve is also the biggest buyer's biggest buy: the
// biggest-buyer Supernova must pass to the runner-up, so there are still three.
import { Keypair, Transaction, check, finish, fund, launch, buy, send, conn, short, TIER_THRESHOLDS } from './lib.mjs';
import { ix, pdas, read } from '../client/rockhook.mjs';
import { createForge } from '../forge/forge.mjs';

const payer = Keypair.generate(), bot = Keypair.generate(), A = Keypair.generate(), B = Keypair.generate(), C = Keypair.generate(), filler = Keypair.generate();
await Promise.all([payer, bot, A, B, C, filler].map((k) => fund(k.publicKey, k === filler ? 2000 : 100)));
const names = new Map([[A, 'A'], [B, 'B'], [C, 'C'], [filler, 'filler']].map(([k, n]) => [k.publicKey.toBase58(), n]));
const nameOf = (pk) => names.get(pk.toBase58()) ?? short(pk);

const { mint, pool } = await launch(payer);
await send('init', new Transaction().add(
  ix.initForge({ admin: payer.publicKey, mint, thresholds: TIER_THRESHOLDS }),
  ix.initCollection({ admin: payer.publicKey, mint, name: 'RockHook Rockies', uri: 'https://rockhook.fun/c.json', uriBase: 'https://rockhook.fun/nft/meta/', royaltyBps: 500 }),
), [payer]);
await buy(A, pool, 1, 'A buys 1 SOL');
await buy(B, pool, 0.5, 'B buys 0.5 SOL');
await buy(C, pool, 2, 'C buys 2 SOL');
await buy(filler, pool, 1000, 'filler buys the rest of the curve in one go');

const forge = createForge({ conn, payer: bot, mint, log: () => {} });
let phase = '';
for (let i = 0; i < 60 && phase !== 'done'; i++) { phase = (await forge.tick()).phase; if (phase !== 'done') await new Promise((r) => setTimeout(r, 700)); }
check(phase === 'done', 'graduation finished');

const f = await read.forge(conn, mint);
const rockies = await read.rockies(conn, mint);
check(f.biggestWallet.equals(filler.publicKey) && f.lastBuyWallet.equals(filler.publicKey), 'the filler is both the biggest buyer and the filling buy');
check(f.secondWallet.equals(C.publicKey), `runner-up by total bought: ${nameOf(f.secondWallet)}`);
const biggestTicket = await read.ticket(conn, mint, rockies.biggestBuySeq);
check(biggestTicket.wallet.equals(C.publicKey), 'the biggest-buyer Supernova went to the runner-up (C)');

const winners = [rockies.lastBuySeq, rockies.biggestBuySeq, rockies.randomWinnerSeq];
check(new Set(winners).size === 3, 'still three different Supernovas');
for (const seq of winners) {
  const t = await read.ticket(conn, mint, seq);
  const a = await read.asset(conn, pdas.rocky(mint, seq));
  console.log(`  ${a.name.padEnd(14)} ${nameOf(t.wallet)}`);
  check(a.uri.endsWith('supernova.json'), `${a.name} shows the Supernova art`);
}
finish();
