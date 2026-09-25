// Phase 3: Rockies. Mint from tickets, frozen collection, burn-out, graduation
// (finalize, draw, walk, crown) and thaw — against Meteora DBC and Metaplex Core.
import {
  Keypair, Transaction, ComputeBudgetProgram, check, finish, fund, launch, buy, sell, transferIxs, send, sendExpectError,
  ix, rockyIx, crank, readForge, readHolder, readTicket, readRockies, readAsset, readLedger, rock, short,
  collectionPda, rockyPda, ticketPda, holderPda, conn, TIER_THRESHOLDS, dbc,
} from './lib.mjs';

const URI_BASE = 'https://rockhook.fun/nft/meta/';
const payer = Keypair.generate(), bot = Keypair.generate();
const [A, B, C, D, E] = Array.from({ length: 5 }, () => Keypair.generate());
await Promise.all([payer, bot, A, B, C, D, E].map((k) => fund(k.publicKey, k === payer ? 5000 : 300)));
const names = new Map([[A, 'A'], [B, 'B'], [C, 'C'], [D, 'D'], [E, 'E'], [payer, 'payer']].map(([k, n]) => [k.publicKey.toBase58(), n]));
const nameOf = (pk) => names.get(pk.toBase58()) ?? short(pk);
const cu = (units) => ComputeBudgetProgram.setComputeUnitLimit({ units });

const { mint, pool, ledger } = await launch(payer);
await send('init forge', new Transaction().add(ix.initForge(payer.publicKey, mint, TIER_THRESHOLDS, [])), [payer]);
await send('init collection', new Transaction().add(
  rockyIx.initCollection(payer.publicKey, mint, 'RockHook Rockies', 'https://rockhook.fun/nft/meta/collection.json', URI_BASE, 500),
), [payer]);
const collection = collectionPda(mint);
check(!!(await conn.getAccountInfo(collection)), `Rockies collection created at ${short(collection)} (5% royalty, frozen)`);

/** What the forge bot does: crank, then mint every ticket not minted yet, then burn out whoever sold. */
async function forgeRound() {
  await crank(bot, mint, ledger);
  const forge = await readForge(mint);
  const { entries } = await readLedger(ledger);
  for (const e of entries.filter((x) => x.seq < forge.nextSeq)) {
    const t = await readTicket(mint, e.seq);
    if (!t) continue;
    if (!t.minted) await send(`mint rocky seq ${e.seq}`, new Transaction().add(cu(300_000), rockyIx.mint(bot.publicKey, mint, e.seq, t.wallet)), [bot]);
    const t2 = await readTicket(mint, e.seq);
    const h = await readHolder(mint, t2.wallet);
    if (t2.minted && !t2.ashed && !t2.supernova && h.burnBeforeSeq > t2.seq) {
      await send(`extinguish seq ${e.seq}`, new Transaction().add(cu(300_000), rockyIx.extinguish(bot.publicKey, mint, e.seq, t2.wallet)), [bot]);
    }
  }
}
async function showRockies(label) {
  const forge = await readForge(mint);
  console.log(`\n${label}`);
  const { entries } = await readLedger(ledger);
  for (const e of entries) {
    const t = await readTicket(mint, e.seq);
    if (!t) continue;
    const a = await readAsset(rockyPda(mint, e.seq));
    console.log(`  ${a ? a.name.padEnd(14) : '(not minted)'.padEnd(14)} ${nameOf(t.wallet).padEnd(5)} ${rock(t.amount).toFixed(3).padStart(8)} ROCK  ${a ? a.uri.replace(URI_BASE, '') : ''}`);
  }
  return forge;
}

// ---- Buys, a send, a sell ----------------------------------------------------------
await buy(A, pool, 1, 'A buys 1 SOL');        // Plasma
await buy(B, pool, 0.3, 'B buys 0.3 SOL');    // White-hot
await buy(C, pool, 0.5, 'C buys 0.5 SOL');    // Blue Flame
await forgeRound();
{
  const a = await readAsset(rockyPda(mint, 0));
  check(a && a.owner.equals(A.publicKey) && a.uri === `${URI_BASE}plasma.json` && a.name === 'Rocky #1', `A's Rocky minted to A: ${a?.name} ${a?.uri.replace(URI_BASE, '')}`);
  check(a.updateAuthority.equals(collection), 'the Rocky belongs to the Rockies collection');
  const err = await sendExpectError('A moves a frozen Rocky', new Transaction().add(rockyIx.coreTransfer(A.publicKey, rockyPda(mint, 0), collection, D.publicKey)), [A]);
  check(err !== null, 'during the curve a Rocky can\'t be transferred (collection frozen)');
  const err2 = await sendExpectError('mint twice', new Transaction().add(cu(300_000), rockyIx.mint(bot.publicKey, mint, 0, A.publicKey)), [bot]);
  check(/AlreadyMinted/.test(err2 ?? ''), 'the same ticket can\'t mint twice');
  const err3 = await sendExpectError('extinguish a lit Rocky', new Transaction().add(cu(300_000), rockyIx.extinguish(bot.publicKey, mint, 0, A.publicKey)), [bot]);
  check(/NotBurnt/.test(err3 ?? ''), 'a lit Rocky can\'t be burnt out');
}

await send('B sends 0.5 ROCK to D', new Transaction().add(...await transferIxs(B.publicKey, D.publicKey, mint, 5e8)), [B]);
await sell(C, pool, 1e9, 'C sells 1 ROCK');
await buy(E, pool, 200, 'E buys 200 SOL');    // the biggest buyer, bigger than the buy that fills the curve
await buy(D, pool, 0.4, 'D buys 0.4 SOL');
await forgeRound();
{
  const b = await readAsset(rockyPda(mint, 1)), c = await readAsset(rockyPda(mint, 2));
  check(b.uri === `${URI_BASE}burnt-out.json`, 'B sent tokens away: its Rocky turned to ash');
  check(c.uri === `${URI_BASE}burnt-out.json`, 'C sold: its Rocky turned to ash');
}

// ---- Graduation --------------------------------------------------------------------
{
  const f = await readForge(mint);
  const err = await sendExpectError('finalize early', new Transaction().add(rockyIx.finalize(mint, ledger, f, (await readHolder(mint, f.biggestWallet)).biggestBuySeq)), [bot]);
  check(/NotGraduated/.test(err ?? ''), 'finalize before graduation is rejected');
}
await buy(payer, pool, 1000, 'payer fills the curve');   // the graduating buy
await forgeRound();
let forge = await showRockies('Rockies before graduation is finalized');
await send('finalize', new Transaction().add(rockyIx.finalize(mint, ledger, forge, (await readHolder(mint, forge.biggestWallet)).biggestBuySeq)), [bot]);
let rockies = await readRockies(mint);
check(rockies.graduated && rockies.lastBuySeq === forge.lastBuySeq, `graduated: filling buy by ${nameOf(forge.lastBuyWallet)} (seq ${rockies.lastBuySeq}), biggest buyer ${nameOf(forge.biggestWallet)} (seq ${rockies.biggestBuySeq})`);
check(rockies.drawWeight < rockies.litSnapshot, `the draw leaves out those two: ${rock(rockies.drawWeight).toFixed(3)} of ${rock(rockies.litSnapshot).toFixed(3)} lit ROCK in the draw`);

// Draw once the draw slot has passed.
{
  const err = await sendExpectError('draw too early', new Transaction().add(rockyIx.draw(mint)), [bot]);
  check(err === null || /DrawTooEarly/.test(err), 'draw waits for its slot');
  while ((await conn.getSlot('confirmed')) <= rockies.drawSlot + 1) await new Promise((r) => setTimeout(r, 400));
  if (!(await readRockies(mint)).drawn) await send('draw', new Transaction().add(rockyIx.draw(mint)), [bot]);
  rockies = await readRockies(mint);
  check(rockies.drawn && rockies.drawTarget < rockies.drawWeight, `draw target ${rock(rockies.drawTarget).toFixed(3)} of ${rock(rockies.drawWeight).toFixed(3)} ROCK in the draw`);
}
// Walk tickets in order, three at a time, like the bot would.
{
  forge = await readForge(mint);
  const { entries } = await readLedger(ledger);
  const tickets = [];
  for (const e of entries) { const t = await readTicket(mint, e.seq); if (t) tickets.push(t); }
  tickets.sort((x, y) => x.number - y.number);
  const bad = await sendExpectError('walk out of order', new Transaction().add(rockyIx.walk(mint, [[ticketPda(mint, tickets[1].seq), holderPda(mint, tickets[1].wallet)]])), [bot]);
  check(/WrongTicket/.test(bad ?? ''), 'walking out of order is rejected');
  let cumulative = 0n, expected = null;
  for (const t of tickets) {
    const h = await readHolder(mint, t.wallet);
    const inDraw = t.seq !== rockies.lastBuySeq && t.seq !== rockies.biggestBuySeq;
    if (h.burnBeforeSeq <= t.seq && inDraw) { cumulative += t.amount; if (expected === null && cumulative > rockies.drawTarget) expected = t.seq; }
  }
  while (!(await readRockies(mint)).randomDone) {
    const next = (await readRockies(mint)).walkNextNumber;
    const batch = tickets.filter((t) => t.number >= next).slice(0, 3);
    await send(`walk from #${next}`, new Transaction().add(rockyIx.walk(mint, batch.map((t) => [ticketPda(mint, t.seq), holderPda(mint, t.wallet)]))), [bot]);
  }
  rockies = await readRockies(mint);
  const winner = await readTicket(mint, rockies.randomWinnerSeq);
  check(rockies.randomWinnerSeq === expected, `random Supernova: ticket #${winner.number} (${nameOf(winner.wallet)}), matches an independent recount`);
}
// Crown the three and thaw.
{
  const winners = [...new Set([rockies.lastBuySeq, rockies.biggestBuySeq, rockies.randomWinnerSeq])];
  check(winners.length === 3, `three different Supernovas: seqs ${winners.join(', ')}`);
  for (const seq of winners) await send(`crown seq ${seq}`, new Transaction().add(cu(300_000), rockyIx.crown(bot.publicKey, mint, seq)), [bot]);
  for (const seq of winners) {
    const a = await readAsset(rockyPda(mint, seq));
    check(a.uri === `${URI_BASE}supernova.json` && a.name.startsWith('Supernova #'), `${a.name} is a Supernova`);
  }
  const loser = (await readLedger(ledger)).entries.find((e) => e.kind === 1 && !winners.includes(e.seq));
  const err = await sendExpectError('crown a loser', new Transaction().add(cu(300_000), rockyIx.crown(bot.publicKey, mint, loser.seq)), [bot]);
  check(/NotAWinner/.test(err ?? ''), 'a non-winning Rocky can\'t be crowned');

  await send('thaw', new Transaction().add(cu(300_000), rockyIx.thaw(bot.publicKey, mint)), [bot]);
  const aSeq = 0;
  await send('A moves its Rocky after thaw', new Transaction().add(rockyIx.coreTransfer(A.publicKey, rockyPda(mint, aSeq), collection, D.publicKey)), [A]);
  const moved = await readAsset(rockyPda(mint, aSeq));
  check(moved.owner.equals(D.publicKey), 'after graduation the collection is thawed: A transferred its Rocky to D');
}
await showRockies('Final collection');
finish();
