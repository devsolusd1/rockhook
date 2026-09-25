// After a real run of launch/launch.ts: trade the token it created while the
// forge bot runs from its command line, until graduation. Usage: node test-launcher.mjs <MINT>
import fs from 'fs';
import { spawn } from 'child_process';
import { Keypair, PublicKey, Transaction, check, finish, fund, buy, sell, transferIxs, send, conn } from './lib.mjs';
import { pdas, read } from '../client/rockhook.mjs';

const mint = new PublicKey(process.argv[2]);
const state = await read.state(conn, mint);
check(!!state, `hook state found for ${mint.toBase58().slice(0, 6)} (pool ${state.dbcPool.toBase58().slice(0, 6)})`);
const pool = state.dbcPool;

const bot = Keypair.generate();
const traders = Array.from({ length: 5 }, () => Keypair.generate());
const filler = Keypair.generate();
await Promise.all([bot, filler, ...traders].map((k) => fund(k.publicKey, k === filler ? 2000 : 300)));
const keyFile = '/tmp/forge-bot.json';
fs.writeFileSync(keyFile, JSON.stringify([...bot.secretKey]));

// The bot exactly as on launch day: its own process, from the command line.
const botProc = spawn('node', ['forge/forge.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, MINT: mint.toBase58(), RPC_URL: 'http://127.0.0.1:8899', FORGE_KEYPAIR: keyFile, TICK_MS: '800' },
});
let botLog = '';
botProc.stdout.on('data', (d) => { botLog += d; process.stdout.write(`    [bot] ${d}`); });
botProc.stderr.on('data', (d) => { botLog += d; process.stdout.write(`    [bot!] ${d}`); });
const botDone = new Promise((resolve) => botProc.on('exit', resolve));

await buy(traders[0], pool, 0.8, 't1 buys 0.8 SOL');
await buy(traders[1], pool, 2, 't2 buys 2 SOL');
await buy(traders[2], pool, 0.2, 't3 buys 0.2 SOL');
await sell(traders[1], pool, 5e9, 't2 sells 5 ROCK');
await send('t1 sends 1 ROCK to t4', new Transaction().add(...await transferIxs(traders[0].publicKey, traders[3].publicKey, mint, 1e9)), [traders[0]]);
await buy(traders[4], pool, 60, 't5 buys 60 SOL');
await buy(filler, pool, 1000, 'filler completes the curve');

const code = await Promise.race([botDone, new Promise((r) => setTimeout(() => r('timeout'), 240_000))]);
if (code === 'timeout') botProc.kill();
check(code === 0 && /graduation complete/.test(botLog), 'the forge bot (command line) finished graduation and exited');

const tickets = await read.tickets(conn, mint);
const rockies = await read.rockies(conn, mint);
let minted = 0, supernovas = 0, ash = 0;
for (const t of tickets) {
  const a = await read.asset(conn, pdas.rocky(mint, t.seq));
  if (a) minted++;
  if (a?.uri.endsWith('supernova.json')) supernovas++;
  if (a?.uri.endsWith('burnt-out.json')) ash++;
}
check(minted === tickets.length, `all ${tickets.length} tickets have their Rocky`);
check(supernovas === 3 && ash === 2, `3 Supernovas and 2 burnt out (t1 sent, t2 sold): got ${supernovas} and ${ash}`);
check(rockies.thawed && rockies.uriBase.startsWith('https://ipfs.io/ipfs/'), `collection thawed; metadata base ${rockies.uriBase}`);
finish();
