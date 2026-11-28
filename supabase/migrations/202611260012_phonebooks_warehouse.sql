begin;

alter table phonebooks_team_private.inventory_products
  add column planned_price_minor bigint check (planned_price_minor between 0 and 10000000000);
update phonebooks_team_private.permission_catalog set available=true
where id in ('stock.edit','stock.planned_price.write','stock.categories.manage','stock.bulk_edit');

alter function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) set schema phonebooks_team_private;
alter function phonebooks_team_private.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) rename to stock_command;
revoke all on function phonebooks_team_private.stock_command(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

create function public.phonebooks_team_cloud_command(p_workspace uuid,p_actor uuid,p_request uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  kind text := p_command->>'type';
  actor uuid;
  revision bigint;
  saved phonebooks_team_private.cloud_requests;
  receipt jsonb;
  sku text;
  price bigint;
  old_name text;
  entry jsonb;
begin
  if kind not in ('save_category','edit_product','bulk_price','bulk_attributes','rename_workspace') or kind is null then
    return phonebooks_team_private.stock_command(p_workspace,p_actor,p_request,p_command);
  end if;

  actor := phonebooks_team_private.inventory_actor(p_workspace);
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  if p_request is null or jsonb_typeof(p_command) is distinct from 'object' then
    raise sqlstate 'PT400' using message='Invalid catalogue command';
  end if;
  select cloud_revision+1, name into revision, old_name
    from phonebooks_team_private.workspaces where id=p_workspace for update;
  perform phonebooks_team_private.inventory_actor(p_workspace);
  case kind
    when 'save_category' then perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read','stock.categories.manage']);
    when 'edit_product' then
      perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read','stock.edit']);
      if p_command ? 'plannedPriceMinor' then
        perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.planned_price.write']);
      end if;
    when 'bulk_price' then
      perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read','stock.bulk_edit','stock.planned_price.write']);
    when 'bulk_attributes' then perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.read','stock.bulk_edit','stock.edit']);
    when 'rename_workspace' then
      if not exists(select from phonebooks_team_private.memberships where workspace_id=p_workspace and user_id=actor and role='owner' and revoked_at is null) then
        raise sqlstate 'PT403' using message='Owner required';
      end if;
  end case;
  select * into saved from phonebooks_team_private.cloud_requests where workspace_id=p_workspace and request_id=p_request;
  if found then
    if saved.actor_id=actor and saved.command=p_command then return saved.result; end if;
    raise sqlstate 'PT409' using message='Request ID already used';
  end if;

  case kind
    when 'save_category' then
      if p_command - array['type','categoryId','name','attributes','expectedVersion'] <> '{}'::jsonb
        or jsonb_typeof(p_command->'attributes') is distinct from 'array' then
        raise sqlstate 'PT400' using message='Invalid category';
      end if;
      if phonebooks_team_private.cloud_integer(p_command->'expectedVersion',0,2147483647)=0 then
        insert into phonebooks_team_private.inventory_categories(workspace_id,id,name,attributes,cloud_revision)
          values(p_workspace,p_command->>'categoryId',btrim(p_command->>'name'),p_command->'attributes',revision);
      else
        update phonebooks_team_private.inventory_categories
          set name=btrim(p_command->>'name'), attributes=p_command->'attributes', version=version+1,cloud_revision=revision
          where workspace_id=p_workspace and id=p_command->>'categoryId'
            and version=phonebooks_team_private.cloud_integer(p_command->'expectedVersion',1,2147483647);
        if not found then raise sqlstate 'PT409' using message='Category changed'; end if;
      end if;
      insert into phonebooks_team_private.team_audit(workspace_id,actor_id,target_id,kind,current_values,stock)
        values(p_workspace,actor,p_command->>'categoryId','category.save',jsonb_build_object('name',btrim(p_command->>'name')),true);
    when 'edit_product' then
      if p_command - array['type','productId','categoryId','name','attributes','expectedVersion','plannedPriceMinor'] <> '{}'::jsonb
        or jsonb_typeof(p_command->'attributes') is distinct from 'object' then
        raise sqlstate 'PT400' using message='Invalid product';
      end if;
      if p_command ? 'plannedPriceMinor' and p_command->'plannedPriceMinor' <> 'null'::jsonb then
        price := phonebooks_team_private.cloud_integer(p_command->'plannedPriceMinor',0,10000000000);
      end if;
      update phonebooks_team_private.inventory_products
        set name=btrim(p_command->>'name'), category_id=p_command->>'categoryId', attributes=p_command->'attributes',
          planned_price_minor=case when p_command ? 'plannedPriceMinor' then price else planned_price_minor end,
          version=version+1,cloud_revision=revision
        where workspace_id=p_workspace and id=p_command->>'productId' and archived_at is null
          and version=phonebooks_team_private.cloud_integer(p_command->'expectedVersion',1,2147483647);
      if not found then raise sqlstate 'PT409' using message='Product changed'; end if;
    when 'bulk_price', 'bulk_attributes' then
      if p_command - array['type','items'] <> '{}'::jsonb or jsonb_typeof(p_command->'items') is distinct from 'array'
        or jsonb_array_length(p_command->'items') not between 1 and 100 then
        raise sqlstate 'PT400' using message='Invalid batch';
      end if;
      if (select count(distinct row->>'id') from jsonb_array_elements(p_command->'items') row) <> jsonb_array_length(p_command->'items') then
        raise sqlstate 'PT400' using message='Invalid batch products';
      end if;
      for entry in select value from jsonb_array_elements(p_command->'items') loop
        if jsonb_typeof(entry) is distinct from 'object'
          or entry - (array['id','version'] || case when kind='bulk_price' then 'plannedPriceMinor' else 'attributes' end) <> '{}'::jsonb
          or (kind='bulk_price' and not entry ? 'plannedPriceMinor')
          or (kind='bulk_attributes' and jsonb_typeof(entry->'attributes') is distinct from 'object') then
          raise sqlstate 'PT400' using message='Invalid batch item';
        end if;
        if kind='bulk_price' then
          price := case when entry->'plannedPriceMinor'='null'::jsonb then null
            else phonebooks_team_private.cloud_integer(entry->'plannedPriceMinor',0,10000000000) end;
        end if;
        update phonebooks_team_private.inventory_products set
          planned_price_minor=case when kind='bulk_price' then price else planned_price_minor end,
          attributes=case when kind='bulk_attributes' then entry->'attributes' else attributes end,
          version=version+1, cloud_revision=revision
          where workspace_id=p_workspace and id=entry->>'id' and archived_at is null
            and version=phonebooks_team_private.cloud_integer(entry->'version',1,2147483647);
        if not found then raise sqlstate 'PT409' using message='Product changed'; end if;
      end loop;
    when 'rename_workspace' then
      if p_command - array['type','name','previousName'] <> '{}'::jsonb then
        raise sqlstate 'PT400' using message='Invalid workspace name';
      end if;
      if old_name is distinct from p_command->>'previousName' then raise sqlstate 'PT409' using message='Workspace name changed'; end if;
      update phonebooks_team_private.workspaces set name=btrim(p_command->>'name') where id=p_workspace;
      insert into phonebooks_team_private.team_audit(workspace_id,actor_id,target_id,kind,previous,current_values)
        values(p_workspace,actor,p_workspace::text,'workspace.rename',jsonb_build_object('name',old_name),
          jsonb_build_object('name',btrim(p_command->>'name')));
  end case;
  update phonebooks_team_private.workspaces set cloud_revision=revision where id=p_workspace;
  receipt := jsonb_build_object('revision',revision::text);
  insert into phonebooks_team_private.cloud_requests values(p_workspace,p_request,actor,p_command,receipt);
  return receipt;
exception when check_violation or not_null_violation or foreign_key_violation or unique_violation or invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid or incompatible catalogue data';
end;
$$;
revoke all on function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb) to authenticated;

alter function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) set schema phonebooks_team_private;
alter function phonebooks_team_private.phonebooks_team_cloud_page(uuid,uuid,jsonb) rename to cloud_page;
revoke all on function phonebooks_team_private.cloud_page(uuid,uuid,jsonb) from public,anon,authenticated;

create function public.phonebooks_team_cloud_page(p_workspace uuid,p_actor uuid,p_position jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  page jsonb := phonebooks_team_private.cloud_page(p_workspace,p_actor,p_position);
begin
  return jsonb_set(jsonb_set(page,'{products}',(
    select coalesce(jsonb_agg(entry.value || jsonb_build_object('plannedPriceMinor',product.planned_price_minor::text,
      'purchased',product.tracking='unit' and exists(select from phonebooks_team_private.inventory_operation_lines line
        where line.workspace_id=p_workspace and line.product_id=product.id and line.stock_delta>0)) order by entry.position),'[]')
    from jsonb_array_elements(page->'products') with ordinality entry(value,position)
    join phonebooks_team_private.inventory_products product on product.workspace_id=p_workspace and product.id=entry.value->>'id'
  )), '{categories}', (
    select coalesce(jsonb_agg(entry.value || jsonb_build_object('version',category.version) order by entry.position),'[]')
    from jsonb_array_elements(page->'categories') with ordinality entry(value,position)
    join phonebooks_team_private.inventory_categories category on category.workspace_id=p_workspace and category.id=entry.value->>'id'
  ));
end;
$$;
revoke all on function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_cloud_page(uuid,uuid,jsonb) to authenticated;

drop trigger audit_product_metadata on phonebooks_team_private.inventory_products;
create trigger audit_product_metadata after update of name,category_id,tracking,attributes,archived_at,planned_price_minor
  on phonebooks_team_private.inventory_products for each row execute function phonebooks_team_private.log_team_event();

create or replace function phonebooks_team_private.trade_command(p_workspace uuid, p_actor uuid, p_request uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  needed text[];
  kind text := p_command->>'type';
  sku text := p_command->>'productId';
  account text := p_command->>'accountId';
  operation_id text := 'cloud:' || p_request::text;
  product phonebooks_team_private.inventory_products;
  saved phonebooks_team_private.cloud_requests;
  revision bigint;
  units integer := 0;
  stock_delta integer := 0;
  cash_delta bigint := 0;
  revenue bigint := 0;
  cogs bigint := 0;
  expense bigint := 0;
  balance numeric;
  reply jsonb;
  planned bigint;
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  if p_request is null or jsonb_typeof(p_command) is distinct from 'object' or kind is null
    or kind not in ('purchase','sale','repair','expense','stock_adjustment','deposit')
    or p_command - array['type','productId','expectedVersion','accountId','quantity','unitPriceMinor','amountMinor',
      'name','categoryId','tracking','attributes','plannedPriceMinor'] <> '{}'::jsonb then
    raise sqlstate 'PT400' using message = 'Unsupported command';
  end if;

  -- All writers and the import acquire the same workspace lock. The revision and
  -- the receipt become visible together with the ledger, lots and balances.
  select cloud_revision into revision from phonebooks_team_private.workspaces where id = p_workspace for update;
  perform phonebooks_team_private.inventory_actor(p_workspace);
  needed := case kind
    when 'purchase' then array['stock.read','trade.purchase'] ||
      case when sku is null then array['stock.create'] else '{}'::text[] end
    when 'sale' then array['stock.read','trade.sale']
    when 'repair' then array['stock.read','repair.finish']
    when 'expense' then array['finance.expense','finance.cash.read']
    when 'deposit' then array['finance.deposit']
    when 'stock_adjustment' then array['stock.read','stock.adjust']
  end;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,needed);
  if kind='purchase' and phonebooks_team_private.cloud_integer(p_command->'unitPriceMinor',0,10000000000)>0 then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['finance.cash.read']);
  elsif kind='repair' and phonebooks_team_private.cloud_integer(p_command->'amountMinor',0,10000000000)>0 then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['repair.expense','finance.cash.read']);
  elsif kind='stock_adjustment' and phonebooks_team_private.cloud_integer(p_command->'quantity',-100000,100000)<0 then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.writeoff']);
  end if;
  if p_command ? 'plannedPriceMinor' then
    if kind<>'purchase' or sku is not null then raise sqlstate 'PT400' using message='Invalid planned price'; end if;
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['stock.planned_price.write']);
    planned := phonebooks_team_private.cloud_integer(p_command->'plannedPriceMinor',0,10000000000);
  end if;
  select * into saved from phonebooks_team_private.cloud_requests where workspace_id = p_workspace and request_id = p_request;
  if found then
    if saved.actor_id = actor and saved.command = p_command then return saved.result; end if;
    raise sqlstate 'PT409' using message = 'Request ID already used';
  end if;
  revision := revision + 1;

  if kind in ('purchase','sale','repair','stock_adjustment') then
    if kind = 'purchase' and sku is null then
      sku := 'product:' || p_request;
      insert into phonebooks_team_private.inventory_products(workspace_id,id,category_id,name,tracking,attributes,cloud_revision,planned_price_minor)
        values(p_workspace,sku,p_command->>'categoryId',btrim(p_command->>'name'),p_command->>'tracking',
          coalesce(p_command->'attributes','{}'),revision,planned) returning * into product;
    else
      select * into product from phonebooks_team_private.inventory_products
        where workspace_id = p_workspace and id = sku and archived_at is null for update;
      if not found or product.version is distinct from
        phonebooks_team_private.cloud_integer(p_command->'expectedVersion', 1, 2147483647) then
        raise sqlstate 'PT409' using message = 'Product changed or unavailable';
      end if;
    end if;
  end if;

  case kind
    when 'purchase' then
      units := phonebooks_team_private.cloud_integer(p_command->'quantity', 1, 100000);
      if product.tracking = 'unit' and (units <> 1 or product.quantity<>0 or exists(select from phonebooks_team_private.inventory_operation_lines line
        where line.workspace_id=p_workspace and line.product_id=sku and line.stock_delta>0)) then
        raise sqlstate 'PT409' using message = 'Individual items require a new card';
      end if;
      cash_delta := -units * phonebooks_team_private.cloud_integer(p_command->'unitPriceMinor', 0, 10000000000);
      stock_delta := units;
      insert into phonebooks_team_private.stock_lots values (p_workspace,sku,operation_id,revision,units,-cash_delta);
    when 'sale' then
      units := phonebooks_team_private.cloud_integer(p_command->'quantity', 1, 100000);
      if product.in_repair or units > product.quantity - product.reserved_quantity then
        raise sqlstate 'PT409' using message = 'Insufficient available stock';
      end if;
      cogs := phonebooks_team_private.consume_stock(p_workspace,sku,units);
      revenue := units * phonebooks_team_private.cloud_integer(p_command->'unitPriceMinor', 1, 10000000000);
      cash_delta := revenue;
      stock_delta := -units;
    when 'repair' then
      if product.tracking <> 'unit' or product.quantity <> 1 then raise sqlstate 'PT409' using message = 'Repair requires an item in stock'; end if;
      units := 1;
      cash_delta := -phonebooks_team_private.cloud_integer(p_command->'amountMinor', 0, 10000000000);
      update phonebooks_team_private.stock_lots set cost_minor = cost_minor - cash_delta
        where workspace_id = p_workspace and product_id = sku and quantity = 1;
      if not found then raise sqlstate 'PT409' using message = 'Stock lot missing'; end if;
    when 'expense' then
      expense := phonebooks_team_private.cloud_integer(p_command->'amountMinor', 1, 10000000000);
      cash_delta := -expense;
    when 'deposit' then
      cash_delta := phonebooks_team_private.cloud_integer(p_command->'amountMinor', 1, 10000000000);
    when 'stock_adjustment' then
      stock_delta := phonebooks_team_private.cloud_integer(p_command->'quantity', -100000, 100000);
      units := abs(stock_delta);
      if stock_delta = 0 or product.in_repair or stock_delta < product.reserved_quantity - product.quantity
        or (product.tracking = 'unit' and stock_delta > 0) then
        raise sqlstate 'PT409' using message = 'Stock adjustment not available';
      end if;
      if stock_delta > 0 then
        insert into phonebooks_team_private.stock_lots values (p_workspace,sku,operation_id,revision,units,0);
      else expense := phonebooks_team_private.consume_stock(p_workspace,sku,units);
      end if;
  end case;

  if kind <> 'stock_adjustment' then
    select inventory_account.opening_balance_minor + coalesce(movement.delta_minor,0) into balance
      from phonebooks_team_private.inventory_accounts as inventory_account
      left join phonebooks_team_private.inventory_account_movements as movement
        on movement.workspace_id = inventory_account.workspace_id and movement.account_id = inventory_account.id
      where inventory_account.workspace_id = p_workspace and inventory_account.id = account and inventory_account.archived_at is null;
    if not found then raise sqlstate 'PT400' using message = 'Active cash account required'; end if;
    if cash_delta < 0 and balance + cash_delta < 0 then raise sqlstate 'PT409' using message = 'Insufficient funds'; end if;
  end if;
  if sku is not null and units > 0 then
    update phonebooks_team_private.inventory_products
      set quantity = quantity + stock_delta, version = version + 1, cloud_revision = revision,
        in_repair = in_repair and kind <> 'repair'
      where workspace_id = p_workspace and id = sku;
  end if;
  perform phonebooks_team_private.record_inventory_operation(p_workspace, p_request, jsonb_build_object(
    'id',operation_id,'version',1,'type',kind,'status','posted','date',current_date,
    'revenueMinor',revenue,'costMinor',cogs,'expenseMinor',expense,
    'lines',case when sku is null or units = 0 then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('productId',sku,'quantity',units,'stockDelta',stock_delta)) end,
    'postings',case when cash_delta = 0 then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('accountId',account,'amountMinor',cash_delta)) end
  ));
  update phonebooks_team_private.inventory_operations set cloud_revision = revision where workspace_id = p_workspace and id = operation_id;
  if cash_delta <> 0 then
    update phonebooks_team_private.inventory_accounts set cloud_revision = revision, version = version + 1
      where workspace_id = p_workspace and id = account;
  end if;
  update phonebooks_team_private.workspaces set cloud_revision = revision where id = p_workspace;
  reply := jsonb_build_object('operationId',operation_id,'revision',revision::text);
  insert into phonebooks_team_private.cloud_requests values (p_workspace,p_request,actor,p_command,reply);
  return reply;
exception when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message = 'Invalid catalogue, stock or cash document';
end;
$$;


create or replace function public.phonebooks_team_solo_import(
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
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['data.solo_transfer']);
  -- Only the deployed Worker can relay material calculated on the server.
  if p_key is null or not exists (
    select from phonebooks_team_private.solo_import_config where key_hash = sha256(convert_to(p_key,'UTF8'))
  ) then raise sqlstate 'PT403' using message = 'Untrusted transfer'; end if;
  select cloud_revision into revision from phonebooks_team_private.workspaces where id = p_workspace for update;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['data.solo_transfer']);
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
    attributes,quantity,reserved_quantity,version,archived_at,cloud_revision,in_repair,planned_price_minor)
    select p_workspace,item.id,item."categoryId",btrim(item.name),item.tracking,item.attributes,
      item.quantity,item."reservedQuantity",coalesce(item.version,1),
      case when item.status = 'archived' then statement_timestamp() end,revision,item.status = 'repair',item."plannedPriceMinor"
    from jsonb_to_recordset(p_material->'products') as item(id text,"categoryId" text,name text,tracking text,
      attributes jsonb,quantity integer,"reservedQuantity" integer,version integer,status text,"plannedPriceMinor" bigint);

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

create function public.phonebooks_team_search_history(
  p_workspace uuid,p_actor uuid,p_product text,p_kind text,p_from date,p_to date,p_offset integer,p_query text
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
    or length(p_query)>120 or p_kind is not null and p_kind not in ('sale','repair','cash') then
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
      and (nullif(btrim(p_query),'') is null
        or strpos(lower(op.id || ' ' || op.occurred_on::text || ' ' || op.type), lower(btrim(p_query)))>0
        or stock and exists(select from phonebooks_team_private.inventory_operation_lines search_line
          join phonebooks_team_private.inventory_products search_product on search_product.workspace_id=p_workspace and search_product.id=search_line.product_id
          where search_line.workspace_id=p_workspace and search_line.operation_id=op.id
            and strpos(lower(search_product.name || ' ' || search_product.attributes::text), lower(btrim(p_query)))>0))
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


revoke all on function public.phonebooks_team_search_history(uuid,uuid,text,text,date,date,integer,text) from public,anon,authenticated;
grant execute on function public.phonebooks_team_search_history(uuid,uuid,text,text,date,date,integer,text) to authenticated;

create or replace function phonebooks_team_private.seed_inventory_categories(p_workspace uuid) returns void
language sql set search_path = '' as $$
  insert into phonebooks_team_private.inventory_categories(workspace_id, id, name, attributes, standard)
    select p_workspace, seed.id, seed.name, seed.attributes::jsonb, true from (values
      ('smartphones', 'Смартфоны', '[{"id":"imei","name":"IMEI","type":"text"},{"id":"storage","name":"Память","type":"text"},{"id":"color","name":"Цвет","type":"text"},{"id":"condition","name":"Состояние","type":"text"},{"id":"kit","name":"Комплект","type":"text"}]'),
      ('laptops', 'Ноутбуки', '[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"processor","name":"Процессор","type":"text"},{"id":"ram","name":"Оперативная память","type":"text"},{"id":"storage","name":"Накопитель","type":"text"}]'), ('tablets', 'Планшеты', '[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"storage","name":"Память","type":"text"},{"id":"screen","name":"Экран","type":"text"}]'), ('consoles', 'Игровые приставки', '[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"edition","name":"Версия","type":"text"},{"id":"storage","name":"Накопитель","type":"text"}]'),
      ('watches', 'Умные часы', '[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"size","name":"Размер корпуса","type":"text"}]'), ('computers', 'Компьютеры', '[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"processor","name":"Процессор","type":"text"},{"id":"ram","name":"Оперативная память","type":"text"},{"id":"storage","name":"Накопитель","type":"text"}]'), ('components', 'Комплектующие', '[{"id":"article","name":"Артикул","type":"text"},{"id":"compatibility","name":"Совместимость","type":"text"}]'),
      ('accessories', 'Аксессуары', '[{"id":"type","name":"Вид","type":"text"},{"id":"compatibility","name":"Совместимость","type":"text"},{"id":"color","name":"Цвет","type":"text"}]'),
      ('other', 'Прочее', '[]')
    ) as seed(id, name, attributes)
    on conflict (workspace_id, id) do nothing;
$$;
with defaults(id,attributes) as (values
  ('laptops','[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"processor","name":"Процессор","type":"text"},{"id":"ram","name":"Оперативная память","type":"text"},{"id":"storage","name":"Накопитель","type":"text"}]'::jsonb),
  ('tablets','[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"storage","name":"Память","type":"text"},{"id":"screen","name":"Экран","type":"text"}]'::jsonb),
  ('consoles','[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"edition","name":"Версия","type":"text"},{"id":"storage","name":"Накопитель","type":"text"}]'::jsonb),
  ('watches','[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"size","name":"Размер корпуса","type":"text"}]'::jsonb),
  ('computers','[{"id":"serial","name":"Серийный номер","type":"text"},{"id":"processor","name":"Процессор","type":"text"},{"id":"ram","name":"Оперативная память","type":"text"},{"id":"storage","name":"Накопитель","type":"text"}]'::jsonb),
  ('components','[{"id":"article","name":"Артикул","type":"text"},{"id":"compatibility","name":"Совместимость","type":"text"}]'::jsonb)
),
  changed_workspaces as (
    update phonebooks_team_private.workspaces space set cloud_revision=space.cloud_revision+1
      where exists(select from phonebooks_team_private.inventory_categories category join defaults seed on seed.id=category.id
        where category.workspace_id=space.id and category.standard and category.attributes='[]'::jsonb)
      returning id,cloud_revision
  )
update phonebooks_team_private.inventory_categories category
  set attributes=seed.attributes,version=category.version+1,cloud_revision=space.cloud_revision
  from defaults seed,changed_workspaces space
  where category.workspace_id=space.id and category.id=seed.id and category.standard and category.attributes='[]'::jsonb;

commit;
