begin;

create table phonebooks_team_private.solo_import_config (
  singleton boolean primary key default true check (singleton),
  key_hash bytea not null check (octet_length(key_hash) = 32)
);
create table phonebooks_team_private.solo_imports (
  workspace_id uuid primary key references phonebooks_team_private.workspaces(id),
  actor_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  report jsonb not null,
  audit jsonb not null,
  settings jsonb not null,
  historical_details jsonb not null,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (workspace_id, actor_id) references phonebooks_team_private.memberships(workspace_id, user_id)
);
alter table phonebooks_team_private.solo_imports enable row level security;
alter table phonebooks_team_private.solo_import_config enable row level security;
revoke all on phonebooks_team_private.solo_imports, phonebooks_team_private.solo_import_config from public, anon, authenticated;

create or replace function phonebooks_team_private.inventory_totals(p_workspace uuid, p_actor uuid default null)
returns table (revenue_minor numeric, cost_minor numeric, expense_minor numeric, sales_count bigint)
language sql stable set search_path = '' as $$
  select coalesce(sum(op.revenue_minor), 0), coalesce(sum(op.cost_minor), 0), coalesce(sum(op.expense_minor), 0),
    count(distinct coalesce(op.group_id, op.id)) filter (where op.type = 'sale')
  from phonebooks_team_private.inventory_operations as op
  where op.workspace_id = p_workspace and (p_actor is null or (op.actor_id = p_actor and not op.historical)) and op.status = 'posted';
$$;

create function public.phonebooks_team_solo_import(
  p_workspace uuid, p_actor uuid, p_key text, p_fingerprint text, p_material jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  revision bigint;
  report jsonb := p_material->'summary';
  previous phonebooks_team_private.solo_imports;
  totals record;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  perform phonebooks_team_private.require_workspace_owner(p_workspace, actor);
  -- Only the deployed Worker can relay material calculated on the server.
  if p_key is null or not exists (
    select from phonebooks_team_private.solo_import_config where key_hash = sha256(convert_to(p_key,'UTF8'))
  ) then raise sqlstate 'PT403' using message = 'Untrusted transfer'; end if;
  select cloud_revision into revision from phonebooks_team_private.workspaces where id = p_workspace for update;
  select * into previous from phonebooks_team_private.solo_imports where workspace_id = p_workspace;
  if found and previous.fingerprint = p_fingerprint then
    return jsonb_build_object('summary',previous.report,'replayed',true);
  end if;
  if revision <> 0 or exists (select from phonebooks_team_private.inventory_products where workspace_id = p_workspace)
    or exists (select from phonebooks_team_private.inventory_operations where workspace_id = p_workspace)
    or exists (select from phonebooks_team_private.inventory_accounts where workspace_id = p_workspace and
      (id <> 'ac_default_cash' or opening_balance_minor <> 0 or archived_at is not null)) then
    raise sqlstate 'PT409' using message = 'Workspace must be empty';
  end if;
  revision := revision + 1;

  insert into phonebooks_team_private.inventory_categories(workspace_id,id,name,attributes,cloud_revision)
    select p_workspace,item.id,item.name,item.attributes,revision
    from jsonb_to_recordset(p_material->'categories') as item(id text,name text,attributes jsonb);
  insert into phonebooks_team_private.inventory_products(workspace_id,id,category_id,name,tracking,
    attributes,quantity,reserved_quantity,version,archived_at,cloud_revision,in_repair)
    select p_workspace,item.id,item."categoryId",btrim(item.name),item.tracking,item.attributes,
      item.quantity,item."reservedQuantity",coalesce(item.version,1),
      case when item.status = 'archived' then statement_timestamp() end,revision,item.status = 'repair'
    from jsonb_to_recordset(p_material->'products') as item(id text,"categoryId" text,name text,tracking text,
      attributes jsonb,quantity integer,"reservedQuantity" integer,version integer,status text);

  update phonebooks_team_private.inventory_accounts set archived_at = statement_timestamp(), cloud_revision = revision
    where workspace_id = p_workspace and id = 'ac_default_cash';
  insert into phonebooks_team_private.inventory_accounts(workspace_id,id,name,opening_balance_minor,archived_at,cloud_revision)
    select p_workspace,item.id,item.name,item."openingMinor",case when item.archived then statement_timestamp() end,revision
    from jsonb_to_recordset(p_material->'accounts') as item(id text,name text,"openingMinor" bigint,archived boolean)
    on conflict (workspace_id,id) do update set name=excluded.name,opening_balance_minor=excluded.opening_balance_minor,
      archived_at=excluded.archived_at,cloud_revision=excluded.cloud_revision;

  insert into phonebooks_team_private.stock_lots(workspace_id,product_id,id,acquired_revision,quantity,cost_minor)
    select p_workspace,lot->>'productId',lot->>'id',
      sequence - jsonb_array_length(p_material->'lots'), (lot->>'quantity')::integer,(lot->>'costMinor')::bigint
    from jsonb_array_elements(p_material->'lots') with ordinality as entry(lot,sequence);
  insert into phonebooks_team_private.inventory_operations(workspace_id,id,actor_id,request_id,request_payload,type,status,
    occurred_on,related_id,group_id,revenue_minor,cost_minor,expense_minor,cloud_revision,historical)
    select p_workspace,item->>'id',actor,gen_random_uuid(),item,item->>'type',item->>'status',(item->>'date')::date,
      item->>'relatedId',item->>'groupId',(item->>'revenueMinor')::bigint,(item->>'costMinor')::bigint,(item->>'expenseMinor')::bigint,
      revision,true from jsonb_array_elements(p_material->'operations') as item;
  insert into phonebooks_team_private.inventory_operation_lines(workspace_id,operation_id,position,product_id,tracking,quantity,stock_delta,allocations)
    select p_workspace,item->>'id',line.sequence,line.value->>'productId',product.tracking,(line.value->>'quantity')::integer,
      (line.value->>'stockDelta')::integer,line.value->'allocations'
    from jsonb_array_elements(p_material->'operations') as item
    cross join lateral jsonb_array_elements(item->'lines') with ordinality as line(value,sequence)
    left join phonebooks_team_private.inventory_products as product
      on product.workspace_id = p_workspace and product.id = line.value->>'productId';
  insert into phonebooks_team_private.inventory_postings(workspace_id,operation_id,account_id,amount_minor)
    select p_workspace,item->>'id',posting."accountId",posting."amountMinor"
    from jsonb_array_elements(p_material->'operations') as item
    cross join lateral jsonb_to_recordset(item->'postings') as posting("accountId" text,"amountMinor" bigint);

  select * into totals from phonebooks_team_private.inventory_totals(p_workspace);
  if totals.revenue_minor is distinct from (report->>'revenueMinor')::numeric
    or totals.cost_minor is distinct from (report->>'costMinor')::numeric
    or totals.expense_minor is distinct from (report->>'expenseMinor')::numeric
    or totals.sales_count is distinct from (report->>'salesCount')::bigint
    or (select count(*) from phonebooks_team_private.inventory_operations where workspace_id=p_workspace)
      is distinct from (report->>'operations')::bigint
    or (select coalesce(sum(cost_minor),0) from phonebooks_team_private.stock_lots where workspace_id=p_workspace)
      is distinct from (report->>'stockCostMinor')::numeric
    or exists (
      select from phonebooks_team_private.inventory_products as product
      where product.workspace_id=p_workspace and product.quantity <> (select coalesce(sum(lot.quantity),0)
        from phonebooks_team_private.stock_lots as lot where lot.workspace_id=p_workspace and lot.product_id=product.id)
    ) or exists (
      select from jsonb_to_recordset(p_material->'accounts') as original(id text,"balanceMinor" bigint)
      join phonebooks_team_private.inventory_accounts as account on account.workspace_id=p_workspace and account.id=original.id
      left join phonebooks_team_private.inventory_account_movements as movement
        on movement.workspace_id=p_workspace and movement.account_id=account.id
      where account.opening_balance_minor + coalesce(movement.delta_minor,0) is distinct from original."balanceMinor"
    ) then raise sqlstate 'PT409' using message = 'Imported balances do not reconcile'; end if;

  insert into phonebooks_team_private.solo_imports(workspace_id,actor_id,fingerprint,report,audit,settings,historical_details)
    values(p_workspace,actor,p_fingerprint,report,p_material->'audit',p_material->'settings',p_material->'historicalDetails');
  update phonebooks_team_private.workspaces set cloud_revision=revision where id=p_workspace;
  return jsonb_build_object('summary',report,'replayed',false);
exception when check_violation or not_null_violation or foreign_key_violation or unique_violation or invalid_text_representation
  or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message = 'Solo material contains an unsupported record';
end;
$$;
revoke all on function public.phonebooks_team_solo_import(uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.phonebooks_team_solo_import(uuid,uuid,text,text,jsonb) to authenticated;

commit;
