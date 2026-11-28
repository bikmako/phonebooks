begin;

create index inventory_categories_cloud_page on phonebooks_team_private.inventory_categories(workspace_id,cloud_revision,id);
create index inventory_products_cloud_page on phonebooks_team_private.inventory_products(workspace_id,cloud_revision,id);
create index inventory_accounts_cloud_page on phonebooks_team_private.inventory_accounts(workspace_id,cloud_revision,id);
create index inventory_operations_cloud_page on phonebooks_team_private.inventory_operations(workspace_id,cloud_revision,id);

create function public.phonebooks_team_cloud_page(p_workspace uuid,p_actor uuid,p_position jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  permissions text[];
  member_role text;
  revision bigint;
  since_revision bigint := coalesce((p_position->>'since')::bigint,-1);
  upper_revision bigint;
  tail_revision bigint := coalesce((p_position->>'lastRevision')::bigint,-1);
  tail_kind integer := coalesce((p_position->>'lastKind')::integer,-1);
  tail_id text := coalesce(p_position->>'lastId','');
  stock boolean;
  balances boolean;
  accounts_allowed boolean;
  history boolean;
  stock_cost boolean;
  sale_totals boolean;
  result jsonb;
  continuation jsonb;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  if jsonb_typeof(p_position) is distinct from 'object' then raise sqlstate 'PT400' using message='Invalid page'; end if;
  select workspace.cloud_revision,member.role into revision,member_role
    from phonebooks_team_private.workspaces workspace
    join phonebooks_team_private.memberships member on member.workspace_id=workspace.id
    where workspace.id=p_workspace and member.user_id=actor and member.revoked_at is null;
  upper_revision := coalesce((p_position->>'upper')::bigint,revision);
  if since_revision < -1 or upper_revision not between greatest(0,since_revision) and revision
    or tail_revision not between -1 and upper_revision or tail_kind not between -1 and 3
    or char_length(tail_id)>4096 then raise sqlstate 'PT409' using message='Invalid revision'; end if;
  permissions := phonebooks_team_private.team_permissions(p_workspace,actor);
  stock := 'stock.read'=any(permissions);
  balances := 'finance.cash.read'=any(permissions);
  accounts_allowed := balances or permissions && array['trade.sale','trade.purchase','repair.expense','finance.expense','finance.deposit'];
  history := 'finance.history.read'=any(permissions);
  stock_cost := array['stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ permissions;
  sale_totals := array['analytics.company','finance.revenue.read'] <@ permissions;
  if since_revision=upper_revision then
    return jsonb_build_object('permissions',permissions,'role',member_role,'cursor',upper_revision::text,
      'next',null,'categories','[]'::jsonb,'products','[]'::jsonb,'accounts','[]'::jsonb,'operations','[]'::jsonb);
  end if;

  with recent as materialized (
    select id,cloud_revision from phonebooks_team_private.inventory_operations
    where history and since_revision=-1 and workspace_id=p_workspace and cloud_revision<=upper_revision
    order by cloud_revision desc,id desc limit 50
  ), candidates as materialized (
    (select cloud_revision rev,0 kind,id from phonebooks_team_private.inventory_categories
      where stock and workspace_id=p_workspace and cloud_revision>since_revision and cloud_revision<=upper_revision
        and (cloud_revision,id)>(tail_revision,case when tail_kind=0 then tail_id else '' end)
        and (tail_kind<=0 or cloud_revision>tail_revision)
      order by cloud_revision,id limit 101)
    union all
    (select cloud_revision,1,id from phonebooks_team_private.inventory_products
      where stock and workspace_id=p_workspace and cloud_revision>since_revision and cloud_revision<=upper_revision
        and (cloud_revision,id)>(tail_revision,case when tail_kind=1 then tail_id else '' end)
        and (tail_kind<=1 or cloud_revision>tail_revision)
      order by cloud_revision,id limit 101)
    union all
    (select cloud_revision,2,id from phonebooks_team_private.inventory_accounts
      where accounts_allowed and workspace_id=p_workspace and cloud_revision>since_revision and cloud_revision<=upper_revision
        and (cloud_revision,id)>(tail_revision,case when tail_kind=2 then tail_id else '' end)
        and (tail_kind<=2 or cloud_revision>tail_revision)
      order by cloud_revision,id limit 101)
    union all
    (select cloud_revision,3,id from phonebooks_team_private.inventory_operations
      where history and since_revision>=0 and workspace_id=p_workspace and cloud_revision>since_revision and cloud_revision<=upper_revision
        and (cloud_revision,id)>(tail_revision,case when tail_kind=3 then tail_id else '' end)
      order by cloud_revision,id limit 101)
    union all
    select cloud_revision,3,id from recent where (cloud_revision,3,id)>(tail_revision,tail_kind,tail_id)
  ), first_keys as materialized (
    select * from candidates order by rev,kind,id limit 101
  ), page as materialized (
    select * from first_keys order by rev,kind,id limit 100
  )
  select jsonb_build_object(
    'permissions',permissions,'role',member_role,'cursor',upper_revision::text,
    'categories',(
      select coalesce(jsonb_agg(jsonb_build_object('id',entry.id,'name',entry.name,'attributes',entry.attributes) order by entry.name),'[]')
      from page join phonebooks_team_private.inventory_categories entry on entry.workspace_id=p_workspace and entry.id=page.id
      where page.kind=0
    ),
    'products',(
      select coalesce(jsonb_agg(jsonb_build_object('id',product.id,'name',product.name,'categoryId',category_id,'tracking',tracking,
        'attributes',attributes,'quantity',product.quantity,'reserved',reserved_quantity,'version',product.version,
        'inRepair',in_repair,'archived',archived_at is not null) ||
        case when stock_cost then jsonb_build_object('stockCostMinor',(
          select coalesce(sum(lot.cost_minor),0)::text from phonebooks_team_private.stock_lots lot
          where lot.workspace_id=p_workspace and lot.product_id=product.id
        )) else '{}' end ||
        case when 'stock.purchase_price.read'=any(permissions) then jsonb_build_object('lastPurchasePriceMinor',(
          select coalesce(round(-posting.amount_minor::numeric / line.quantity),0)::text
          from phonebooks_team_private.inventory_operation_lines line
          join phonebooks_team_private.inventory_operations operation
            on operation.workspace_id=line.workspace_id and operation.id=line.operation_id
          left join phonebooks_team_private.inventory_postings posting
            on posting.workspace_id=operation.workspace_id and posting.operation_id=operation.id and posting.amount_minor<0
          where line.workspace_id=p_workspace and line.product_id=product.id and operation.type='purchase' and operation.status='posted'
          order by operation.occurred_on desc,operation.cloud_revision desc,operation.recorded_at desc,operation.id desc limit 1
        )) else '{}' end order by product.name,product.id),'[]')
      from page join phonebooks_team_private.inventory_products product on product.workspace_id=p_workspace and product.id=page.id
      where page.kind=1
    ),
    'accounts',(
      select coalesce(jsonb_agg(jsonb_build_object('id',account.id,'name',account.name,'archived',account.archived_at is not null)
        || case when balances then jsonb_build_object('balanceMinor',(account.opening_balance_minor + coalesce((
          select sum(posting.amount_minor) from phonebooks_team_private.inventory_postings posting
          where posting.workspace_id=p_workspace and posting.account_id=account.id
        ),0))::text) else '{}' end order by account.id),'[]')
      from page join phonebooks_team_private.inventory_accounts account on account.workspace_id=p_workspace and account.id=page.id
      where page.kind=2
    ),
    'operations',(
      select coalesce(jsonb_agg(jsonb_build_object('id',operation.id,'type',operation.type,
        'actorId',case when not operation.historical then operation.actor_id end,
        'date',operation.occurred_on,'status',operation.status) order by operation.cloud_revision,operation.id),'[]')
      from page join phonebooks_team_private.inventory_operations operation on operation.workspace_id=p_workspace and operation.id=page.id
      where page.kind=3
    )
  ), case when (select count(*) from first_keys)>100 then (
    select jsonb_build_object('since',case when since_revision>=0 then since_revision::text end,
      'upper',upper_revision::text,'lastRevision',rev::text,'lastKind',kind,'lastId',id)
    from page order by rev desc,kind desc,id desc limit 1
  ) end into result,continuation;

  if continuation is null then
    result := result || jsonb_build_object('totals',case when sale_totals then (
      select jsonb_build_object('revenue_minor',totals.revenue_minor,'sales_count',totals.sales_count)
        || case when stock_cost and 'finance.profit.read'=any(permissions) then jsonb_build_object('cost_minor',totals.cost_minor) else '{}' end
        || case when stock_cost and history and 'finance.profit.read'=any(permissions) then jsonb_build_object('expense_minor',totals.expense_minor) else '{}' end
      from (
        select coalesce(sum(revenue_minor),0) as revenue_minor, coalesce(sum(cost_minor),0) as cost_minor,
          coalesce(sum(expense_minor),0) as expense_minor, count(distinct coalesce(group_id,id)) filter(where type='sale') as sales_count
        from phonebooks_team_private.inventory_operations
        where workspace_id=p_workspace and status='posted' and cloud_revision<=upper_revision
      ) totals
    ) end);
  end if;
  return result || jsonb_build_object('next',continuation);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid page';
end;
$$;

create index inventory_postings_by_account on phonebooks_team_private.inventory_postings(workspace_id,account_id);
revoke all on function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) to authenticated;

-- Compatibility for older diagnostic clients. Large spaces must use the cursor API.
create or replace function public.phonebooks_team_cloud_feed(p_workspace uuid,p_actor uuid,p_cursor bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare page jsonb := public.phonebooks_team_cloud_page(p_workspace,p_actor,jsonb_build_object('since',p_cursor::text));
begin
  if page->'next'<>'null'::jsonb then raise sqlstate 'PT409' using message='Paged client required'; end if;
  return (page-'next') || case when page ? 'totals' then '{}' else jsonb_build_object('totals',null) end;
end;
$$;

commit;
