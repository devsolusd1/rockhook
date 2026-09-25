// Phase 2: the crank turns ledger entries into holders and tickets.
import {
  Keypair, Transaction, check, finish, fund, launch, buy, buyTx, buyExactOutTx, sell, transferIxs, send, sendExpectError,
  ix, crank, readForge, readHolder, readTicket, readLedger, rock, short, TIER_NAMES, TIER_THRESHOLDS, KIND,
} from './lib.mjs';

const payer = Keypair.generate(), cranker = Keypair.generate();
const [A, B, C, D, E, R] = Array.from({ length: 6 }, () => Keypair.generate());
await Promise.all([payer, cranker, A, B, C, D, E, R].map((k) => fund(k.publicKey, k === payer ? 5000 : 200)));
const names = new Map([[A, 'A'], [B, 'B'], [C, 'C'], [D, 'D'], [E, 'E'], [R, 'router']].map(([k, n]) => [k.publicKey.toBase58(), n]));
const nameOf = (pk) => names.get(pk.toBase58()) ?? short(pk);

const { mint, pool, ledger } = await launch(payer);
await send('init forge', new Transaction().add(ix.initForge(payer.publicKey, mint, TIER_THRESHOLDS, [R.publicKey])), [payer]);
check(true, `forge created with tiers at 0.77/1.77/3.77/7.77 ROCK and router ${short(R.publicKey)}`);

// ---- Trades -----------------------------------------------------------------------
await buy(A, pool, 1, 'A buys 1 SOL');                                   // #0 BUY A  -> Plasma
await buy(A, pool, 0.3, 'A buys 0.3 SOL');                               // #1 BUY A  -> White-hot
await buy(C, pool, 0.5, 'C buys 0.5 SOL');                               // #2 BUY C  -> Blue Flame
await buy(B, pool, 0.05, 'B buys 0.05 SOL');                             //    under the minimum
await send('A sends 1 ROCK to B', new Transaction().add(...await transferIxs(A.publicKey, B.publicKey, mint, 1e9)), [A]); // #3 TRANSFER A->B
await buy(A, pool, 0.2, 'A buys 0.2 SOL after sending');                 // #4 BUY A  -> new, lit
{ // The router buys 4 ROCK and hands them to D in the same transaction.  #5 BUY router, #6 TRANSFER router->D
  const tx = await buyExactOutTx(R.publicKey, pool, 4e9, 2);
  tx.add(...await transferIxs(R.publicKey, D.publicKey, mint, 4e9));
  await send('router buys for D', tx, [R]);
}
await buy(R, pool, 0.2, 'router buys and keeps');                        // #7 BUY router, no hand-off -> skipped
await sell(C, pool, 1e9, 'C sells 1 ROCK');                              // #8 SELL C
await buy(E, pool, 4, 'E buys 4 SOL');                                   // #9 BUY E  -> biggest buyer

const { head, entries } = await readLedger(ledger);
console.log(`\nledger (${head} entries)`);
for (const e of entries) console.log(`  #${e.seq} ${e.kindName.padEnd(8)} ${rock(e.amount).toFixed(4).padStart(8)} ROCK  from ${nameOf(e.from).padEnd(7)} ${e.to ? `to ${nameOf(e.to)}` : ''}`);
check(head === 10, `10 entries recorded (got ${head})`);

// ---- The program refuses a wrong crank ------------------------------------------
{
  let err = await sendExpectError('wrong wallet', new Transaction().add(ix.processBuy(cranker.publicKey, mint, ledger, 0, B.publicKey)), [cranker]);
  check(/WrongWallet/.test(err ?? ''), 'process_buy crediting the wrong wallet is rejected');
  err = await sendExpectError('wrong seq', new Transaction().add(ix.processBuy(cranker.publicKey, mint, ledger, 1, A.publicKey)), [cranker]);
  check(/WrongSeq/.test(err ?? ''), 'process_buy for a buy that is not next is rejected');
  err = await sendExpectError('wrong kind', new Transaction().add(ix.processOuts(mint, ledger, [A.publicKey])), [cranker]);
  check(/WrongEntryKind/.test(err ?? ''), 'process_outs while a buy comes first is rejected');
  err = await sendExpectError('skip a normal buy', new Transaction().add(ix.processSkip(mint, ledger)), [cranker]);
  check(/NotSkippable/.test(err ?? ''), 'process_skip on a normal buy is rejected');
}

// ---- Crank everything -------------------------------------------------------------
const processed = await crank(cranker, mint, ledger);
const forge = await readForge(mint);
const rings = await readLedger(ledger);
check(forge.nextBuy === rings.buyCount && forge.nextOut === rings.outCount,
  `crank read both rings to the end in ${processed} steps (${rings.buyCount} buy-ring and ${rings.outCount} out-ring entries)`);
check(forge.tickets === 6, `6 tickets: A x3, C, D, E (got ${forge.tickets})`);

console.log('\ntickets');
const tickets = {};
for (const seq of [0, 1, 2, 4, 5, 9]) {
  const t = await readTicket(mint, seq);
  tickets[seq] = t;
  console.log(`  #${t.number} seq ${seq}  ${nameOf(t.wallet).padEnd(3)} ${rock(t.amount).toFixed(4).padStart(8)} ROCK  ${TIER_NAMES[t.tier]}`);
}
check(tickets[0].tier === 4 && tickets[1].tier === 2 && tickets[2].tier === 3 && tickets[4].tier === 1,
  'tiers: A 1 SOL Plasma, A 0.3 SOL White-hot, C 0.5 SOL Blue Flame, A 0.2 SOL Flame');
check(tickets[5].wallet.equals(D.publicKey) && tickets[5].amount === 4000000000n, 'router buy credited to D with the 4 ROCK handed off');
check(tickets[9].tier === 4, 'E 4 SOL Plasma');
check(!(await readTicket(mint, 7)), 'router kept its own buy: no ticket');

const hA = await readHolder(mint, A.publicKey), hC = await readHolder(mint, C.publicKey), hD = await readHolder(mint, D.publicKey);
check(hA.tickets === 3 && hA.burnBeforeSeq === 4 && hA.litWeight === tickets[4].amount,
  `A: 3 tickets, the two before the send (#3) burnt, the one after lit (lit ${rock(hA.litWeight).toFixed(4)} ROCK)`);
check(hC.burnBeforeSeq === 9 && hC.litWeight === 0n, 'C: sold at #8, ticket burnt');
check(hD && hD.litWeight === 4000000000n, 'D: holder created through the router, lit');
check(!(await readHolder(mint, B.publicKey)), 'B: only received a transfer and bought under the minimum, no holder');
check(!(await readHolder(mint, R.publicKey)), 'router: no holder');

const expectedLit = tickets[4].amount + tickets[5].amount + tickets[9].amount;
check(forge.litWeight === expectedLit, `lit weight = A's last buy + D + E (${rock(forge.litWeight).toFixed(4)} ROCK)`);
check(forge.biggestWallet.equals(E.publicKey), `biggest buyer on the curve: ${nameOf(forge.biggestWallet)} with ${rock(forge.biggestTotal).toFixed(4)} ROCK (A has ${rock(hA.totalBought).toFixed(4)})`);
check(forge.lastBuyWallet.equals(E.publicKey) && forge.lastBuySeq === 9, 'last ticketed buy: E at #9');

// ---- More trades after a crank: it picks up where it left off ----------------------
await sell(E, pool, 1e9, 'E sells 1 ROCK');                              // #10 SELL E
await crank(cranker, mint, ledger);
const hE = await readHolder(mint, E.publicKey);
const forge2 = await readForge(mint);
check(hE.litWeight === 0n && forge2.litWeight === tickets[4].amount + tickets[5].amount, 'E sold later: its Plasma burns, lit weight drops');
check(forge2.biggestWallet.equals(E.publicKey), 'E stays the biggest buyer on the curve even after selling');

finish();
