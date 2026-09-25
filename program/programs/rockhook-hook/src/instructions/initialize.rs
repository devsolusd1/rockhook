use anchor_lang::prelude::*;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::{constants::*, state::*};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeArgs {
    pub dbc_pool: Pubkey,
    pub base_vault: Pubkey,
    pub min_buy_lamports: u64,
}

/// Sets the hook up for one mint. Runs before the DBC pool exists, so the mint
/// account may not exist yet: only its address is used.
#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    /// CHECK: only the address is used; the mint is created later by the DBC pool.
    pub mint: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + HookState::INIT_SPACE,
        seeds = [STATE_SEED, mint.key().as_ref()],
        bump,
    )]
    pub state: Account<'info, HookState>,
    /// Pre-created by the client at full size (too big to create in a CPI).
    #[account(zero)]
    pub ledger: AccountLoader<'info, Ledger>,
    /// CHECK: created here and filled with the extra-account list Token-2022 reads.
    #[account(
        init,
        payer = admin,
        space = ExtraAccountMetaList::size_of(3).unwrap(),
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub(crate) fn handler(ctx: Context<Initialize>, args: InitializeArgs) -> Result<()> {
    let state = &mut ctx.accounts.state;
    state.admin = ctx.accounts.admin.key();
    state.mint = ctx.accounts.mint.key();
    state.dbc_pool = args.dbc_pool;
    state.base_vault = args.base_vault;
    state.ledger = ctx.accounts.ledger.key();
    state.min_buy_lamports = args.min_buy_lamports;
    state.paused = false;
    state.bump = ctx.bumps.state;

    let mut ledger = ctx.accounts.ledger.load_init()?;
    ledger.state = state.key();
    ledger.head = 0;

    // Every account is fixed per mint. Meteora's SDK resolves the list with
    // placeholder wallets, so nothing here may depend on who is trading.
    let metas = [
        ExtraAccountMeta::new_with_pubkey(&state.key(), false, false)?,
        ExtraAccountMeta::new_with_pubkey(&ctx.accounts.ledger.key(), false, true)?,
        ExtraAccountMeta::new_with_pubkey(&args.dbc_pool, false, false)?,
    ];
    let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
    Ok(())
}
