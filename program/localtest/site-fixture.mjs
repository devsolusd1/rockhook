// A small launch for testing the site's My Rockies tab: A has a lit Rocky and an
// unminted ticket, B has a burnt-out Rocky. Prints the addresses to use.
import { Keypair, Transaction, ComputeBudgetProgram, fund, launch, buy, sell, send, crank, TIER_THRESHOLDS, conn } from './lib.mjs';
import { ix, read } from '../client/rockhook.mjs';

const payer = Keypair.generate(), bot = Keypair.generate(), A = Keypair.generate(), B = Keypair.generate();
await Promise.all([payer, bot, A, B].map((k) => fund(k.publicKey, k === payer ? 100 : 50)));
const { mint, pool, ledger } = await launch(payer);
await send('init', new Transaction().add(
  ix.initForge({ admin: payer.publicKey, mint, thresholds: TIER_THRESHOLDS }),
  ix.initCollection({ admin: payer.publicKey, mint, name: 'RockHook Rockies', uri: 'https://rockhook.fun/c.json', uriBase: 'https://rockhook.fun/nft/meta/', royaltyBps: 500 }),
), [payer]);
await buy(A, pool, 1, 'A buys 1 SOL');
await buy(B, pool, 0.5, 'B buys 0.5 SOL');
await buy(A, pool, 0.3, 'A buys 0.3 SOL');
await crank(bot, mint, ledger);
const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 });
const [t1, t2] = [await read.ticket(conn, mint, 0), await read.ticket(conn, mint, 1)];
await send('mint A#1 and B#2', new Transaction().add(cu,
  ix.mintRocky({ payer: bot.publicKey, mint, seq: 0, wallet: t1.wallet }),
  ix.mintRocky({ payer: bot.publicKey, mint, seq: 1, wallet: t2.wallet })), [bot]);
await sell(B, pool, 1e9, 'B sells');
await crank(bot, mint, ledger);
await send('burn out B', new Transaction().add(cu, ix.extinguish({ payer: bot.publicKey, mint, seq: 1, wallet: B.publicKey })), [bot]);
console.log(JSON.stringify({ mint: mint.toBase58(), A: A.publicKey.toBase58(), B: B.publicKey.toBase58() }));
