use anchor_lang::prelude::*;

#[constant]
pub const STATE_SEED: &[u8] = b"state";

#[constant]
pub const FORGE_SEED: &[u8] = b"forge";
#[constant]
pub const HOLDER_SEED: &[u8] = b"holder";
#[constant]
pub const TICKET_SEED: &[u8] = b"ticket";

#[constant]
pub const ROCKIES_SEED: &[u8] = b"rockies";
/// Signs for the collection: update authority and freeze authority.
#[constant]
pub const AUTHORITY_SEED: &[u8] = b"authority";
#[constant]
pub const COLLECTION_SEED: &[u8] = b"collection";
#[constant]
pub const ROCKY_SEED: &[u8] = b"rocky";

/// Metadata file per tier, by `Ticket::tier`.
pub const TIER_SLUGS: [&str; 5] = ["ember", "flame", "white-hot", "blue-flame", "plasma"];
pub const SLUG_BURNT_OUT: &str = "burnt-out";
pub const SLUG_SUPERNOVA: &str = "supernova";

/// The draw waits this many slots after graduation, so the hash it uses is unknown when it is fixed.
pub const DRAW_DELAY_SLOTS: u64 = 8;
/// SlotHashes keeps 512 slots; if nobody draws in time, the draw can be re-armed.
pub const DRAW_REARM_AFTER_SLOTS: u64 = 400;

/// ExtensionType::TransferHook on the mint: authority (32) then program id (32).
pub const EXT_TRANSFER_HOOK: u16 = 14;

/// Aggregator accounts that buy on a user's behalf and pass the tokens on.
pub const MAX_ROUTERS: usize = 4;

/// Seed Token-2022 uses to find a hook's extra-account list.
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

/// Ledger entry kinds.
pub const KIND_BUY: u8 = 1;
pub const KIND_SELL: u8 = 2;
pub const KIND_TRANSFER: u8 = 3;

/// How many entries the ledger ring holds before it wraps.
pub const LEDGER_CAPACITY: usize = 4096;

/// Meteora Dynamic Bonding Curve program.
pub const DBC_PROGRAM_ID: Pubkey = pubkey!("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

/// Byte offset of `pool_state.sqrt_price` (u128, Q64.64) in a DBC VirtualPool account:
/// 8 discriminator + 64 volatility tracker + 5 pubkeys + 6 u64 reserves and fees.
pub const POOL_SQRT_PRICE_OFFSET: usize = 280;

/// Token-2022 account layout: the base account is 165 bytes, then one account-type
/// byte, then the TLV extensions.
pub const TOKEN_ACCOUNT_BASE_LEN: usize = 165;
pub const TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;
/// ExtensionType::TransferHookAccount, whose one-byte value is the `transferring` flag.
pub const EXT_TRANSFER_HOOK_ACCOUNT: u16 = 15;
