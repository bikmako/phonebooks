begin;

create function public.phonebooks_team_sheet_revert(p_workspace uuid,p_actor uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=phonebooks_team_private.session_user();
  batch phonebooks_team_private.sheet_batches;
  new_revision bigint;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.lock_team_workspace(p_workspace);
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['data.import']);
  select * into batch from phonebooks_team_private.sheet_batches where workspace_id=p_workspace and id=p_request;
  if not found or (batch.actor_id<>actor and not exists(select from phonebooks_team_private.memberships
      where workspace_id=p_workspace and user_id=actor and role='owner' and revoked_at is null)) then
    raise sqlstate 'PT404' using message='Import not found'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,batch.permissions);
  if batch.reverted_revision is not null then return jsonb_build_object('revision',batch.reverted_revision::text,'replayed',true); end if;
  select cloud_revision into new_revision from phonebooks_team_private.workspaces where id=p_workspace;
  if new_revision<>batch.revision then raise sqlstate 'PT409' using message='После импорта данные изменились. Автоматическое восстановление остановлено.'; end if;
  new_revision:=new_revision+1;
  delete from phonebooks_team_private.inventory_postings posting using phonebooks_team_private.sheet_entries entry
    where entry.workspace_id=p_workspace and entry.batch_id=p_request and posting.workspace_id=p_workspace and posting.operation_id=entry.operation_id;
  delete from phonebooks_team_private.inventory_operation_lines line using phonebooks_team_private.sheet_entries entry
    where entry.workspace_id=p_workspace and entry.batch_id=p_request and line.workspace_id=p_workspace and line.operation_id=entry.operation_id;
  delete from phonebooks_team_private.stock_lots lot using phonebooks_team_private.sheet_entries entry
    where entry.workspace_id=p_workspace and entry.batch_id=p_request and lot.workspace_id=p_workspace and lot.id=entry.operation_id;
  delete from phonebooks_team_private.inventory_operations op using phonebooks_team_private.sheet_entries entry
    where entry.workspace_id=p_workspace and entry.batch_id=p_request and op.workspace_id=p_workspace and op.id=entry.operation_id;
  update phonebooks_team_private.inventory_products product set quantity=product.quantity-totals.units,version=version+1,cloud_revision=new_revision
    from (select document->>'productId' id,sum((document->>'quantity')::integer)::integer units
      from phonebooks_team_private.sheet_entries where workspace_id=p_workspace and batch_id=p_request
        and document->>'type' in ('opening','purchase') group by 1) totals
    where product.workspace_id=p_workspace and product.id=totals.id and not (product.id=any(batch.new_products));
  update phonebooks_team_private.inventory_accounts account set cloud_revision=new_revision,version=version+1
    where account.workspace_id=p_workspace and exists (
      select from phonebooks_team_private.sheet_entries entry where entry.workspace_id=p_workspace and entry.batch_id=p_request
        and entry.document->>'accountId'=account.id);
  delete from phonebooks_team_private.inventory_products where workspace_id=p_workspace and id=any(batch.new_products);
  delete from phonebooks_team_private.inventory_categories where workspace_id=p_workspace and id=any(batch.new_categories);
  delete from phonebooks_team_private.sheet_entries where workspace_id=p_workspace and batch_id=p_request;
  update phonebooks_team_private.sheet_batches set reverted_revision=new_revision where workspace_id=p_workspace and id=p_request;
  update phonebooks_team_private.workspaces set cloud_revision=new_revision where id=p_workspace;
  insert into phonebooks_team_private.team_audit(workspace_id,actor_id,target_id,kind,current_values,owner_details)
    values(p_workspace,actor,p_request::text,'sheet.revert',jsonb_build_object('rows',batch.result->'rows'),true);
  return jsonb_build_object('revision',new_revision::text,'replayed',false);
end;
$$;
revoke all on function public.phonebooks_team_sheet_revert(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.phonebooks_team_sheet_revert(uuid,uuid,uuid) to authenticated;

alter function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) set schema phonebooks_team_private;
alter function phonebooks_team_private.phonebooks_team_cloud_page(uuid,uuid,jsonb) rename to cloud_page_before_sheet_revert;
revoke all on function phonebooks_team_private.cloud_page_before_sheet_revert(uuid,uuid,jsonb) from public,anon,authenticated;

create function public.phonebooks_team_cloud_page(p_workspace uuid,p_actor uuid,p_position jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=phonebooks_team_private.inventory_actor(p_workspace);
  reverted bigint;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  select max(reverted_revision) into reverted from phonebooks_team_private.sheet_batches
    where workspace_id=p_workspace and reverted_revision is not null;
  if reverted is not null and (coalesce((p_position->>'upper')::bigint,reverted)<reverted or
    (p_position->>'since')::bigint<reverted) then raise sqlstate 'PT409' using message='Import was reverted. Refresh the workspace.'; end if;
  return phonebooks_team_private.cloud_page_before_sheet_revert(p_workspace,p_actor,p_position);
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid page';
end;
$$;
revoke all on function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) to authenticated;

-- Imported history is a report record. It never authorizes a physical return or payment.
alter function phonebooks_team_private.return_line_values(uuid,text,integer) rename to return_line_values_before_sheet;
create function phonebooks_team_private.return_line_values(space uuid,receipt text,receipt_line integer)
returns table(amount_minor bigint,cost_minor bigint) language sql stable set search_path='' as $$
  select original.* from phonebooks_team_private.return_line_values_before_sheet(space,receipt,receipt_line) original
  where not exists(select from phonebooks_team_private.inventory_operations
    where workspace_id=space and id=receipt and request_payload->>'sheetType'='historical_sale');
$$;
revoke all on function phonebooks_team_private.return_line_values(uuid,text,integer) from public,anon,authenticated;

create index operations_sheet_export on phonebooks_team_private.inventory_operations(workspace_id,occurred_on,id);

create function public.phonebooks_team_sheet_export(p_workspace uuid,p_actor uuid,p_kind text,p_filter jsonb,p_after text,p_revision text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=phonebooks_team_private.inventory_actor(p_workspace);
  rights text[];
  revision text;
  from_day date:=(p_filter->>'from')::date;
  to_day date:=(p_filter->>'to')::date;
  search text:=lower(btrim(coalesce(p_filter->>'query','')));
  category text:=nullif(p_filter->>'category','');
  stock_status text:=coalesce(p_filter->>'status','');
  include_cost boolean;
  include_revenue boolean;
  result jsonb;
  next_key text;
  members_all boolean;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['data.export']);
  if jsonb_typeof(p_filter) is distinct from 'object' or from_day>to_day or length(search)>100 or
    length(coalesce(p_after,''))>4096 or coalesce(p_kind,'') not in
    ('stock','purchase','sale','returns','reservation','repair','expense','history','finance','employees','all') then
    raise sqlstate 'PT400' using message='Invalid export filter'; end if;
  select cloud_revision::text into revision from phonebooks_team_private.workspaces where id=p_workspace;
  if p_revision is not null and revision<>p_revision then raise sqlstate 'PT409' using message='Данные изменились. Повторите экспорт.'; end if;
  rights:=phonebooks_team_private.team_permissions(p_workspace,actor);
  include_cost:=array['stock.purchase_price.read','stock.cost.read','repair.cost.read']<@rights;
  include_revenue:='finance.revenue.read'=any(rights);
  if p_kind='finance' then
    result:=jsonb_build_array(public.phonebooks_team_stats(p_workspace,actor,null,from_day,to_day));
  elsif p_kind='employees' then
    members_all:=array['analytics.others','team.members.read']<@rights;
    if not members_all then perform phonebooks_team_private.require_permissions(p_workspace,actor,array['analytics.self']); end if;
    with entries as (
      select member.user_id,account.email name
      from phonebooks_team_private.memberships member
      join auth.users account on account.id=member.user_id
      where member.workspace_id=p_workspace and (members_all or member.user_id=actor) and (members_all and member.user_id<>actor or 'analytics.self'=any(rights))
        and member.user_id::text>coalesce(p_after,'') and (search='' or strpos(lower(account.email),search)>0)
      order by member.user_id limit 101
    ), page as (select * from entries order by user_id limit 100)
    select coalesce(jsonb_agg(jsonb_build_object('name',name,'actorId',user_id)||
      public.phonebooks_team_stats(p_workspace,actor,user_id,from_day,to_day) order by user_id),'[]'),
      case when (select count(*) from entries)>100 then (array_agg(user_id::text order by user_id desc))[1] end
      into result,next_key from page;
  elsif p_kind='reservation' then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read']);
    with entries as (
      select booking.*,product.name,op.occurred_on
      from phonebooks_team_private.stock_reservations booking
      join phonebooks_team_private.inventory_products product on product.workspace_id=p_workspace and product.id=booking.product_id
      left join phonebooks_team_private.inventory_operations op on op.workspace_id=p_workspace and op.id=booking.id
      where booking.workspace_id=p_workspace and booking.id>coalesce(p_after,'')
        and (from_day is null or op.occurred_on>=from_day) and (to_day is null or op.occurred_on<=to_day)
        and (search='' or strpos(lower(product.name),search)>0)
      order by booking.id limit 501
    ), page as (select * from entries order by id limit 500)
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'date',occurred_on,'quantity',quantity,'expiresAt',expires_at,
      'status',case when status='active' and expires_at<=statement_timestamp() then 'expired' else status end)
      || case when rights && array['trade.reserve','trade.reserve_cancel']
        then jsonb_build_object('buyer',buyer,'contact',contact) else '{}' end
      || case when 'finance.revenue.read'=any(rights) and rights && array['trade.reserve','trade.sale']
        then jsonb_build_object('unitMinor',unit_minor::text) else '{}' end order by id),'[]'),
      case when (select count(*) from entries)>500 then max(id) end into result,next_key from page;
  elsif p_kind='stock' then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read']);
    with entries as (
      select product.*,categories.name category_name,
        product.reserved_quantity+phonebooks_team_private.held_units(p_workspace,product.id,statement_timestamp()) held
      from phonebooks_team_private.inventory_products product
      join phonebooks_team_private.inventory_categories categories on categories.workspace_id=p_workspace and categories.id=product.category_id
      where product.workspace_id=p_workspace and product.id>coalesce(p_after,'')
        and (category is null or product.category_id=category)
        and (search='' or strpos(lower(product.name||' '||product.attributes::text),search)>0)
      order by product.id
    ), curtailed as (
      select * from entries where stock_status='' or (archived_at is null and
        (stock_status='all' or stock_status='repair' and in_repair or stock_status='reserved' and held>0 or
         stock_status='empty' and quantity=0 or stock_status='stock' and quantity>held and not in_repair))
      order by id limit 501
    ), page as (select * from curtailed order by id limit 500)
    select coalesce(jsonb_agg(jsonb_build_object('id',page.id,'name',page.name,'category',category_name,'tracking',tracking,'quantity',quantity,
      'reserved',held,'status',case when archived_at is not null then 'Архив' when in_repair then 'В ремонте' else 'Активен' end,
      'attributes',coalesce((select jsonb_object_agg(coalesce(def.value->>'name',field.key),field.value)
        from jsonb_each(page.attributes) field
        left join lateral (select value from jsonb_array_elements(category_info.attributes) value where value->>'id'=field.key) def on true),'{}'))
      || jsonb_build_object('plannedPriceMinor',page.planned_price_minor::text)
      || case when include_cost then jsonb_build_object('costMinor',(select coalesce(sum(lot.cost_minor),0)::text from phonebooks_team_private.stock_lots lot
        where lot.workspace_id=p_workspace and lot.product_id=page.id)) else '{}' end
      order by page.id),'[]'),case when (select count(*) from curtailed)>500 then max(page.id) end
      into result,next_key from page
      join phonebooks_team_private.inventory_categories category_info on category_info.workspace_id=p_workspace and category_info.id=page.category_id;
  else
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['finance.history.read']);
    with entries as (
      select op.*,op.id as token
      from phonebooks_team_private.inventory_operations op where op.workspace_id=p_workspace
        and (p_kind in ('history','all') or op.type=p_kind or p_kind='returns' and op.type in ('customer_return','supplier_return')
          or p_kind='repair' and op.type='repair_start')
        and (op.type<>'reservation' or 'stock.read'=any(rights))
        and (from_day is null or op.occurred_on>=from_day) and (to_day is null or op.occurred_on<=to_day)
        and op.id>coalesce(p_after,'')
        and (search='' or strpos(lower(op.id||' '||op.type||' '||coalesce(op.request_payload->>'name','')),search)>0 or exists(
          select from phonebooks_team_private.inventory_operation_lines line join phonebooks_team_private.inventory_products product
            on product.workspace_id=p_workspace and product.id=line.product_id
          where line.workspace_id=p_workspace and line.operation_id=op.id and strpos(lower(product.name),search)>0))
      order by op.id limit 501
    ), page as (select * from entries order by token limit 500)
    select coalesce(jsonb_agg(jsonb_build_object('id',page.id,'type',page.type,'date',page.occurred_on,'status',page.status,
      'historical',page.historical,'relatedId',page.related_id,'originalLine',page.request_payload->>'originalLine',
      'name',coalesce(page.request_payload->>'name',(select string_agg(product.name,', ' order by line.position)
        from phonebooks_team_private.inventory_operation_lines line join phonebooks_team_private.inventory_products product
          on product.workspace_id=p_workspace and product.id=line.product_id
        where line.workspace_id=p_workspace and line.operation_id=page.id)),
      'quantity',(select sum(line.quantity) from phonebooks_team_private.inventory_operation_lines line where line.workspace_id=p_workspace and line.operation_id=page.id))
      || case when 'team.members.read'=any(rights) and not page.historical then jsonb_build_object('actorId',page.actor_id) else '{}' end
      || case when include_revenue and page.type in ('sale','customer_return') then jsonb_build_object('revenueMinor',page.revenue_minor::text) else '{}' end
      || case when include_cost and 'finance.profit.read'=any(rights) and page.type in ('sale','customer_return') then jsonb_build_object('costMinor',page.cost_minor::text) else '{}' end
      || case when page.type='expense' then jsonb_build_object('expensesMinor',page.expense_minor::text) else '{}' end
      || case when page.type='purchase' and 'stock.purchase_price.read'=any(rights) or page.type='repair' and 'repair.cost.read'=any(rights) then
        jsonb_build_object('amountMinor',(select abs(coalesce(sum(posting.amount_minor),0))::text
          from phonebooks_team_private.inventory_postings posting where posting.workspace_id=p_workspace and posting.operation_id=page.id)) else '{}' end
      || case when 'finance.cash.read'=any(rights) and page.type<>'reservation'
        and (page.type not in ('purchase','supplier_return') or 'stock.purchase_price.read'=any(rights)) and (page.type<>'repair' or 'repair.cost.read'=any(rights))
        and (page.type not in ('sale','customer_return') or include_revenue)
        then jsonb_build_object('cashMinor',(select coalesce(sum(posting.amount_minor),0)::text
          from phonebooks_team_private.inventory_postings posting where posting.workspace_id=p_workspace and posting.operation_id=page.id)) else '{}' end
      order by token),'[]'),case when (select count(*) from entries)>500 then max(token) end
      into result,next_key from page;
  end if;
  return jsonb_build_object('rows',result,'next',next_key,'revision',revision,'permissions',rights);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise sqlstate 'PT400' using message='Invalid export filter';
end;
$$;
revoke all on function public.phonebooks_team_sheet_export(uuid,uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.phonebooks_team_sheet_export(uuid,uuid,text,jsonb,text,text) to authenticated;

commit;
