begin;

-- Keep existing command receipts, version checks and workspace locking. The
-- new command uses the same transaction as purchases, sales and repairs.
alter table phonebooks_team_private.inventory_operations
  drop constraint inventory_operations_type_check,
  add constraint inventory_operations_type_check check (type in (
    'purchase','sale','expense','repair','repair_start','customer_return','supplier_return',
    'reservation','stock_adjustment','transfer','deposit','withdrawal'
  ));

update phonebooks_team_private.permission_catalog set available = true where id = 'repair.start';

alter function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) set schema phonebooks_team_private;
alter function phonebooks_team_private.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) rename to trade_command;
revoke all on function phonebooks_team_private.trade_command(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

create function public.phonebooks_team_cloud_command(p_workspace uuid,p_actor uuid,p_request uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  sku text;
  revision bigint;
  operation_id text := 'cloud:' || p_request::text;
  saved phonebooks_team_private.cloud_requests;
  reply jsonb;
begin
  if p_command->>'type' is distinct from 'repair_start' then
    return phonebooks_team_private.trade_command(p_workspace,p_actor,p_request,p_command);
  end if;
  actor := phonebooks_team_private.inventory_actor(p_workspace);
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  if p_request is null or p_command - array['type','productId','expectedVersion'] <> '{}'::jsonb then
    raise sqlstate 'PT400' using message='Invalid repair document';
  end if;

  select cloud_revision + 1 into revision from phonebooks_team_private.workspaces where id=p_workspace for update;
  perform phonebooks_team_private.inventory_actor(p_workspace);
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read','repair.start']);

  select * into saved from phonebooks_team_private.cloud_requests where workspace_id=p_workspace and request_id=p_request;
  if found then
    if saved.actor_id=actor and saved.command=p_command then return saved.result; end if;
    raise sqlstate 'PT409' using message='Request ID already used';
  end if;

  update phonebooks_team_private.inventory_products set in_repair=true, version=version+1, cloud_revision=revision
    where workspace_id=p_workspace and id=p_command->>'productId' and archived_at is null
      and tracking='unit' and quantity=1 and reserved_quantity=0 and not in_repair
      and version=phonebooks_team_private.cloud_integer(p_command->'expectedVersion',1,2147483647)
    returning id into sku;
  if not found then raise sqlstate 'PT409' using message='Product changed or unavailable'; end if;

  perform phonebooks_team_private.record_inventory_operation(p_workspace,p_request,jsonb_build_object(
    'id',operation_id,'version',1,'type','repair_start','status','posted','date',current_date,
    'revenueMinor',0,'costMinor',0,'expenseMinor',0,'postings','[]'::jsonb,
    'lines',jsonb_build_array(jsonb_build_object('productId',sku,'quantity',1,'stockDelta',0))
  ));
  update phonebooks_team_private.inventory_operations set cloud_revision=revision where workspace_id=p_workspace and id=operation_id;
  update phonebooks_team_private.workspaces set cloud_revision=revision where id=p_workspace;
  reply := jsonb_build_object('operationId',operation_id,'revision',revision::text);
  insert into phonebooks_team_private.cloud_requests values (p_workspace,p_request,actor,p_command,reply);
  return reply;
end;
$$;

revoke all on function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) to authenticated;

create index inventory_operation_lines_product_history
  on phonebooks_team_private.inventory_operation_lines(workspace_id,product_id,operation_id);

create function public.phonebooks_team_operation_history(
  p_workspace uuid,p_actor uuid,p_product text,p_kind text,p_from date,p_to date,p_offset integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  rights text[] := phonebooks_team_private.team_permissions(p_workspace,actor);
  stock boolean := 'stock.read'=any(rights);
  cash boolean := 'finance.cash.read'=any(rights);
  prices boolean := 'stock.purchase_price.read'=any(rights);
  repair_cost boolean := 'repair.cost.read'=any(rights);
  revenue boolean := 'finance.revenue.read'=any(rights);
  profit boolean := array['finance.revenue.read','finance.profit.read','stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ rights;
  result jsonb;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['finance.history.read']);
  if p_product is not null and not stock then raise sqlstate 'PT403' using message='Required permission denied'; end if;
  if coalesce(p_offset,-1) not between 0 and 1000000 or p_from > p_to
    or p_kind is not null and p_kind not in ('sale','repair','cash') then
    raise sqlstate 'PT400' using message='Invalid history filters';
  end if;
  if p_kind='cash' and not cash then raise sqlstate 'PT403' using message='Required permission denied'; end if;

  with page as materialized (
    select op.* from phonebooks_team_private.inventory_operations op
    where op.workspace_id=p_workspace
      and (p_kind is null or p_kind='sale' and op.type in ('sale','customer_return')
        or p_kind='repair' and op.type in ('repair','repair_start')
        or p_kind='cash' and exists(select from phonebooks_team_private.inventory_postings posting
          where posting.workspace_id=p_workspace and posting.operation_id=op.id))
      and (p_from is null or op.occurred_on>=p_from) and (p_to is null or op.occurred_on<=p_to)
      and (p_product is null or exists(select from phonebooks_team_private.inventory_operation_lines line
        where line.workspace_id=p_workspace and line.product_id=p_product and line.operation_id=op.id))
    order by op.occurred_on desc,op.cloud_revision desc,op.recorded_at desc,op.id desc
    limit 51 offset p_offset
  )
  select jsonb_build_object('more',(select count(*)>50 from page),'items',coalesce((
    select jsonb_agg(jsonb_build_object('id',op.id,'type',op.type,'status',op.status,'date',op.occurred_on,
      'actorId',case when not op.historical then op.actor_id end)
      || case when stock then jsonb_build_object('products',(
        select coalesce(jsonb_agg(jsonb_build_object('name',product.name,'quantity',line.quantity) order by line.position),'[]')
        from phonebooks_team_private.inventory_operation_lines line
        join phonebooks_team_private.inventory_products product on product.workspace_id=p_workspace and product.id=line.product_id
        where line.workspace_id=p_workspace and line.operation_id=op.id
      )) else '{}' end
      || case when (op.type in ('purchase','supplier_return') and prices)
          or (op.type='repair' and repair_cost)
          or (op.type in ('sale','customer_return') and revenue)
          or (op.type in ('expense','transfer','deposit','withdrawal') and cash)
        then jsonb_build_object('postings',(
          select coalesce(jsonb_agg(jsonb_build_object('amountMinor',posting.amount_minor::text)
            || case when cash then jsonb_build_object('account',account.name) else '{}' end order by account.id),'[]')
          from phonebooks_team_private.inventory_postings posting
          join phonebooks_team_private.inventory_accounts account on account.workspace_id=p_workspace and account.id=posting.account_id
          where posting.workspace_id=p_workspace and posting.operation_id=op.id
        )) else '{}' end
      || case when profit and op.type in ('sale','customer_return') then jsonb_build_object('profitMinor',(op.revenue_minor-op.cost_minor)::text)
        else '{}' end order by op.occurred_on desc,op.cloud_revision desc,op.recorded_at desc,op.id desc)
    from (select * from page order by occurred_on desc,cloud_revision desc,recorded_at desc,id desc limit 50) op
  ),'[]')) into result;
  if p_kind='cash' and prices and repair_cost and revenue then
    select result || jsonb_build_object('flow',jsonb_build_object(
      'inMinor',coalesce(sum(posting.amount_minor) filter(where posting.amount_minor>0),0)::text,
      'outMinor',coalesce(-sum(posting.amount_minor) filter(where posting.amount_minor<0),0)::text,
      'netMinor',coalesce(sum(posting.amount_minor),0)::text))
      into result
      from phonebooks_team_private.inventory_postings posting
      join phonebooks_team_private.inventory_operations op
        on op.workspace_id=posting.workspace_id and op.id=posting.operation_id
      where op.workspace_id=p_workspace and op.status='posted' and op.type<>'transfer'
        and (p_from is null or op.occurred_on>=p_from) and (p_to is null or op.occurred_on<=p_to);
  end if;
  return result;
end;
$$;

revoke all on function public.phonebooks_team_operation_history(uuid,uuid,text,text,date,date,integer) from public,anon,authenticated;
grant execute on function public.phonebooks_team_operation_history(uuid,uuid,text,text,date,date,integer) to authenticated;
commit;
