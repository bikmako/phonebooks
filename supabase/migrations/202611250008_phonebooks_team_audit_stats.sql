begin;

create table phonebooks_team_private.team_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references phonebooks_team_private.workspaces(id),
  actor_id uuid not null references auth.users(id),
  target_id text,
  kind text not null,
  recorded_at timestamptz not null default clock_timestamp(),
  previous jsonb,
  current_values jsonb,
  financial boolean not null default false,
  stock boolean not null default false,
  owner_details boolean not null default false,
  amount_minor bigint
);
create index team_audit_by_date on phonebooks_team_private.team_audit(workspace_id,recorded_at desc,id);
create index team_audit_by_actor on phonebooks_team_private.team_audit(workspace_id,actor_id,recorded_at desc);
alter table phonebooks_team_private.team_audit enable row level security;
revoke all on phonebooks_team_private.team_audit from public,anon,authenticated;

create function phonebooks_team_private.team_audit_amount(payload jsonb, kind text) returns bigint
language sql immutable set search_path = '' as $$
  select case when kind='stock_adjustment' then (payload->>'expenseMinor')::bigint
    when kind in ('purchase','repair','expense','sale','deposit','withdrawal')
      then coalesce(abs((payload->'postings'->0->>'amountMinor')::bigint),0)
    else null end;
$$;

create function phonebooks_team_private.log_team_event() returns trigger
language plpgsql set search_path = '' as $$
declare
  before_row jsonb := case when tg_op<>'INSERT' then to_jsonb(old) end;
  after_row jsonb := case when tg_op<>'DELETE' then to_jsonb(new) end;
  row_data jsonb := coalesce(after_row,before_row);
  actor uuid := auth.uid();
  workspace uuid := (row_data->>'workspace_id')::uuid;
  target text;
  action text;
  previous jsonb;
  current_values jsonb;
  finance_event boolean := false;
  stock_event boolean := false;
  restricted boolean := false;
  amount bigint;
begin
  if actor is null then return null; end if;
  case tg_table_name
    when 'inventory_operations' then
      if new.historical then return null; end if;
      action := new.type;
      target := new.id;
      finance_event := true;
      current_values := jsonb_build_object('status',new.status,'productId',new.request_payload->'lines'->0->>'productId');
      amount := phonebooks_team_private.team_audit_amount(new.request_payload,new.type);
    when 'inventory_products' then
      if not ((after_row - array['cloud_revision','version','quantity','reserved_quantity','in_repair'])
          is distinct from (before_row - array['cloud_revision','version','quantity','reserved_quantity','in_repair'])) then return null; end if;
      action := 'product.edit';
      target := new.id;
      stock_event := true;
      previous := jsonb_build_object('name',old.name,'category',old.category_id,'tracking',old.tracking);
      current_values := jsonb_build_object('name',new.name,'category',new.category_id,'tracking',new.tracking);
    when 'team_roles' then
      action := case when tg_op='INSERT' then 'role.create'
        when new.archived_at is not null then 'role.archive' else 'role.edit' end;
      target := row_data->>'id';
      previous := before_row - array['workspace_id','revision'];
      current_values := after_row - array['workspace_id','revision'];
      restricted := true;
    when 'member_overrides' then
      action := 'member.permission';
      target := row_data->>'user_id';
      previous := before_row - array['workspace_id','user_id'];
      current_values := after_row - array['workspace_id','user_id'];
      restricted := true;
    when 'memberships' then
      if old.revoked_at is distinct from new.revoked_at then
        action := case when new.revoked_at is null then 'member.restore' else 'member.revoke' end;
        previous := jsonb_build_object('revoked',old.revoked_at is not null);
        current_values := jsonb_build_object('revoked',new.revoked_at is not null);
      elsif old.role_id is distinct from new.role_id then
        action := 'member.role';
        previous := jsonb_build_object('role',coalesce(old.role_id,old.role));
        current_values := jsonb_build_object('role',coalesce(new.role_id,new.role));
      else return null;
      end if;
      target := new.user_id::text;
    when 'invitations' then
      action := case when tg_op='INSERT' then 'invite.create'
        when new.revoked_at is not null then 'invite.revoke'
        when new.accepted_by is not null then 'invite.accept' end;
      target := new.id::text;
      current_values := jsonb_build_object('role',coalesce(new.role_id,new.role),'expiresAt',new.expires_at);
    when 'solo_imports' then
      action := 'solo.import';
      target := new.workspace_id::text;
    else return null;
  end case;
  if action is not null then
    insert into phonebooks_team_private.team_audit(workspace_id,actor_id,target_id,kind,previous,current_values,financial,stock,owner_details,amount_minor)
      values(workspace,actor,target,action,previous,current_values,finance_event,stock_event,restricted,amount);
  end if;
  return null;
end;
$$;

create trigger audit_inventory_operation after insert on phonebooks_team_private.inventory_operations
  for each row execute function phonebooks_team_private.log_team_event();
create trigger audit_product_metadata after update of name,category_id,tracking,attributes,archived_at on phonebooks_team_private.inventory_products
  for each row execute function phonebooks_team_private.log_team_event();
create trigger audit_team_roles after insert or update on phonebooks_team_private.team_roles
  for each row when (new.id not in ('manager','employee') or new.revision > 1)
  execute function phonebooks_team_private.log_team_event();
create trigger audit_member_overrides after insert or update or delete on phonebooks_team_private.member_overrides
  for each row execute function phonebooks_team_private.log_team_event();
create trigger audit_memberships after update on phonebooks_team_private.memberships
  for each row execute function phonebooks_team_private.log_team_event();
create trigger audit_invitations after insert or update on phonebooks_team_private.invitations
  for each row execute function phonebooks_team_private.log_team_event();
create trigger audit_solo_import after insert on phonebooks_team_private.solo_imports
  for each row execute function phonebooks_team_private.log_team_event();

insert into phonebooks_team_private.team_audit(workspace_id,actor_id,target_id,kind,recorded_at,current_values,financial,amount_minor)
  select workspace_id,actor_id,id,type,recorded_at,
    jsonb_build_object('status',status,'productId',request_payload->'lines'->0->>'productId'),
    true,phonebooks_team_private.team_audit_amount(request_payload,type)
  from phonebooks_team_private.inventory_operations where not historical;

create function public.phonebooks_team_audit(p_workspace uuid,p_actor uuid,p_member uuid,p_kind text,p_from date,p_to date,p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  permissions text[];
  owner_access boolean;
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['team.audit.read']);
  permissions := phonebooks_team_private.team_permissions(p_workspace,actor);
  select role='owner' into owner_access from phonebooks_team_private.memberships where workspace_id=p_workspace and user_id=actor;
  if coalesce(p_offset,-1) < 0 or p_from > p_to then raise sqlstate 'PT400' using message='Invalid audit filters'; end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(event) order by "recordedAt" desc,id),'[]')
    from (
      select log.id,log.actor_id as "actorId",log.kind,log.target_id as "targetId",log.recorded_at as "recordedAt",
        case when not log.owner_details or owner_access then log.previous end as previous,
        case when not log.owner_details or owner_access then
          (case when 'stock.read'=any(permissions) then log.current_values else log.current_values-'productId' end)
          || case when log.amount_minor is not null and (
            (log.kind='purchase' and 'stock.purchase_price.read'=any(permissions))
            or (log.kind='repair' and 'repair.cost.read'=any(permissions))
            or (log.kind='sale' and 'finance.revenue.read'=any(permissions))
            or (log.kind in ('deposit','withdrawal','expense') and 'finance.cash.read'=any(permissions))
            or (log.kind='stock_adjustment' and array['stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ permissions)
          ) then jsonb_build_object('amountMinor',log.amount_minor::text) else '{}' end
        end as "current"
      from phonebooks_team_private.team_audit log
      where log.workspace_id=p_workspace and (p_member is null or log.actor_id=p_member)
        and (p_kind is null or log.kind=p_kind)
        and (p_from is null or log.recorded_at >= p_from::timestamp at time zone 'UTC')
        and (p_to is null or log.recorded_at < (p_to+1)::timestamp at time zone 'UTC')
        and (not log.financial or 'finance.history.read'=any(permissions))
        and (not log.stock or 'stock.read'=any(permissions))
      order by log.recorded_at desc,log.id limit 50 offset p_offset
    ) event
  );
end;
$$;

create function public.phonebooks_team_stats(p_workspace uuid,p_actor uuid,p_member uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  permissions text[];
  costs boolean;
  result jsonb;
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,
    case when p_member is null then array['analytics.company']
      when p_member=actor then array['analytics.self'] else array['analytics.others','team.members.read'] end);
  if p_member is not null and not exists(select from phonebooks_team_private.memberships where workspace_id=p_workspace and user_id=p_member) then
    raise sqlstate 'PT404' using message='Member not found';
  end if;
  if p_from > p_to then raise sqlstate 'PT400' using message='Invalid statistics period'; end if;
  permissions := phonebooks_team_private.team_permissions(p_workspace,actor);
  costs := array['stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ permissions;
  with included as (
    select * from phonebooks_team_private.inventory_operations operation
    where workspace_id=p_workspace and status='posted'
      and (p_member is null or (actor_id=p_member and not historical))
      and (p_from is null or occurred_on>=p_from) and (p_to is null or occurred_on<=p_to)
  ), sums as (
    select count(*) filter(where type='purchase') as purchases,
      count(distinct coalesce(group_id,id)) filter(where type='sale') as sales,
      count(*) filter(where type='repair') as repairs,
      count(*) filter(where type='expense') as expenses,
      coalesce(sum(revenue_minor),0) as revenue, coalesce(sum(cost_minor),0) as cost,
      coalesce(sum(expense_minor),0) as expense,
      coalesce(sum(expense_minor) filter(where type='expense'),0) as opex
    from included
  )
  select jsonb_build_object('purchases',sums.purchases,'sales',sums.sales,'repairs',sums.repairs,'expenses',sums.expenses)
    || case when 'stock.purchase_price.read'=any(permissions) then jsonb_build_object('purchaseMinor',(
        select coalesce(-sum(posting.amount_minor),0)::text from included
        join phonebooks_team_private.inventory_postings posting on posting.workspace_id=p_workspace and posting.operation_id=included.id
        where included.type='purchase'
      )) else '{}' end
    || case when 'finance.revenue.read'=any(permissions) then jsonb_build_object('revenueMinor',revenue::text) else '{}' end
    || case when costs and 'finance.profit.read'=any(permissions) and 'finance.revenue.read'=any(permissions)
      then jsonb_build_object('grossMinor',(revenue-cost)::text)
        || case when p_member is null and 'finance.history.read'=any(permissions)
          then jsonb_build_object('netMinor',(revenue-cost-expense)::text) else '{}' end
      else '{}' end
    || case when 'finance.history.read'=any(permissions) then jsonb_build_object('expensesMinor',opex::text) else '{}' end
    || case when p_member is null and 'finance.cash.read'=any(permissions) then jsonb_build_object('cashMinor',(
      select coalesce(sum(account.opening_balance_minor + coalesce(movement.delta_minor,0)),0)::text
      from phonebooks_team_private.inventory_accounts account
      left join phonebooks_team_private.inventory_account_movements movement on movement.workspace_id=p_workspace and movement.account_id=account.id
      where account.workspace_id=p_workspace
    )) else '{}' end
    || case when p_member is null and costs and 'stock.read'=any(permissions) then jsonb_build_object('stockMinor',(
      select coalesce(sum(cost_minor),0)::text from phonebooks_team_private.stock_lots where workspace_id=p_workspace
    )) else '{}' end
    into result from sums;
  return result;
end;
$$;

revoke all on function phonebooks_team_private.log_team_event(),
  phonebooks_team_private.team_audit_amount(jsonb,text) from public,anon,authenticated;
revoke all on function public.phonebooks_team_audit(uuid,uuid,uuid,text,date,date,integer),
  public.phonebooks_team_stats(uuid,uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.phonebooks_team_audit(uuid,uuid,uuid,text,date,date,integer),
  public.phonebooks_team_stats(uuid,uuid,uuid,date,date) to authenticated;

commit;
