begin;

alter table phonebooks_team_private.workspaces add cloud_revision bigint not null default 0;
alter table phonebooks_team_private.inventory_categories add cloud_revision bigint not null default 0;
alter table phonebooks_team_private.inventory_products add cloud_revision bigint not null default 0;
alter table phonebooks_team_private.inventory_products add in_repair boolean not null default false;
alter table phonebooks_team_private.inventory_accounts add cloud_revision bigint not null default 0;
alter table phonebooks_team_private.inventory_operations add cloud_revision bigint not null default 0;
alter table phonebooks_team_private.inventory_operations add historical boolean not null default false;

create index cloud_products_feed on phonebooks_team_private.inventory_products(workspace_id, cloud_revision);
create index cloud_accounts_feed on phonebooks_team_private.inventory_accounts(workspace_id, cloud_revision);
create index cloud_operations_feed on phonebooks_team_private.inventory_operations(workspace_id, cloud_revision);

create table phonebooks_team_private.stock_lots (
  workspace_id uuid not null,
  product_id text not null,
  id text not null,
  acquired_revision bigint not null,
  quantity integer not null check (quantity >= 0),
  cost_minor bigint not null check (cost_minor >= 0 and (quantity > 0 or cost_minor = 0)),
  primary key (workspace_id, product_id, id),
  foreign key (workspace_id, product_id) references phonebooks_team_private.inventory_products(workspace_id, id)
);
create index stock_lots_fifo on phonebooks_team_private.stock_lots(workspace_id, product_id, acquired_revision, id) where quantity > 0;

create table phonebooks_team_private.cloud_requests (
  workspace_id uuid not null,
  request_id uuid not null,
  actor_id uuid not null,
  command jsonb not null,
  result jsonb not null,
  primary key (workspace_id, request_id),
  foreign key (workspace_id, actor_id) references phonebooks_team_private.memberships(workspace_id, user_id)
);

create function phonebooks_team_private.initialize_cloud_cash() returns trigger
language plpgsql set search_path = '' as $$
begin
  insert into phonebooks_team_private.inventory_accounts(workspace_id, id, name) values (new.id, 'ac_default_cash', 'Касса');
  return new;
end;
$$;
create trigger initialize_cloud_cash after insert on phonebooks_team_private.workspaces
  for each row execute function phonebooks_team_private.initialize_cloud_cash();
insert into phonebooks_team_private.inventory_accounts(workspace_id, id, name)
  select id, 'ac_default_cash', 'Касса' from phonebooks_team_private.workspaces on conflict do nothing;

create function phonebooks_team_private.cloud_integer(value jsonb, minimum bigint, maximum bigint)
returns bigint language plpgsql immutable set search_path = '' as $$
declare
  amount numeric;
begin
  if jsonb_typeof(value) is distinct from 'number' then
    raise sqlstate 'PT400' using message = 'Expected an integer';
  end if;
  amount := value::numeric;
  if amount <> trunc(amount) or amount not between minimum and maximum then
    raise sqlstate 'PT400' using message = 'Integer out of range';
  end if;
  return amount::bigint;
end;
$$;

create function phonebooks_team_private.consume_stock(p_workspace uuid, p_product text, p_quantity integer)
returns bigint language plpgsql set search_path = '' as $$
declare
  lot phonebooks_team_private.stock_lots;
  remaining integer := p_quantity;
  take integer;
  portion bigint;
  total bigint := 0;
begin
  for lot in
    select * from phonebooks_team_private.stock_lots
    where workspace_id = p_workspace and product_id = p_product and quantity > 0
    order by acquired_revision, id for update
  loop
    take := least(remaining, lot.quantity);
    -- Integer division leaves the rounding remainder in the lot until its last unit.
    portion := trunc(lot.cost_minor::numeric * take / lot.quantity)::bigint;
    update phonebooks_team_private.stock_lots
      set quantity = quantity - take, cost_minor = cost_minor - portion
      where workspace_id = p_workspace and product_id = p_product and id = lot.id;
    total := total + portion;
    remaining := remaining - take;
    exit when remaining = 0;
  end loop;
  if remaining <> 0 then
    raise sqlstate 'PT409' using message = 'Stock lots do not cover the requested quantity';
  end if;
  return total;
end;
$$;

create function public.phonebooks_team_cloud_command(p_workspace uuid, p_actor uuid, p_request uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  member_role text;
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
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  select role into member_role from phonebooks_team_private.memberships where workspace_id = p_workspace and user_id = actor;
  if p_request is null or jsonb_typeof(p_command) is distinct from 'object' or kind is null
    or kind not in ('purchase','sale','repair','expense','stock_adjustment','deposit')
    or p_command - array['type','productId','expectedVersion','accountId','quantity','unitPriceMinor','amountMinor',
      'name','categoryId','tracking','attributes'] <> '{}'::jsonb then
    raise sqlstate 'PT400' using message = 'Unsupported command';
  end if;
  if member_role = 'employee' and kind <> 'sale' then
    raise sqlstate 'PT403' using message = 'Operation requires manager or owner';
  end if;

  -- All writers and the import acquire the same workspace lock. The revision and
  -- the receipt become visible together with the ledger, lots and balances.
  select cloud_revision into revision from phonebooks_team_private.workspaces where id = p_workspace for update;
  select * into saved from phonebooks_team_private.cloud_requests where workspace_id = p_workspace and request_id = p_request;
  if found then
    if saved.actor_id = actor and saved.command = p_command then return saved.result; end if;
    raise sqlstate 'PT409' using message = 'Request ID already used';
  end if;
  revision := revision + 1;

  if kind in ('purchase','sale','repair','stock_adjustment') then
    if kind = 'purchase' and sku is null then
      sku := 'product:' || p_request;
      insert into phonebooks_team_private.inventory_products(workspace_id,id,category_id,name,tracking,attributes,cloud_revision)
        values(p_workspace,sku,p_command->>'categoryId',btrim(p_command->>'name'),p_command->>'tracking',
          coalesce(p_command->'attributes','{}'),revision) returning * into product;
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
      if product.tracking = 'unit' and (units <> 1 or p_command->>'productId' is not null) then
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

create function public.phonebooks_team_cloud_feed(p_workspace uuid, p_actor uuid, p_cursor bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.session_user();
  member_role text;
  revision bigint;
  finance boolean;
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  select membership.role, workspace.cloud_revision into member_role, revision
    from phonebooks_team_private.memberships as membership
    join phonebooks_team_private.workspaces as workspace on workspace.id = membership.workspace_id
    where membership.user_id = actor and membership.workspace_id = p_workspace and membership.revoked_at is null;
  if not found then raise sqlstate 'PT403' using message = 'Active workspace membership required'; end if;
  if p_cursor is not null and p_cursor not between 0 and revision then raise sqlstate 'PT409' using message = 'Invalid revision'; end if;
  finance := member_role in ('owner','manager');
  return jsonb_build_object(
    'role',member_role,'cursor',revision::text,
    'categories',(
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'attributes',attributes) order by name),'[]')
      from phonebooks_team_private.inventory_categories where workspace_id = p_workspace and cloud_revision > coalesce(p_cursor,-1)),
    'products',(
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'categoryId',category_id,'tracking',tracking,
        'attributes',attributes,'quantity',quantity,'reserved',reserved_quantity,'version',version,
        'inRepair',in_repair,'archived',archived_at is not null) order by name,id),'[]')
      from phonebooks_team_private.inventory_products where workspace_id = p_workspace and cloud_revision > coalesce(p_cursor,-1)
    ),
    'accounts',(
      select coalesce(jsonb_agg(
        jsonb_build_object('id',account.id,'name',account.name,'archived',account.archived_at is not null) ||
        case when finance then jsonb_build_object('balanceMinor',(account.opening_balance_minor + coalesce(movement.delta_minor,0))::text) else '{}' end
        order by account.id),'[]')
      from phonebooks_team_private.inventory_accounts as account
      left join phonebooks_team_private.inventory_account_movements as movement
        on movement.workspace_id = account.workspace_id and movement.account_id = account.id and finance
      where account.workspace_id = p_workspace and account.cloud_revision > coalesce(p_cursor,-1)
    ),
    'totals',case when finance then (
      select to_jsonb(totals) from phonebooks_team_private.inventory_totals(p_workspace) as totals
    ) else null end,
    'operations',case when finance then (
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',type,'actorId',case when not historical then actor_id end,
        'date',occurred_on,'status',status) order by cloud_revision,id),'[]')
      from phonebooks_team_private.inventory_operations where workspace_id = p_workspace and cloud_revision > coalesce(p_cursor,-1)
    ) else '[]'::jsonb end
  );
end;
$$;

alter table phonebooks_team_private.stock_lots enable row level security;
alter table phonebooks_team_private.cloud_requests enable row level security;
revoke all on phonebooks_team_private.stock_lots, phonebooks_team_private.cloud_requests from public, anon, authenticated;
revoke all on all functions in schema phonebooks_team_private from public, anon, authenticated;
revoke all on function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb),
  public.phonebooks_team_cloud_feed(uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function public.phonebooks_team_cloud_command(uuid,uuid,uuid,jsonb),
  public.phonebooks_team_cloud_feed(uuid,uuid,bigint) to authenticated;

commit;
