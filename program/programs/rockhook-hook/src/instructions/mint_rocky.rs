use anchor_lang::prelude::*;
use mpl_core::instructions::CreateV2CpiBuilder;

use crate::{constants::*, error::HookError, state::*};

/// Mints a ticket's Rocky to the ticket's wallet. Anyone can call it and pays
/// the rent: the forge bot does it right after each buy, or the buyer claims it.
#[derive(Accounts)]
pub struct MintRocky<'info> {
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
    /// CHECK: receives the Rocky.
    #[account(address = ticket.wallet)]
    pub owner: UncheckedAccount<'info>,
    /// CHECK: PDA that signs for the collection.
    #[account(seeds = [AUTHORITY_SEED, rockies.mint.as_ref()], bump = rockies.authority_bump)]
    pub authority: UncheckedAccount<'info>,
    /// CHECK: the Rockies collection.
    #[account(mut, address = rockies.collection)]
    pub collection: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core creates the Rocky at this PDA.
    #[account(mut, seeds = [ROCKY_SEED, rockies.mint.as_ref(), &ticket.seq.to_le_bytes()], bump)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: Metaplex Core.
    #[account(address = mpl_core::ID)]
    pub core_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<MintRocky>) -> Result<()> {
    let rockies = &ctx.accounts.rockies;
    let ticket = &ctx.accounts.ticket;
    require!(!ticket.minted, HookError::AlreadyMinted);

    let burnt = ctx.accounts.holder.burn_before_seq > ticket.seq;
    let supernova = rockies.graduated && rockies.is_winner(ticket.seq);
    let slug = if supernova {
        SLUG_SUPERNOVA
    } else if burnt {
        SLUG_BURNT_OUT
    } else {
        TIER_SLUGS[ticket.tier as usize]
    };
    let name = if supernova { format!("Supernova #{}", ticket.number) } else { format!("Rocky #{}", ticket.number) };

    let mint = rockies.mint;
    let seq = ticket.seq.to_le_bytes();
    let asset_seeds: &[&[u8]] = &[ROCKY_SEED, mint.as_ref(), &seq, &[ctx.bumps.asset]];
    let authority_seeds: &[&[u8]] = &[AUTHORITY_SEED, mint.as_ref(), &[rockies.authority_bump]];
    CreateV2CpiBuilder::new(&ctx.accounts.core_program.to_account_info())
        .asset(&ctx.accounts.asset.to_account_info())
        .collection(Some(&ctx.accounts.collection.to_account_info()))
        .authority(Some(&ctx.accounts.authority.to_account_info()))
        .payer(&ctx.accounts.payer.to_account_info())
        .owner(Some(&ctx.accounts.owner.to_account_info()))
        .system_program(&ctx.accounts.system_program.to_account_info())
        .name(name)
        .uri(rockies.uri(slug))
        .invoke_signed(&[asset_seeds, authority_seeds])?;

    let ticket = &mut ctx.accounts.ticket;
    ticket.minted = true;
    ticket.supernova = supernova;
    ticket.ashed = burnt && !supernova;
    Ok(())
}
