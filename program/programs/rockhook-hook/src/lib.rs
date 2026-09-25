pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use spl_discriminator::SplDiscriminate;
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("342z5Sawvar7fcAiyt9J82ysEYs5rGaJp5wuH27Q9AAS");

#[program]
pub mod rockhook_hook {
    use super::*;

    /// Sets the hook up for one mint: its state, the ledger and the
    /// extra-account list Token-2022 reads on every transfer.
    pub fn initialize(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
        initialize::handler(ctx, args)
    }

    /// Kill switch. While paused the hook records nothing, so it can never
    /// block trading.
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        set_paused::handler(ctx, paused)
    }

    /// Called by Token-2022 on every $ROCK transfer.
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        transfer_hook::handler(ctx, amount)
    }

    /// Creates the forge that turns ledger entries into tickets.
    pub fn init_forge(ctx: Context<InitForge>, tier_thresholds: [u64; 4], routers: Vec<Pubkey>) -> Result<()> {
        init_forge::handler(ctx, tier_thresholds, routers)
    }

    /// Replaces the list of router accounts whose buys are handed off to users.
    pub fn set_routers(ctx: Context<SetRouters>, routers: Vec<Pubkey>) -> Result<()> {
        set_routers::handler(ctx, routers)
    }

    /// Next ledger entry is a buy: create its ticket.
    pub fn process_buy(ctx: Context<ProcessBuy>, wallet: Pubkey, seq: u64) -> Result<()> {
        process_buy::handler(ctx, wallet, seq)
    }

    /// Next ledger entries are sells or sends: burn out the senders' tickets.
    pub fn process_outs<'info>(ctx: Context<'info, ProcessOuts<'info>>, holders: Vec<u8>) -> Result<()> {
        process_outs::handler(ctx, holders)
    }

    /// Next buy-ring entry has no user to credit: skip it.
    pub fn process_skip(ctx: Context<ProcessSkip>) -> Result<()> {
        process_skip::handler(ctx)
    }

    /// Recovers from a ledger ring that wrapped past unread entries.
    pub fn recover_overflow(ctx: Context<RecoverOverflow>) -> Result<()> {
        recover_overflow::handler(ctx)
    }

    /// Creates the frozen Rockies collection, owned by the program.
    pub fn init_collection(
        ctx: Context<InitCollection>,
        name: String,
        uri: String,
        uri_base: String,
        royalty_bps: u16,
    ) -> Result<()> {
        init_collection::handler(ctx, name, uri, uri_base, royalty_bps)
    }

    /// Mints a ticket's Rocky to the ticket's wallet.
    pub fn mint_rocky(ctx: Context<MintRocky>) -> Result<()> {
        mint_rocky::handler(ctx)
    }

    /// Switches a Rocky to ash after its wallet sold or sent.
    pub fn extinguish(ctx: Context<Extinguish>) -> Result<()> {
        extinguish::handler(ctx)
    }

    /// Freezes the results once the curve graduated.
    pub fn finalize(ctx: Context<Finalize>) -> Result<()> {
        finalize::handler(ctx)
    }

    /// Fixes the random Supernova's target from a slot hash.
    pub fn draw(ctx: Context<Draw>) -> Result<()> {
        draw::handler(ctx)
    }

    /// Walks lit tickets until the random Supernova is found.
    pub fn walk<'info>(ctx: Context<'info, Walk<'info>>) -> Result<()> {
        walk::handler(ctx)
    }

    /// Turns a winning Rocky into a Supernova.
    pub fn crown(ctx: Context<Crown>) -> Result<()> {
        crown::handler(ctx)
    }

    /// Unfreezes the collection after graduation.
    pub fn thaw(ctx: Context<Thaw>) -> Result<()> {
        thaw::handler(ctx)
    }

    /// Closes the ledger after graduation and returns its rent to the admin.
    pub fn close_ledger(ctx: Context<CloseLedger>) -> Result<()> {
        close_ledger::handler(ctx)
    }
}
