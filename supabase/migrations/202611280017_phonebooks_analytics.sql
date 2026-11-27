begin;

update phonebooks_team_private.permission_catalog set available=true where id in ('analytics.categories','analytics.aging');
create index operation_lines_analytics_product on phonebooks_team_private.inventory_operation_lines(workspace_id,product_id,operation_id);

create function phonebooks_team_private.analytics_money(
  permissions text[], revenue numeric, cost numeric, expense numeric, receipt_revenue numeric, receipts bigint
) returns jsonb language sql immutable set search_path='' as $$
  select case when 'finance.revenue.read'=any(permissions) then jsonb_build_object(
      'revenueMinor',revenue::text,'averageMinor',round(receipt_revenue/nullif(receipts,0))::text) else '{}' end
    || case when array['finance.profit.read','stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ permissions
      then jsonb_build_object('costMinor',cost::text) else '{}' end
    || case when array['finance.revenue.read','finance.profit.read','stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ permissions
      then jsonb_build_object('grossMinor',(revenue-cost)::text,
        'margin',case when revenue>0 then round(100*(revenue-cost)/revenue,2) end)
        || case when 'finance.history.read'=any(permissions)
          then jsonb_build_object('netMinor',(revenue-cost-expense)::text) else '{}' end
      else '{}' end
    || case when 'finance.history.read'=any(permissions) then jsonb_build_object('expensesMinor',expense::text) else '{}' end;
$$;

create function phonebooks_team_private.analytics_lot_date(space uuid, lot_id text, sku text)
returns date language sql stable set search_path='' as $$
  select case when op.request_payload->>'sheetType'='opening' or
    (op.historical and op.type='stock_adjustment' and op.id like 'warehouse:%') then null else op.occurred_on end
  from phonebooks_team_private.inventory_operations op
  where op.workspace_id=space and op.id in (lot_id,'acc_batch:'||lot_id,regexp_replace(lot_id,':[0-9]+$',''))
    and op.type in ('purchase','stock_adjustment','customer_return') and op.status='posted'
    and exists(select from phonebooks_team_private.inventory_operation_lines line
      where line.workspace_id=space and line.operation_id=op.id and line.product_id=sku)
  order by (op.id=lot_id) desc,(op.id='acc_batch:'||lot_id) desc limit 1;
$$;

create function phonebooks_team_private.analytics_phone_return(space uuid, sku text, through_day date, excluded_sale text)
returns date language sql stable set search_path='' as $$
  select max(op.occurred_on)
  from phonebooks_team_private.inventory_operation_lines line
  join phonebooks_team_private.inventory_operations op on op.workspace_id=line.workspace_id and op.id=line.operation_id
  where line.workspace_id=space and line.product_id=sku and line.stock_delta>0 and op.historical
    and op.type='customer_return' and op.status='posted' and op.occurred_on<=through_day
    and op.related_id is distinct from excluded_sale;
$$;

create function phonebooks_team_private.analytics_stock_date(space uuid, lot_id text, sku text)
returns date language sql stable set search_path='' as $$
  select case when lot_id=sku and sku like 'phone:%' then coalesce(
    phonebooks_team_private.analytics_phone_return(space,sku,'infinity',null),
    phonebooks_team_private.analytics_lot_date(space,lot_id,sku))
  else phonebooks_team_private.analytics_lot_date(space,lot_id,sku) end;
$$;

create or replace function phonebooks_team_private.fifo_receipt(space uuid, sku text, units integer) returns jsonb
language sql stable set search_path='' as $$
  with ordered as (
    select lot.*,
      coalesce(sum(quantity) over(order by acquired_revision,id rows between unbounded preceding and 1 preceding),0) as before_qty
    from phonebooks_team_private.stock_lots lot where workspace_id=space and product_id=sku and quantity>0
  ), used as (
    select *,least(quantity,units-before_qty)::integer as consumed from ordered where before_qty<units
  )
  select coalesce(jsonb_agg(jsonb_build_object('sourceId',coalesce(origin_purchase,
      case when exists(select 1 from phonebooks_team_private.inventory_operations op where op.workspace_id=space and op.id='acc_batch:'||used.id)
        then 'acc_batch:'||id else id end),'quantity',consumed,
      'receivedOn',phonebooks_team_private.analytics_stock_date(space,id,sku),
      'costMinor',trunc(cost_minor::numeric*consumed/quantity)::bigint) order by acquired_revision,id),'[]')
  from used
$$;

create function public.phonebooks_team_analytics(p_workspace uuid,p_actor uuid,p_kind text,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  permissions text[];
  stock_cost boolean;
  show_revenue boolean;
  show_profit boolean;
  span integer;
  stride integer;
  result jsonb;
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  if p_kind is null or p_kind not in ('finance','categories','aging') or
    p_from is null or p_to is null or p_from>p_to or p_from<date '0001-01-01' or p_to>date '9999-12-31' then
    raise sqlstate 'PT400' using message='Invalid analytics filters';
  end if;
  span := p_to-p_from+1;
  if p_from-date '0001-01-01'<span then raise sqlstate 'PT400' using message='Invalid comparison period'; end if;
  stride := (span+27)/28;
  permissions := phonebooks_team_private.team_permissions(p_workspace,actor);
  stock_cost := array['stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ permissions;
  show_revenue := 'finance.revenue.read'=any(permissions);
  show_profit := stock_cost and show_revenue and 'finance.profit.read'=any(permissions);
  if p_kind='finance' then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['analytics.company']);
    with facts as materialized (
      select op.*,
        case when op.type='sale' and op.historical and op.cost_minor=0 and
          op.request_payload->>'sheetType' is distinct from 'historical_sale' and not exists(
            select from phonebooks_team_private.inventory_operation_lines line
            where line.workspace_id=p_workspace and line.operation_id=op.id and line.stock_delta<0
          ) then null else op.cost_minor end as known_cost,
        coalesce((select sum(case when op.type='customer_return' then -line.stock_delta else line.quantity end)
          from phonebooks_team_private.inventory_operation_lines line
          where line.workspace_id=p_workspace and line.operation_id=op.id),0) units
      from phonebooks_team_private.inventory_operations op
      where op.workspace_id=p_workspace and op.status='posted' and op.occurred_on between p_from-span and p_to
    ), periods as (
      select -2 bucket,p_from-span lo,p_from-1 hi union all select -1,p_from,p_to
      union all select i/stride,p_from+i,least(p_to,p_from+i+stride-1) from generate_series(0,span-1,stride) i
    ), totals as (
      select bucket,lo,hi,coalesce(sum(revenue_minor),0) rev,
        case when count(id)=count(known_cost) then coalesce(sum(known_cost),0) end as cost,
        coalesce(sum(expense_minor),0) expense,
        coalesce(sum(revenue_minor) filter(where type='sale'),0) receipt_revenue,
        count(distinct coalesce(group_id,id)) filter(where type='sale') receipts,
        coalesce(sum(units) filter(where type='purchase'),0) bought,
        coalesce(sum(units) filter(where type in ('sale','customer_return')),0) sold
      from periods left join facts on occurred_on between lo and hi group by bucket,lo,hi
    ), reports as (
      select bucket, jsonb_build_object('from',lo,'to',hi,'purchasedUnits',bought,'soldUnits',sold,'sales',receipts)
        || phonebooks_team_private.analytics_money(permissions,rev,cost,expense,receipt_revenue,receipts) item
      from totals
    )
    select jsonb_build_object('current',(select item from reports where bucket=-1)
      || case when stock_cost and 'stock.read'=any(permissions) then jsonb_build_object('stockMinor',(
        select coalesce(sum(cost_minor),0)::text from phonebooks_team_private.stock_lots where workspace_id=p_workspace
      )) else '{}' end,
      'previous',(select item from reports where bucket=-2),'series',jsonb_agg(item order by bucket) filter(where bucket>=0))
    into result from reports;
  elsif p_kind='aging' then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['analytics.aging','stock.read']);
    select jsonb_build_object('stockCostVisible',stock_cost,'stock',coalesce(jsonb_agg(jsonb_build_object(
      'id',lot.id,'productId',product.id,'name',product.name,'category',category.name,'quantity',lot.quantity,
      'days',case when received<=p_to then p_to-received end,'date',received,'plannedMinor',product.planned_price_minor::text)
      || case when stock_cost then jsonb_build_object('stockMinor',lot.cost_minor::text) else '{}' end
      order by received nulls last,product.id,lot.id),'[]')) into result
    from phonebooks_team_private.stock_lots lot
    join phonebooks_team_private.inventory_products product on product.workspace_id=lot.workspace_id and product.id=lot.product_id
    join phonebooks_team_private.inventory_categories category on category.workspace_id=product.workspace_id and category.id=product.category_id
    cross join lateral (select phonebooks_team_private.analytics_stock_date(p_workspace,lot.id,lot.product_id) received) age
    where lot.workspace_id=p_workspace and lot.quantity>0;
  else
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['analytics.categories','stock.read']);
    with operation_lines as materialized (
      select op.id,op.type,op.occurred_on,op.recorded_at,op.group_id,op.historical,op.request_payload,op.revenue_minor,op.cost_minor,
        line.product_id,line.position,line.quantity,line.stock_delta,line.allocations,product.category_id,product.name,
        count(*) over(receipt) line_count, min(product.category_id) over(receipt)=max(product.category_id) over(receipt) single_category
      from phonebooks_team_private.inventory_operations op
      join phonebooks_team_private.inventory_operation_lines line on line.workspace_id=op.workspace_id and line.operation_id=op.id
      join phonebooks_team_private.inventory_products product on product.workspace_id=line.workspace_id and product.id=line.product_id
      where op.workspace_id=p_workspace and op.status='posted' and op.occurred_on>=p_from
      window receipt as (partition by op.id)
    ), legacy_lines as materialized (
      select 'acc_sale:'||(legacy->>'id') id,line.position,line.item,coalesce((legacy->>'discount')::numeric,0) discount
      from phonebooks_team_private.solo_imports source
      cross join lateral jsonb_array_elements(coalesce(source.historical_details->'accessorySales','[]')) legacy
      cross join lateral jsonb_array_elements(legacy->'items') with ordinality as line(item,position)
      where source.workspace_id=p_workspace and exists(select from operation_lines where line_count>1 and historical and type='sale')
    ), sales as (
      select sale.*,
        case when type='sale' then quantity else -stock_delta end sold,
        case when line_count=1 then revenue_minor else amounts.line_revenue end line_revenue,
        case when single_category then case when sale.position=1 then revenue_minor else 0 end else amounts.line_revenue end category_revenue,
        case when type='sale' and historical and sale.cost_minor=0 and stock_delta=0
          and request_payload->>'sheetType' is distinct from 'historical_sale' then null
          when line_count=1 then sale.cost_minor else amounts.line_cost end line_cost,
        case when type='sale' and stock_delta<0 then
          case when parts.units=quantity and parts.units=parts.known_units then parts.days
            when historical and sale.id like 'sale:%' and product_id like 'phone:%' and purchase_date<=sale.occurred_on
              and last_return is distinct from sale.occurred_on
              then sale.occurred_on-coalesce(last_return,purchase_date) end end total_days
      from operation_lines sale
      left join legacy_lines legacy on sale.line_count>1 and legacy.id=sale.id and legacy.position=sale.position
        and 'accessory:'||(legacy.item->>'itemId')=sale.product_id and (legacy.item->>'qty')::integer=sale.quantity
      cross join lateral (select
        case when legacy.discount=0 then round((legacy.item->>'unitPrice')::numeric*sale.quantity*100) end line_revenue,
        round((legacy.item->>'unitCost')::numeric*sale.quantity*100) line_cost
      ) amounts
      cross join lateral (select case when sale.historical and sale.id like 'sale:%' and sale.product_id like 'phone:%' then
          phonebooks_team_private.analytics_lot_date(p_workspace,sale.product_id,sale.product_id) end purchase_date,
        case when sale.historical and sale.id like 'sale:%' and sale.product_id like 'phone:%' then
          phonebooks_team_private.analytics_phone_return(p_workspace,sale.product_id,sale.occurred_on,sale.id) end last_return
      ) legacy_phone
      left join lateral (
        select sum(units) units,sum(units) filter(where received<=sale.occurred_on) known_units,
          sum(units::numeric*(sale.occurred_on-received)) days
        from jsonb_array_elements(sale.allocations) part
        cross join lateral (select coalesce(part->>'quantity',part->>'qty')::integer units,
          case when part ? 'receivedOn' then (part->>'receivedOn')::date
            when part ? 'batchId' then phonebooks_team_private.analytics_lot_date(p_workspace,part->>'batchId',sale.product_id)
            when not exists(select from phonebooks_team_private.inventory_operation_lines restored
              join phonebooks_team_private.inventory_operations correction
                on correction.workspace_id=restored.workspace_id and correction.id=restored.operation_id
              where restored.workspace_id=p_workspace and restored.product_id=sale.product_id and restored.stock_delta>0
                and correction.status='posted' and correction.type='customer_return' and correction.recorded_at<=sale.recorded_at)
              then phonebooks_team_private.analytics_lot_date(p_workspace,part->>'sourceId',sale.product_id) end received
        ) age
      ) parts on true
      where sale.type in ('sale','customer_return') and sale.occurred_on<=p_to
    ), grouped as (
      select category_id,product_id,name,grouping(product_id) product_group,grouping(name) model_group,
        count(distinct coalesce(group_id,id)) filter(where type='sale') receipts,
        sum(sold) sold,
        case when grouping(name)=1 and count(*)=count(category_revenue) then sum(category_revenue)
          when grouping(name)=0 and count(*)=count(line_revenue) then sum(line_revenue) end rev,
        case when count(*)=count(line_cost) then
          case when grouping(name)=1 and count(*)=count(category_revenue) then sum(category_revenue-line_cost)
            when grouping(name)=0 and count(*)=count(line_revenue) then sum(line_revenue-line_cost) end end gross,
        round(sum(total_days)/nullif(sum(quantity) filter(where total_days is not null),0),2) sell_days
      from sales group by grouping sets ((category_id),(category_id,name),(category_id,product_id,name))
    ), movement as (
      select category_id, sum(stock_delta) delta, coalesce(sum(stock_delta) filter(where occurred_on>p_to),0) later,
        bool_or(type='sale' and stock_delta=0) incomplete
      from operation_lines group by category_id
    ), stock as (
      select product.category_id,sum(lot.cost_minor) value,sum(lot.quantity) quantity,
        bool_or(phonebooks_team_private.analytics_lot_date(p_workspace,lot.id,lot.product_id) is null) incomplete
      from phonebooks_team_private.stock_lots lot join phonebooks_team_private.inventory_products product
        on product.workspace_id=lot.workspace_id and product.id=lot.product_id
      where lot.workspace_id=p_workspace and lot.quantity>0 group by product.category_id
    ), categories as (
      select category.id, jsonb_build_object('id',category.id,'name',category.name,'sales',coalesce(report.receipts,0),
        'soldUnits',coalesce(report.sold,0),'sellDays',report.sell_days,
        'turnover',case when not coalesce(movement.incomplete,false) and not coalesce(stock.incomplete,false)
          and coalesce(stock.quantity,0)>=greatest(coalesce(movement.delta,0),coalesce(movement.later,0))
          and coalesce(report.sold,0)>=0
          then round(coalesce(report.sold,0)*2/nullif(2*coalesce(stock.quantity,0)-coalesce(movement.delta,0)-coalesce(movement.later,0),0)::numeric,2) end)
        || case when show_revenue then jsonb_build_object('revenueMinor',case when report.category_id is null then '0' else report.rev::text end) else '{}' end
        || case when show_profit then jsonb_build_object('grossMinor',case when report.category_id is null then '0' else report.gross::text end,
          'averageMinor',case when report.sold>0 then round(report.gross/report.sold)::text end) else '{}' end
        || case when stock_cost then jsonb_build_object('stockMinor',coalesce(stock.value,0)::text) else '{}' end item
      from phonebooks_team_private.inventory_categories category
      left join grouped report on report.category_id=category.id and report.model_group=1
      left join stock on stock.category_id=category.id left join movement on movement.category_id=category.id
      where category.workspace_id=p_workspace and (report.category_id is not null or stock.category_id is not null)
    )
    select jsonb_build_object('categories',coalesce((select jsonb_agg(item order by id) from categories),'[]'))
      || case when show_profit then jsonb_build_object(
        'models',coalesce((select jsonb_agg(item order by gross desc,id) from (
          select category_id||':'||name id,gross,jsonb_build_object('id',category_id||':'||name,'name',name,'grossMinor',gross::text) item
          from grouped where product_group=1 and model_group=0 and gross>0 order by gross desc,category_id,name limit 10
        ) ranked),'[]'),
        'topProducts',coalesce((select jsonb_agg(item order by gross desc,id) from (
          select product_id id,gross,jsonb_build_object('id',product_id,'name',name,'grossMinor',gross::text) item
          from grouped where product_group=0 and gross>0 order by gross desc,product_id limit 10
        ) ranked),'[]')) else '{}' end into result;
  end if;
  return result;
end;
$$;

revoke all on function phonebooks_team_private.analytics_money(text[],numeric,numeric,numeric,numeric,bigint),
  phonebooks_team_private.analytics_lot_date(uuid,text,text),
  phonebooks_team_private.analytics_phone_return(uuid,text,date,text),
  phonebooks_team_private.analytics_stock_date(uuid,text,text),
  public.phonebooks_team_analytics(uuid,uuid,text,date,date) from public,anon,authenticated;
grant execute on function public.phonebooks_team_analytics(uuid,uuid,text,date,date) to authenticated;

alter function public.phonebooks_team_stats(uuid,uuid,uuid,date,date) set schema phonebooks_team_private;
alter function phonebooks_team_private.phonebooks_team_stats(uuid,uuid,uuid,date,date) rename to base_team_stats;
revoke all on function phonebooks_team_private.base_team_stats(uuid,uuid,uuid,date,date) from public,anon,authenticated;

create function public.phonebooks_team_stats(p_workspace uuid,p_actor uuid,p_member uuid,p_from date,p_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  base jsonb := phonebooks_team_private.base_team_stats(p_workspace,p_actor,p_member,p_from,p_to);
  extra jsonb;
begin
  with included as materialized (
    select op.id,op.type,op.group_id,op.revenue_minor from phonebooks_team_private.inventory_operations op
    where op.workspace_id=p_workspace and op.status='posted'
      and (p_member is null or (op.actor_id=p_member and not op.historical))
      and (p_from is null or op.occurred_on>=p_from) and (p_to is null or op.occurred_on<=p_to)
  ), counts as (
    select count(*) filter(where type<>'sale') + count(distinct coalesce(group_id,id)) filter(where type='sale') operations,
      count(distinct coalesce(group_id,id)) filter(where type='sale') receipts,
      sum(revenue_minor) filter(where type='sale') receipt_revenue
    from included
  ), units as (
    select coalesce(sum(line.quantity) filter(where type='purchase'),0) bought,
      coalesce(sum(line.quantity) filter(where type='sale'),0) sold
    from included join phonebooks_team_private.inventory_operation_lines line
      on line.workspace_id=p_workspace and line.operation_id=included.id
    where type in ('purchase','sale')
  )
  select jsonb_build_object('operations',operations,'purchasedUnits',bought,'soldUnits',sold)
    || case when base ? 'revenueMinor' then jsonb_build_object('averageMinor',round(receipt_revenue/nullif(receipts,0))::text) else '{}' end
    into extra from counts cross join units;
  return base || extra;
end;
$$;
revoke all on function public.phonebooks_team_stats(uuid,uuid,uuid,date,date) from public,anon,authenticated;
grant execute on function public.phonebooks_team_stats(uuid,uuid,uuid,date,date) to authenticated;

commit;
