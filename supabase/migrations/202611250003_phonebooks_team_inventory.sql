begin;

create table phonebooks_team_private.inventory_categories (
  workspace_id uuid not null references phonebooks_team_private.workspaces(id) on delete restrict,
  id text not null check (id ~ '^[a-zA-Z0-9_-]{1,100}$'),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  attributes jsonb not null default '[]' check (jsonb_typeof(attributes) = 'array'),
  standard boolean not null default false,
  version integer not null default 1 check (version > 0),
  primary key (workspace_id, id)
);

create function phonebooks_team_private.seed_inventory_categories(p_workspace uuid) returns void
language sql set search_path = '' as $$
  insert into phonebooks_team_private.inventory_categories(workspace_id, id, name, attributes, standard)
    select p_workspace, seed.id, seed.name, seed.attributes::jsonb, true from (values
      ('smartphones', 'Смартфоны', '[{"id":"imei","name":"IMEI","type":"text"},{"id":"storage","name":"Память","type":"text"},{"id":"color","name":"Цвет","type":"text"},{"id":"condition","name":"Состояние","type":"text"},{"id":"kit","name":"Комплект","type":"text"}]'),
      ('laptops', 'Ноутбуки', '[]'), ('tablets', 'Планшеты', '[]'), ('consoles', 'Игровые приставки', '[]'),
      ('watches', 'Умные часы', '[]'), ('computers', 'Компьютеры', '[]'), ('components', 'Комплектующие', '[]'),
      ('accessories', 'Аксессуары', '[{"id":"type","name":"Вид","type":"text"},{"id":"compatibility","name":"Совместимость","type":"text"},{"id":"color","name":"Цвет","type":"text"}]'),
      ('other', 'Прочее', '[]')
    ) as seed(id, name, attributes)
    on conflict (workspace_id, id) do nothing;
$$;

create function phonebooks_team_private.initialize_workspace_inventory() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform phonebooks_team_private.seed_inventory_categories(new.id);
  return new;
end;
$$;
create trigger initialize_workspace_inventory after insert on phonebooks_team_private.workspaces
  for each row execute function phonebooks_team_private.initialize_workspace_inventory();
select phonebooks_team_private.seed_inventory_categories(id) from phonebooks_team_private.workspaces;

create table phonebooks_team_private.inventory_products (
  workspace_id uuid not null,
  id text not null check (char_length(id) > 0),
  category_id text not null,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  tracking text not null check (tracking in ('unit', 'quantity')),
  attributes jsonb not null default '{}' check (jsonb_typeof(attributes) = 'object'),
  quantity integer not null default 0 check (quantity >= 0),
  reserved_quantity integer not null default 0 check (reserved_quantity between 0 and quantity),
  version integer not null default 1 check (version > 0),
  archived_at timestamptz,
  primary key (workspace_id, id),
  unique (workspace_id, id, tracking),
  foreign key (workspace_id, category_id) references phonebooks_team_private.inventory_categories(workspace_id, id)
);

alter table phonebooks_team_private.inventory_products
  add constraint inventory_unit_quantity check (tracking <> 'unit' or quantity <= 1);

create function phonebooks_team_private.inventory_attributes_match(definitions jsonb, supplied jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select not exists (
    select from jsonb_each(supplied) as attribute(id, value)
    where not exists (
      select from jsonb_array_elements(definitions) as field
      where field->>'id' = attribute.id
        and jsonb_typeof(attribute.value) = case when field->>'type' = 'text' then 'string' else field->>'type' end
    )
  );
$$;

create function phonebooks_team_private.validate_inventory_category() returns trigger
language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(new.attributes) <> 'array' or exists (
    select from jsonb_array_elements(new.attributes) as field
    where jsonb_typeof(field) <> 'object'
      or jsonb_typeof(field->'id') is distinct from 'string'
      or field->>'id' !~ '^[a-zA-Z0-9_-]{1,100}$'
      or field->>'id' in ('__proto__', 'prototype', 'constructor')
      or jsonb_typeof(field->'name') is distinct from 'string'
      or char_length(field->>'name') > 100 or btrim(field->>'name') = ''
      or coalesce(field->>'type', '') not in ('text', 'number', 'boolean')
  ) or exists (
    select from jsonb_array_elements(new.attributes) as field group by field->>'id' having count(*) > 1
  ) or exists (
    select from phonebooks_team_private.inventory_products as product
    where product.workspace_id = new.workspace_id and product.category_id = new.id
      and not phonebooks_team_private.inventory_attributes_match(new.attributes, product.attributes)
  ) then
    raise sqlstate '23514' using message = 'Invalid or incompatible inventory category attributes';
  end if;
  return new;
end;
$$;
create trigger validate_inventory_category before insert or update of attributes on phonebooks_team_private.inventory_categories
  for each row execute function phonebooks_team_private.validate_inventory_category();

create function phonebooks_team_private.validate_inventory_product() returns trigger
language plpgsql set search_path = '' as $$
declare
  definitions jsonb;
begin
  select attributes into strict definitions from phonebooks_team_private.inventory_categories
    where workspace_id = new.workspace_id and id = new.category_id for share;
  if jsonb_typeof(new.attributes) <> 'object' or not phonebooks_team_private.inventory_attributes_match(definitions, new.attributes) then
    raise sqlstate '23514' using message = 'Product attributes do not match category';
  end if;
  return new;
exception when no_data_found then
  raise sqlstate '23503' using message = 'Workspace category does not exist';
end;
$$;
create trigger validate_inventory_product before insert or update of category_id, attributes on phonebooks_team_private.inventory_products
  for each row execute function phonebooks_team_private.validate_inventory_product();

create table phonebooks_team_private.inventory_accounts (
  workspace_id uuid not null references phonebooks_team_private.workspaces(id) on delete restrict,
  id text not null check (char_length(id) > 0),
  name text not null check (char_length(btrim(name)) > 0),
  opening_balance_minor bigint not null default 0,
  version integer not null default 1 check (version > 0),
  archived_at timestamptz,
  primary key (workspace_id, id)
);

create table phonebooks_team_private.inventory_operations (
  workspace_id uuid not null,
  id text not null check (char_length(id) > 0),
  actor_id uuid not null,
  request_id uuid not null,
  request_payload jsonb not null,
  type text not null check (type in ('purchase','sale','expense','repair','customer_return','supplier_return',
    'reservation','stock_adjustment','transfer','deposit','withdrawal')),
  status text not null check (status in ('posted', 'cancelled')),
  occurred_on date not null,
  related_id text,
  group_id text,
  revenue_minor bigint not null default 0,
  cost_minor bigint not null default 0,
  expense_minor bigint not null default 0,
  recorded_at timestamptz not null default statement_timestamp(),
  document_version integer not null default 1 check (document_version = 1),
  allows_postings boolean generated always as (status = 'posted' and type <> 'reservation') stored,
  primary key (workspace_id, id),
  unique (workspace_id, request_id),
  unique (workspace_id, id, allows_postings),
  foreign key (workspace_id, actor_id) references phonebooks_team_private.memberships(workspace_id, user_id),
  foreign key (workspace_id, related_id) references phonebooks_team_private.inventory_operations(workspace_id, id),
  check (related_id is null or related_id <> id),
  check (type not in ('customer_return', 'supplier_return') or related_id is not null),
  check (allows_postings or (revenue_minor = 0 and cost_minor = 0 and expense_minor = 0))
);
create index inventory_operations_scope_date on phonebooks_team_private.inventory_operations(workspace_id, occurred_on);
create index inventory_operations_actor_date on phonebooks_team_private.inventory_operations(workspace_id, actor_id, occurred_on);

create table phonebooks_team_private.inventory_operation_lines (
  workspace_id uuid not null,
  operation_id text not null,
  position integer not null check (position > 0),
  product_id text not null,
  tracking text not null,
  quantity integer not null check (quantity > 0),
  stock_delta integer not null default 0 check (stock_delta between -quantity and quantity),
  allocations jsonb not null default '[]' check (jsonb_typeof(allocations) = 'array'),
  primary key (workspace_id, operation_id, position),
  foreign key (workspace_id, operation_id) references phonebooks_team_private.inventory_operations(workspace_id, id),
  foreign key (workspace_id, product_id, tracking) references phonebooks_team_private.inventory_products(workspace_id, id, tracking),
  check (tracking <> 'unit' or quantity = 1)
);

create table phonebooks_team_private.inventory_postings (
  workspace_id uuid not null,
  operation_id text not null,
  account_id text not null,
  amount_minor bigint not null check (amount_minor <> 0),
  allows_postings boolean generated always as (true) stored,
  primary key (workspace_id, operation_id, account_id),
  foreign key (workspace_id, operation_id, allows_postings)
    references phonebooks_team_private.inventory_operations(workspace_id, id, allows_postings),
  foreign key (workspace_id, account_id) references phonebooks_team_private.inventory_accounts(workspace_id, id)
);

create function phonebooks_team_private.inventory_actor(p_workspace uuid) returns uuid
language plpgsql set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.session_user();
begin
  perform from phonebooks_team_private.memberships
    where workspace_id = p_workspace and user_id = actor and revoked_at is null for share;
  if not found then
    raise sqlstate 'PT403' using message = 'Active workspace membership required';
  end if;
  return actor;
end;
$$;

-- Internal primitive for typed commands. It remains inaccessible through PostgREST.
create function phonebooks_team_private.record_inventory_operation(p_workspace uuid, p_request uuid, p_document jsonb)
returns text language plpgsql set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  operation_id text := p_document->>'id';
  previous phonebooks_team_private.inventory_operations;
begin
  if p_request is null or p_document is null or jsonb_typeof(p_document) <> 'object'
    or p_document->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p_document->'lines') is distinct from 'array'
    or jsonb_typeof(p_document->'postings') is distinct from 'array'
    or p_document ? 'actorId' or p_document ? 'workspaceId' then
    raise sqlstate 'PT400' using message = 'Invalid operation document';
  end if;

  insert into phonebooks_team_private.inventory_operations(
    workspace_id, id, actor_id, request_id, request_payload, type, status, occurred_on, related_id, group_id,
    revenue_minor, cost_minor, expense_minor
  ) values (
    p_workspace, operation_id, actor, p_request, p_document, p_document->>'type', p_document->>'status',
    (p_document->>'date')::date, p_document->>'relatedId', p_document->>'groupId',
    (p_document->>'revenueMinor')::bigint, (p_document->>'costMinor')::bigint, (p_document->>'expenseMinor')::bigint
  ) on conflict do nothing;
  if not found then
    select * into previous from phonebooks_team_private.inventory_operations
      where workspace_id = p_workspace and request_id = p_request;
    if found and previous.actor_id = actor and previous.request_payload = p_document then
      return previous.id;
    end if;
    raise sqlstate 'PT409' using message = 'Operation or request ID already used';
  end if;

  if p_document->>'type' in ('customer_return', 'supplier_return') and not exists (
    select from phonebooks_team_private.inventory_operations as original
    where original.workspace_id = p_workspace and original.id = p_document->>'relatedId' and original.status = 'posted'
      and original.type = case when p_document->>'type' = 'customer_return' then 'sale' else 'purchase' end
  ) then
    raise sqlstate '23503' using message = 'Return requires an original posted purchase or sale';
  end if;
  if (p_document->>'type' = 'reservation' or p_document->>'status' = 'cancelled') and exists (
    select from jsonb_array_elements(p_document->'lines') as line
    where (line->>'stockDelta')::integer <> 0
  ) then
    raise sqlstate '23514' using message = 'Operation cannot change physical stock';
  end if;

  insert into phonebooks_team_private.inventory_operation_lines(workspace_id, operation_id, position, product_id, tracking, quantity, stock_delta, allocations)
    select p_workspace, operation_id, line.ordinality, line.value->>'productId', product.tracking,
      (line.value->>'quantity')::integer, coalesce((line.value->>'stockDelta')::integer, 0), coalesce(line.value->'allocations', '[]')
    from jsonb_array_elements(p_document->'lines') with ordinality as line(value, ordinality)
    left join phonebooks_team_private.inventory_products as product
      on product.workspace_id = p_workspace and product.id = line.value->>'productId';
  insert into phonebooks_team_private.inventory_postings(workspace_id, operation_id, account_id, amount_minor)
    select p_workspace, operation_id, posting."accountId", posting."amountMinor"
    from jsonb_to_recordset(p_document->'postings') as posting("accountId" text, "amountMinor" bigint);
  return operation_id;
end;
$$;

-- Record-level compare-and-set. Stock commands can use the same lock and version.
create function phonebooks_team_private.change_inventory_quantity(
  p_workspace uuid, p_product text, p_version integer, p_quantity integer, p_reserved integer
) returns integer language plpgsql set search_path = '' as $$
declare
  next_version integer;
begin
  perform phonebooks_team_private.inventory_actor(p_workspace);
  update phonebooks_team_private.inventory_products set
    quantity = p_quantity, reserved_quantity = p_reserved, version = version + 1
    where workspace_id = p_workspace and id = p_product and version = p_version and archived_at is null
    returning version into next_version;
  if not found then
    raise sqlstate 'PT409' using message = 'Product changed or unavailable';
  end if;
  return next_version;
end;
$$;

create view phonebooks_team_private.inventory_account_movements as
  select workspace_id, account_id, sum(amount_minor) as delta_minor
  from phonebooks_team_private.inventory_postings group by workspace_id, account_id;

create function phonebooks_team_private.inventory_totals(p_workspace uuid, p_actor uuid default null)
returns table (revenue_minor numeric, cost_minor numeric, expense_minor numeric, sales_count bigint)
language sql stable set search_path = '' as $$
  select coalesce(sum(op.revenue_minor), 0), coalesce(sum(op.cost_minor), 0), coalesce(sum(op.expense_minor), 0),
    count(distinct coalesce(op.group_id, op.id)) filter (where op.type = 'sale')
  from phonebooks_team_private.inventory_operations as op
  where op.workspace_id = p_workspace and (p_actor is null or op.actor_id = p_actor) and op.status = 'posted';
$$;

alter table phonebooks_team_private.inventory_categories enable row level security;
alter table phonebooks_team_private.inventory_products enable row level security;
alter table phonebooks_team_private.inventory_accounts enable row level security;
alter table phonebooks_team_private.inventory_operations enable row level security;
alter table phonebooks_team_private.inventory_operation_lines enable row level security;
alter table phonebooks_team_private.inventory_postings enable row level security;
revoke all on all tables in schema phonebooks_team_private from public, anon, authenticated;
revoke all on all functions in schema phonebooks_team_private from public, anon, authenticated;

commit;
