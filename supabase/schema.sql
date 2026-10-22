-- =====================================================================
-- SafeWallet API — database schema
-- Run this whole file once in Supabase: Dashboard → SQL Editor → New query
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------
create table if not exists public.accounts (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 100),
  balance     numeric(14, 2) not null default 0 check (balance >= 0),  -- DB refuses negative balances, no matter what the API does
  api_token   text not null unique check (char_length(api_token) >= 32),
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Transfers (audit log of every successful transfer)
-- ---------------------------------------------------------------------
create table if not exists public.transfers (
  id               uuid primary key default gen_random_uuid(),
  from_account_id  uuid not null references public.accounts(id) on delete restrict,
  to_account_id    uuid not null references public.accounts(id) on delete restrict,
  amount           numeric(14, 2) not null check (amount > 0),
  created_at       timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);

-- ---------------------------------------------------------------------
-- Row Level Security: ON, with NO policies.
-- Result: the public anon key (and logged-in Supabase users) can read or
-- write nothing. Only the server, using the service_role / secret key,
-- can touch these tables. api_token values never leak to browsers.
-- ---------------------------------------------------------------------
grant usage on schema public to service_role;
grant select, insert, update, delete on public.accounts, public.transfers to service_role;
revoke all on public.accounts, public.transfers from anon, authenticated;

alter table public.accounts  enable row level security;
alter table public.transfers enable row level security;

-- ---------------------------------------------------------------------
-- Atomic transfer function.
-- supabase-js has no multi-statement transactions, so the money movement
-- happens inside one Postgres function: lock both rows, check funds,
-- debit, credit, log. Either all of it happens or none of it does.
-- ---------------------------------------------------------------------
create or replace function public.transfer_funds(
  p_from   uuid,
  p_to     uuid,
  p_amount numeric
)
returns table (from_balance numeric, to_balance numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_from numeric;
  v_to   numeric;
begin
  -- Defence in depth: re-validate even though the API already did.
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_from = p_to then
    raise exception 'SAME_ACCOUNT';
  end if;

  -- Lock both rows in a consistent order (prevents deadlocks and
  -- race-condition double-spends from parallel requests).
  perform 1 from accounts where id in (p_from, p_to) order by id for update;

  select balance into v_from from accounts where id = p_from;
  select balance into v_to   from accounts where id = p_to;

  if v_from is null or v_to is null then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  if v_from < p_amount then
    raise exception 'INSUFFICIENT_FUNDS';
  end if;

  update accounts set balance = balance - p_amount where id = p_from returning balance into v_from;
  update accounts set balance = balance + p_amount where id = p_to   returning balance into v_to;

  insert into transfers (from_account_id, to_account_id, amount)
  values (p_from, p_to, p_amount);

  return query select v_from, v_to;
end;
$$;

-- Only the server's service role may call it.
revoke all on function public.transfer_funds(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.transfer_funds(uuid, uuid, numeric) to service_role;

-- ---------------------------------------------------------------------
-- Optional demo data: Alice ($500) and Bob ($100) with random tokens.
-- After running, look up their tokens with:
--   select id, name, balance, api_token from accounts;
-- ---------------------------------------------------------------------
insert into public.accounts (name, balance, api_token) values
  ('Alice', 500.00, encode(extensions.gen_random_bytes(32), 'hex')),
  ('Bob',   100.00, encode(extensions.gen_random_bytes(32), 'hex'));
