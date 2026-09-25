use anchor_lang::prelude::*;
use mpl_core::instructions::UpdateV1CpiBuilder;

use crate::{constants::*, error::HookError, state::*};

/// Switches a Rocky to the ash artwork once its wallet sold or sent after the
/// buy. Anyone can call it; the holder record proves it.
#[derive(Accounts)]
pub struct Extinguish<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [ROCKIES_SEED, rockies.mint.as_ref()], bump = rockies.bump)]
    pub rockies: Account<'info, Rockies>,
    #[account(
        mut,
        seeds = [TICKET_SEED, rockies.mint.as_ref(), &ticket.seq.to_le_bytes()],
        bump = ticket.bump,
    )]
    pub ticket: Account<'info, Ticket>,
    #[account(seeds = [HOLDER_SEED, rockies.mint.as_ref(), ticket.wallet.as_ref()], bump = holder.bump)]
    pub holder: Account<'info, Holder>,
    /// CHECK: PDA that signs for the collection.
    #[account(seeds = [AUTHORITY_SEED, rockies.mint.as_ref()], bump = rockies.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: the Rockies collection.
    #[account(address = rockies.collection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: this ticket's Rocky.
    #[account(mut, seeds = [ROCKY_SEED, rockies.mint.as_ref(), &ticket.seq.to_le_bytes()], bump)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = mpl_core::ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<Extinguish>) -> Result<()> {
    let ticket = &ctx.accounts.ticket;
    require!(ticket.minted, HookError::NotMinted);
    require!(!ticket.supernova, HookError::IsSupernova);
    require!(!ticket.ashed, HookError::AlreadyAshed);
    require!(ctx.accounts.holder.burn_before_seq > ticket.seq, HookError::NotBurnt);

    let rockies = &ctx.accounts.rockies;
    let mint = rockies.mint;
    let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, mint.as_ref(), &[rockies.authority_bump]];
    UpdateV1CpiBuilder::new(&ctx.accounts.core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .payer(&ctx.accounts.payer.to_account_info())
        .authority(Some(&ctx.accounts.authority.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .new_uri(rockies.uri(SLUG_BURNT_OUT))
        .invoke_signed(&[authority_seeds])?;

    ctx.accounts.ticket.ashed = true;
    Ok(())
}
