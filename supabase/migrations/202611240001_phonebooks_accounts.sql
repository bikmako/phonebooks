begin;

create schema phonebooks_private;
revoke all on schema phonebooks_private from public, anon, authenticated;

create table phonebooks_private.accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  trial_started_at timestamptz,
  paid_until timestamptz,
  lifetime boolean not null default false,
  blocked boolean not null default false,
  source text not null default '',
  partner text not null default ''
);
create table phonebooks_private.owners (
  user_id uuid primary key references auth.users(id) on delete restrict
);
create table phonebooks_private.admin_log (
  request_id uuid primary key,
  actor uuid not null references auth.users(id) on delete restrict,
  target uuid not null references phonebooks_private.accounts(user_id),
  action text not null,
  created_at timestamptz not null default statement_timestamp(),
  arguments jsonb not null,
  before_values jsonb not null,
  after_values jsonb not null
);
create index admin_log_target_time on phonebooks_private.admin_log(target, created_at desc);
create table phonebooks_private.payments (
  id uuid primary key references phonebooks_private.admin_log(request_id),
  user_id uuid not null references phonebooks_private.accounts(user_id),
  paid_at timestamptz not null default statement_timestamp(),
  amount_kopecks integer not null check (amount_kopecks = 39900),
  days integer not null check (days = 30)
);
create index payments_user_time on phonebooks_private.payments(user_id, paid_at desc);
create index payments_time on phonebooks_private.payments(paid_at);

alter table phonebooks_private.accounts enable row level security;
alter table phonebooks_private.owners enable row level security;
alter table phonebooks_private.admin_log enable row level security;
alter table phonebooks_private.payments enable row level security;

create function phonebooks_private.sync_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into phonebooks_private.accounts as account (user_id, trial_started_at)
  values (new.id, new.email_confirmed_at)
  on conflict (user_id) do update
    set trial_started_at = coalesce(account.trial_started_at, excluded.trial_started_at)
    where account.trial_started_at is null and excluded.trial_started_at is not null;
  return new;
end;
$$;
create trigger phonebooks_account_created after insert on auth.users
  for each row execute function phonebooks_private.sync_account();
create trigger phonebooks_account_confirmed after update of email_confirmed_at on auth.users
  for each row execute function phonebooks_private.sync_account();

insert into phonebooks_private.accounts(user_id, trial_started_at)
select id, email_confirmed_at from auth.users on conflict (user_id) do nothing;

create function phonebooks_private.account_status(
  account phonebooks_private.accounts, confirmed_at timestamptz, moment timestamptz
) returns text language sql immutable set search_path = '' as $$
  select case
    when account.blocked then 'blocked'
    when confirmed_at is null then 'pending'
    when account.lifetime then 'lifetime'
    when account.paid_until > moment then 'active'
    when account.trial_started_at + interval '72 hours' > moment then 'trial'
    else 'expired'
  end;
$$;

create function phonebooks_private.session_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sid text := auth.jwt()->>'session_id';
begin
  if uid is null or sid is null or not exists (
    select from auth.sessions s where s.id = sid::uuid and s.user_id = uid
      and (s.not_after is null or s.not_after > statement_timestamp())
  ) then
    raise sqlstate 'PT401' using message = 'Session expired';
  end if;
  return uid;
end;
$$;

create function phonebooks_private.require_owner() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := phonebooks_private.session_user();
begin
  if not exists (
    select from phonebooks_private.owners o
    join phonebooks_private.accounts a on a.user_id = o.user_id
    join auth.users u on u.id = o.user_id
    where o.user_id = uid and not a.blocked and u.email_confirmed_at is not null
  ) then
    raise sqlstate 'PT403' using message = 'Owner access required';
  end if;
  return uid;
end;
$$;

create function public.phonebooks_access() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', u.id, 'email', u.email, 'status', s.status,
    'serverNow', statement_timestamp(),
    'trialUntil', a.trial_started_at + interval '72 hours',
    'paidUntil', a.paid_until,
    'owner', not a.blocked and u.email_confirmed_at is not null
      and exists (select from phonebooks_private.owners o where o.user_id = u.id),
    'expiresAt', case s.status when 'trial' then a.trial_started_at + interval '72 hours'
      when 'active' then a.paid_until end
  )
  from phonebooks_private.accounts a join auth.users u on u.id = a.user_id
  cross join lateral (select phonebooks_private.account_status(a, u.email_confirmed_at, statement_timestamp()) status) s
  where a.user_id = phonebooks_private.session_user();
$$;

create function public.phonebooks_admin_list(
  p_query text default '', p_status text default '', p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  moment timestamptz := statement_timestamp();
  month_start timestamptz := date_trunc('month', moment, 'Asia/Yekaterinburg');
  result jsonb;
begin
  perform phonebooks_private.require_owner();
  with all_accounts as materialized (
    select u.id, u.email, u.created_at, a.paid_until, a.source, a.partner,
      a.trial_started_at + interval '72 hours' as trial_until,
      phonebooks_private.account_status(a, u.email_confirmed_at, moment) as status
    from phonebooks_private.accounts a join auth.users u on u.id = a.user_id
  ), filtered as materialized (
    select * from all_accounts
    where (coalesce(p_status, '') = '' or status = p_status)
      and (position(lower(left(coalesce(p_query, ''), 160)) in lower(coalesce(email, ''))) > 0
        or position(lower(left(coalesce(p_query, ''), 160)) in lower(source)) > 0
        or position(lower(left(coalesce(p_query, ''), 160)) in lower(partner)) > 0)
  )
  select jsonb_build_object(
    'serverNow', moment,
    'total', (select count(*) from filtered),
    'accounts', coalesce((select jsonb_agg(to_jsonb(f) order by created_at desc, id) from (
      select * from filtered order by created_at desc, id limit 30 offset greatest(0, least(p_offset, 1000000))
    ) f), '[]'::jsonb),
    'metrics', jsonb_build_object(
      'active', count(*) filter (where status = 'active'),
      'trial', count(*) filter (where status = 'trial'),
      'newThisMonth', count(*) filter (where created_at >= month_start),
      'receivedKopecks', (select coalesce(sum(amount_kopecks), 0) from phonebooks_private.payments where paid_at >= month_start),
      'monthlyRunRateKopecks', 39900 * count(*) filter (where status = 'active'
        and exists (select from phonebooks_private.payments p where p.user_id = all_accounts.id))
    )
  ) into result from all_accounts;
  return result;
end;
$$;

create function public.phonebooks_admin_history(p_target uuid, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform phonebooks_private.require_owner();
  return jsonb_build_object(
    'payments', coalesce((select jsonb_agg(to_jsonb(t) order by paid_at desc, id desc) from
      (select * from phonebooks_private.payments where user_id = p_target
       order by paid_at desc, id desc limit 30 offset greatest(0, least(p_offset, 1000000))) t), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(to_jsonb(t) order by created_at desc, request_id desc) from
      (select l.*, u.email as actor_email from phonebooks_private.admin_log l join auth.users u on u.id = l.actor where target = p_target
       order by created_at desc, request_id desc limit 30 offset greatest(0, least(p_offset, 1000000))) t), '[]'::jsonb)
  );
end;
$$;

create function public.phonebooks_admin_action(
  p_target uuid, p_request_id uuid, p_action text, p_days integer default null,
  p_source text default null, p_partner text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  administrator uuid := phonebooks_private.require_owner();
  account phonebooks_private.accounts%rowtype;
  previous phonebooks_private.admin_log%rowtype;
  original jsonb;
  args jsonb := jsonb_build_object('days', p_days, 'source', p_source, 'partner', p_partner);
  moment timestamptz := statement_timestamp();
begin
  if p_request_id is null or p_target is null or p_action is null then
    raise sqlstate 'PT400' using message = 'Missing action fields';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into previous from phonebooks_private.admin_log where request_id = p_request_id;
  if found then
    if previous.actor <> administrator or previous.target <> p_target
      or previous.action <> p_action or previous.arguments <> args then
      raise sqlstate 'PT409' using message = 'Request identifier already used';
    end if;
    return previous.after_values;
  end if;
  select * into account from phonebooks_private.accounts where user_id = p_target for update;
  if not found then raise sqlstate 'PT404' using message = 'Account not found'; end if;
  original := to_jsonb(account);

  case p_action
    when 'payment', 'extend' then
      if account.lifetime or account.blocked or not exists (
        select from auth.users where id = p_target and email_confirmed_at is not null
      ) then raise sqlstate 'PT409' using message = 'Account cannot be extended'; end if;
      if p_action = 'payment' then p_days := 30; end if;
      if p_days is null or p_days < 1 or p_days > 36500 then
        raise sqlstate 'PT400' using message = 'Invalid number of days';
      end if;
      account.paid_until := greatest(moment, account.paid_until,
        account.trial_started_at + interval '72 hours') + (interval '24 hours' * p_days);
    when 'lifetime' then
      if account.blocked or not exists (select from auth.users where id = p_target and email_confirmed_at is not null) then
        raise sqlstate 'PT409' using message = 'Confirm email and unblock first';
      end if;
      account.lifetime := true;
    when 'block', 'unblock' then
      if exists (select from phonebooks_private.owners where user_id = p_target) then
        raise sqlstate 'PT409' using message = 'Owner cannot be blocked here';
      end if;
      account.blocked := p_action = 'block';
      delete from auth.sessions where user_id = p_target;
    when 'attribution' then
      if p_source is null or p_partner is null or length(p_source) > 120 or length(p_partner) > 120 then
        raise sqlstate 'PT400' using message = 'Invalid attribution';
      end if;
      account.source := btrim(p_source);
      account.partner := btrim(p_partner);
    else raise sqlstate 'PT400' using message = 'Unknown action';
  end case;

  update phonebooks_private.accounts set
    paid_until = account.paid_until, lifetime = account.lifetime, blocked = account.blocked,
    source = account.source, partner = account.partner where user_id = p_target;
  insert into phonebooks_private.admin_log(request_id, actor, target, action, arguments, before_values, after_values)
    values (p_request_id, administrator, p_target, p_action, args, original, to_jsonb(account));
  if p_action = 'payment' then
    insert into phonebooks_private.payments(id, user_id, amount_kopecks, days)
      values (p_request_id, p_target, 39900, 30);
  end if;
  return to_jsonb(account);
end;
$$;

revoke execute on all functions in schema phonebooks_private from public, anon, authenticated;
revoke execute on function public.phonebooks_access(), public.phonebooks_admin_list(text,text,integer),
  public.phonebooks_admin_history(uuid,integer), public.phonebooks_admin_action(uuid,uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.phonebooks_access(), public.phonebooks_admin_list(text,text,integer),
  public.phonebooks_admin_history(uuid,integer), public.phonebooks_admin_action(uuid,uuid,text,integer,text,text) to authenticated;

commit;
