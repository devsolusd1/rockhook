use anchor_lang::prelude::*;

use crate::constants::{LEDGER_CAPACITY, MAX_ROUTERS};

/// One per mint: where the hook looks for the curve and where it writes.
#[account]
#[derive(InitSpace)]
pub struct HookState {
    pub admin: Pubkey,
    pub mint: Pubkey,
    /// The Meteora DBC virtual pool of this mint, read for the price.
    pub dbc_pool: Pubkey,
    /// The pool's base vault: tokens leaving it are buys, tokens entering it are sells.
    pub base_vault: Pubkey,
    pub ledger: Pubkey,
    /// Buys worth less than this (valued at the curve price) are not recorded.
    pub min_buy_lamports: u64,
    /// Kill switch: while set, the hook records nothing and never gets in the way of a trade.
    pub paused: bool,
    pub bump: u8,
}

/// One recorded transfer.
#[zero_copy]
pub struct Entry {
    /// Position in the ledger since it was created; never reused.
    pub seq: u64,
    pub slot: u64,
    /// $ROCK moved, in base units.
    pub amount: u64,
    /// Buys only: the amount valued in lamports at the curve price.
    pub value_lamports: u64,
    /// Wallet that owned the source token account.
    pub from: Pubkey,
    /// Wallet that owns the destination token account.
    pub to: Pubkey,
    pub kind: u8,
    pub padding: [u8; 7],
}

/// Ring buffer of entries. The hook only appends; a crank reads entries out
/// before they are overwritten.
#[account(zero_copy)]
pub struct Ledger {
    pub state: Pubkey,
    /// Number of entries ever written; the next entry gets this `seq`.
    pub head: u64,
    pub entries: [Entry; LEDGER_CAPACITY],
}

impl Ledger {
    /// The entry with this `seq`, if it was written and not overwritten since.
    pub fn entry(&self, seq: u64) -> Result<Entry> {
        require!(seq < self.head, crate::error::HookError::EntryNotWritten);
        require!(self.head - seq <= LEDGER_CAPACITY as u64, crate::error::HookError::EntryLost);
        Ok(self.entries[(seq % LEDGER_CAPACITY as u64) as usize])
    }
}

/// Turns ledger entries into holders and tickets, in order. One per mint.
#[account]
#[derive(InitSpace)]
pub struct Forge {
    pub mint: Pubkey,
    /// Next ledger `seq` to process.
    pub next_seq: u64,
    /// Entries overwritten before they were processed (should stay 0).
    pub lost: u64,
    pub tickets: u32,
    /// Sum of the $ROCK of every ticket.
    pub total_weight: u64,
    /// Sum of the $ROCK of tickets whose wallet hasn't sold or sent since.
    pub lit_weight: u64,
    /// Wallet with the most $ROCK bought in total (first to reach it wins ties).
    pub biggest_wallet: Pubkey,
    pub biggest_total: u64,
    /// Runner-up: gets the biggest-buyer Supernova when the biggest buyer's
    /// biggest buy is also the buy that filled the curve.
    pub second_wallet: Pubkey,
    pub second_total: u64,
    /// Latest ticketed buy: at graduation, the buy that filled the curve.
    pub last_buy_seq: u64,
    pub last_buy_wallet: Pubkey,
    /// Base units at which each tier starts: Flame, White-hot, Blue Flame, Plasma.
    pub tier_thresholds: [u64; 4],
    pub routers: [Pubkey; MAX_ROUTERS],
    pub bump: u8,
}

impl Forge {
    /// 0 Ember, 1 Flame, 2 White-hot, 3 Blue Flame, 4 Plasma.
    pub fn tier_for(&self, amount: u64) -> u8 {
        self.tier_thresholds.iter().filter(|&&t| amount >= t).count() as u8
    }

    /// Keeps the top two wallets by total bought after `wallet` reached `total`.
    /// Totals only grow, so the runner-up is always the best of the rest.
    pub fn rank(&mut self, wallet: Pubkey, total: u64) {
        if wallet == self.biggest_wallet {
            self.biggest_total = total;
        } else if total > self.biggest_total {
            self.second_wallet = self.biggest_wallet;
            self.second_total = self.biggest_total;
            self.biggest_wallet = wallet;
            self.biggest_total = total;
        } else if wallet == self.second_wallet {
            self.second_total = total;
        } else if total > self.second_total {
            self.second_wallet = wallet;
            self.second_total = total;
        }
    }

    pub fn is_router(&self, key: &Pubkey) -> bool {
        *key != Pubkey::default() && self.routers.contains(key)
    }

    pub fn routers_from(routers: &[Pubkey]) -> Result<[Pubkey; MAX_ROUTERS]> {
        require!(routers.len() <= MAX_ROUTERS, crate::error::HookError::TooManyRouters);
        let mut out = [Pubkey::default(); MAX_ROUTERS];
        out[..routers.len()].copy_from_slice(routers);
        Ok(out)
    }
}

/// A router buy is handed off when the router sends the tokens on in the same
/// transaction: the very next entry is a transfer out of the router, same slot.
pub fn handoff(ledger: &Ledger, buy: &Entry) -> Option<Entry> {
    let next = ledger.entry(buy.seq + 1).ok()?;
    (next.kind == crate::constants::KIND_TRANSFER && next.from == buy.to && next.slot == buy.slot).then_some(next)
}

/// One per wallet that ever got a ticket.
#[account]
#[derive(InitSpace)]
pub struct Holder {
    pub wallet: Pubkey,
    pub tickets: u32,
    /// $ROCK bought across all tickets, for the biggest-buyer Supernova.
    pub total_bought: u64,
    /// $ROCK of this wallet's tickets that are still lit.
    pub lit_weight: u64,
    /// Tickets whose `seq` is below this are burnt out (0 = none): set to the
    /// latest sell or send out, plus one.
    pub burn_before_seq: u64,
    pub biggest_buy_seq: u64,
    pub biggest_buy_amount: u64,
    pub bump: u8,
}

/// One per recorded buy; becomes one Rocky.
#[account]
#[derive(InitSpace)]
pub struct Ticket {
    pub wallet: Pubkey,
    /// Ledger `seq` of the buy.
    pub seq: u64,
    pub slot: u64,
    /// $ROCK received, in base units.
    pub amount: u64,
    pub value_lamports: u64,
    /// 1 for the first ticket, 2 for the next...
    pub number: u32,
    pub tier: u8,
    pub minted: bool,
    /// The Rocky shows the ash artwork.
    pub ashed: bool,
    /// The Rocky went supernova at graduation.
    pub supernova: bool,
    pub bump: u8,
}

/// The Rockies collection and the graduation draw. One per mint.
#[account]
#[derive(InitSpace)]
pub struct Rockies {
    pub mint: Pubkey,
    pub collection: Pubkey,
    /// Metadata JSONs live at `{uri_base}{tier-slug}.json`.
    #[max_len(120)]
    pub uri_base: String,
    pub graduated: bool,
    /// Graduation snapshot.
    pub lit_snapshot: u64,
    /// Lit weight in the random draw: the snapshot minus the two other winners,
    /// so the draw always lands on a different Rocky.
    pub draw_weight: u64,
    pub last_buy_seq: u64,
    pub biggest_buy_seq: u64,
    pub has_tickets: bool,
    /// The draw uses the hash of this slot, unknown when it is set.
    pub draw_slot: u64,
    pub drawn: bool,
    /// Point on the lit weight that picks the random Supernova.
    pub draw_target: u64,
    /// Walk through lit tickets in ticket order until the target is passed.
    pub walk_next_number: u32,
    pub walk_cumulative: u64,
    pub random_done: bool,
    pub random_winner_seq: u64,
    pub thawed: bool,
    pub bump: u8,
    pub authority_bump: u8,
    pub collection_bump: u8,
}

impl Rockies {
    /// Ledger seqs of the tickets that go supernova (the random one once drawn).
    pub fn is_winner(&self, seq: u64) -> bool {
        self.has_tickets
            && (seq == self.last_buy_seq
                || seq == self.biggest_buy_seq
                || (self.random_done && self.draw_weight > 0 && seq == self.random_winner_seq))
    }

    /// The filling buy and the biggest buyer's buy are left out of the draw.
    pub fn in_draw(&self, seq: u64) -> bool {
        seq != self.last_buy_seq && seq != self.biggest_buy_seq
    }

    pub fn uri(&self, slug: &str) -> String {
        format!("{}{}.json", self.uri_base, slug)
    }
}
