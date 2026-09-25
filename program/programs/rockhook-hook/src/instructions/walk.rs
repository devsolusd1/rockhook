use anchor_lang::prelude::*;

use crate::{constants::*, error::HookError, state::*};

/// Walks tickets in ticket-number order, adding up the $ROCK of the lit ones,
/// until the total passes the draw target: that ticket is the random
/// Supernova. Pass (ticket, holder) pairs in `remaining_accounts`, starting at
/// `walk_next_number`. Anyone can call it, as many times as needed.
#[derive(Accounts)]
pub struct Walk<'info> {
    #[account(mut, seeds = [ROCKIES_SEED, rockies.mint.as_ref()], bump = rockies.bump)]
    pub rockies: Account<'info, Rockies>,
}

pub(crate) fn handler<'info>(ctx: Context<'info, Walk<'info>>) -> Result<()> {
    let rockies = &mut ctx.accounts.rockies;
    require!(rockies.drawn, HookError::NotDrawn);
    require!(!rockies.random_done, HookError::WalkDone);
    let mint = rockies.mint;

    for pair in ctx.remaining_accounts.chunks(2) {
        let [ticket_info, holder_info] = pair else { return err!(HookError::WrongTicket) };
        require!(ticket_info.owner == &crate::ID && holder_info.owner == &crate::ID, HookError::WrongTicket);
        let ticket = Ticket::try_deserialize(&mut &ticket_info.try_borrow_data()?[..])?;
        let holder = Holder::try_deserialize(&mut &holder_info.try_borrow_data()?[..])?;
        require!(ticket.number == rockies.walk_next_number, HookError::WrongTicket);
        let ticket_key = Pubkey::create_program_address(
            &[TICKET_SEED, mint.as_ref(), &ticket.seq.to_le_bytes(), &[ticket.bump]],
            &crate::ID,
        )
        .map_err(|_| HookError::WrongTicket)?;
        let holder_key = Pubkey::create_program_address(
            &[HOLDER_SEED, mint.as_ref(), ticket.wallet.as_ref(), &[holder.bump]],
            &crate::ID,
        )
        .map_err(|_| HookError::WrongTicket)?;
        require!(ticket_key == ticket_info.key() && holder_key == holder_info.key(), HookError::WrongTicket);

        rockies.walk_next_number += 1;
        let lit = holder.burn_before_seq <= ticket.seq;
        if lit && rockies.in_draw(ticket.seq) {
            rockies.walk_cumulative += ticket.amount;
            if rockies.walk_cumulative > rockies.draw_target {
                rockies.random_winner_seq = ticket.seq;
                rockies.random_done = true;
                msg!("random Supernova: ticket #{}", ticket.number);
                break;
            }
        }
    }
    Ok(())
}
