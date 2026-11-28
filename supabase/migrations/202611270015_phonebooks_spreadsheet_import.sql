begin;

update phonebooks_team_private.permission_catalog
  set available=true where id in ('data.import','data.export');

create table phonebooks_team_private.sheet_batches (
  workspace_id uuid not null references phonebooks_team_private.workspaces(id),
  id uuid not null,
  actor_id uuid not null,
  digest bytea not null,
  result jsonb not null,
  revision bigint not null,
  reverted_revision bigint,
  new_products text[] not null default '{}',
  new_categories text[] not null default '{}',
  permissions text[] not null,
  primary key (workspace_id,id),
  foreign key (workspace_id,actor_id) references phonebooks_team_private.memberships(workspace_id,user_id)
);
create table phonebooks_team_private.sheet_entries (
  workspace_id uuid not null,
  batch_id uuid not null,
  operation_id text not null,
  request_id uuid not null,
  digest bytea not null,
  document jsonb not null,
  primary key (workspace_id,operation_id),
  unique (workspace_id,digest),
  foreign key (workspace_id,batch_id) references phonebooks_team_private.sheet_batches(workspace_id,id)
);
create index sheet_entries_batch on phonebooks_team_private.sheet_entries(workspace_id,batch_id);
alter table phonebooks_team_private.sheet_batches enable row level security;
alter table phonebooks_team_private.sheet_entries enable row level security;
revoke all on phonebooks_team_private.sheet_batches,phonebooks_team_private.sheet_entries from public,anon,authenticated;

create function phonebooks_team_private.sheet_imei_valid(imei text) returns boolean
language sql immutable set search_path='' as $$
  select case when imei !~ '^[0-9]{15}$' or imei ~ '^(.)\1{14}$' then false else
    (select sum(digit*(1+i%2)-9*case when digit*(1+i%2)>9 then 1 else 0 end)%10=0
     from generate_series(0,14) i cross join lateral (select substr(imei,i+1,1)::integer digit) n) end;
$$;
revoke all on function phonebooks_team_private.sheet_imei_valid(text) from public,anon,authenticated;

create function phonebooks_team_private.sheet_import_permissions(plan jsonb) returns text[]
language sql immutable set search_path='' as $$
  select array['data.import']
    || case when jsonb_array_length(plan->'products')>0 then array['stock.read','stock.create'] else '{}' end
    || case when jsonb_array_length(plan->'categories')>0 then array['stock.categories.manage'] else '{}' end
    || case when bool_or(row->>'type'='opening') then array['stock.adjust','stock.purchase_price.read','stock.cost.read'] else '{}' end
    || case when bool_or(row->>'type'='purchase') then array['trade.purchase','finance.cash.read'] else '{}' end
    || case when bool_or(row->>'type' in ('expense','historical_expense')) then array['finance.expense','finance.history.read'] else '{}' end
    || case when bool_or(row->>'type'='expense') then array['finance.cash.read'] else '{}' end
    || case when bool_or(row->>'type'='historical_sale') then array['trade.sale','finance.history.read'] else '{}' end
  from jsonb_array_elements(plan->'rows') row;
$$;
revoke all on function phonebooks_team_private.sheet_import_permissions(jsonb) from public,anon,authenticated;

create function phonebooks_team_private.sheet_row_digest(row_data jsonb) returns bytea
language sql immutable set search_path='' as $$
  select sha256(convert_to((case when coalesce(btrim(row_data->>'external'),'')<>'' then
      jsonb_build_array(row_data->>'type',row_data->>'productId',lower(btrim(row_data->>'external')))
    else row_data-array['sourceRow','fingerprint','accountId'] end)::text,'UTF8'));
$$;
revoke all on function phonebooks_team_private.sheet_row_digest(jsonb) from public,anon,authenticated;

create function public.phonebooks_team_sheet_check(p_workspace uuid,p_actor uuid,p_expected text,p_plan jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  actor uuid:=phonebooks_team_private.inventory_actor(p_workspace);
  duplicates jsonb;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['data.import']);
  if octet_length(p_plan::text)>8388608 or jsonb_typeof(p_plan->'rows') is distinct from 'array' or
    jsonb_typeof(p_plan->'products') is distinct from 'array' or jsonb_typeof(p_plan->'categories') is distinct from 'array' or
    jsonb_array_length(p_plan->'rows')>10000 then raise sqlstate 'PT400' using message='Invalid spreadsheet'; end if;
  perform phonebooks_team_private.require_permissions(p_workspace,actor,phonebooks_team_private.sheet_import_permissions(p_plan));
  if p_expected is distinct from (select cloud_revision::text from phonebooks_team_private.workspaces where id=p_workspace) then
    raise sqlstate 'PT409' using message='Workspace changed. Review the import again.'; end if;
  select coalesce(jsonb_agg((row->>'sourceRow')::integer),'[]') into duplicates
  from jsonb_array_elements(p_plan->'rows') row
  join phonebooks_team_private.sheet_entries entry
    on entry.workspace_id=p_workspace and entry.digest=phonebooks_team_private.sheet_row_digest(row);
  return jsonb_build_object('duplicates',duplicates);
exception when invalid_text_representation or numeric_value_out_of_range then raise sqlstate 'PT400' using message='Invalid spreadsheet';
end;
$$;
revoke all on function public.phonebooks_team_sheet_check(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_sheet_check(uuid,uuid,text,jsonb) to authenticated;

create function public.phonebooks_team_sheet_import(p_workspace uuid,p_actor uuid,p_request uuid,p_expected text,p_plan jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=phonebooks_team_private.session_user();
  revision bigint;
  digest bytea;
  saved phonebooks_team_private.sheet_batches;
  result jsonb;
  categories text[];
  products text[];
  rights text[];
  product_refs jsonb;
  posted_refs jsonb;
  failure_row integer;
  row_count integer;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.lock_team_workspace(p_workspace);
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['data.import']);
  if p_request is null or jsonb_typeof(p_plan) is distinct from 'object' or
    jsonb_typeof(p_plan->'rows') is distinct from 'array' or jsonb_typeof(p_plan->'products') is distinct from 'array' or
    jsonb_typeof(p_plan->'categories') is distinct from 'array' or octet_length(p_plan::text)>8388608
    or (p_plan-array['rows','products','categories'])<>'{}' then raise sqlstate 'PT400' using message='Invalid spreadsheet'; end if;
  row_count:=jsonb_array_length(p_plan->'rows');
  if row_count not between 1 and 10000 or jsonb_array_length(p_plan->'products')>row_count or jsonb_array_length(p_plan->'categories')>row_count then
    raise sqlstate 'PT400' using message='Invalid spreadsheet row count'; end if;

  rights:=phonebooks_team_private.sheet_import_permissions(p_plan);
  perform phonebooks_team_private.require_permissions(p_workspace,actor,rights);
  digest:=sha256(convert_to(p_plan::text,'UTF8'));
  select * into saved from phonebooks_team_private.sheet_batches batch where batch.workspace_id=p_workspace and batch.id=p_request;
  if found then
    if saved.actor_id=actor and saved.digest=digest and saved.reverted_revision is null then return saved.result||'{"replayed":true}'; end if;
    raise sqlstate 'PT409' using message='Import receipt conflicts or was reverted';
  end if;
  select cloud_revision into revision from phonebooks_team_private.workspaces where id=p_workspace;
  if p_expected is distinct from revision::text then raise sqlstate 'PT409' using message='Workspace changed. Review the import again.'; end if;
  revision:=revision+1;

  select min(coalesce((row->>'sourceRow')::integer,0)) into failure_row from jsonb_array_elements(p_plan->'rows') row
  where jsonb_typeof(row) is distinct from 'object' or
    row-array['type','name','date','productId','quantity','amountMinor','costMinor','accountId','external','sourceRow','fingerprint']<>'{}'
    or coalesce(row->>'type','') not in ('opening','purchase','historical_sale','historical_expense','expense')
    or coalesce(char_length(btrim(row->>'name')),0) not between 1 and 100
    or coalesce(row->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or (row->>'date')::date not between date '1900-01-01' and current_date
    or jsonb_typeof(row->'quantity') is distinct from 'number' or coalesce(row->>'quantity','') !~ '^\d+$'
    or (row->>'quantity')::integer not between case when row->>'type' in ('expense','historical_expense') then 0 else 1 end and
      case when row->>'type' in ('expense','historical_expense') then 0 else 100000 end
    or jsonb_typeof(row->'amountMinor') is distinct from 'number' or coalesce(row->>'amountMinor','') !~ '^\d+$'
    or (row->>'amountMinor')::bigint not between 0 and 9000000000000
    or (row->>'type' in ('expense','historical_expense') and (row->>'amountMinor')::bigint=0)
    or jsonb_typeof(row->'costMinor') is distinct from 'number' or coalesce(row->>'costMinor','') !~ '^\d+$'
    or (row->>'costMinor')::bigint not between 0 and case when row->>'type'='historical_sale' then 9000000000000 else 0 end
    or coalesce(char_length(row->>'external'),0)>100
    or ((row->>'type' in ('purchase','expense')) is distinct from (row->>'accountId' is not null))
    or ((row->>'type' in ('purchase','opening','historical_sale')) is distinct from (row->>'productId' is not null));
  if failure_row is not null then raise sqlstate 'PT400' using message='Строка '||failure_row||': неверные поля операции.'; end if;

  select coalesce(jsonb_object_agg(id,true),'{}') into posted_refs
    from (select distinct row->>'productId' id from jsonb_array_elements(p_plan->'rows') row where row->>'productId' is not null) refs;

  if exists (
    select from jsonb_array_elements(p_plan->'categories') category
    where jsonb_typeof(category) is distinct from 'object' or category-array['id','name','attributes']<>'{}'
      or coalesce(category->>'id','') !~ '^sheet_[a-f0-9]{64}$' or coalesce(char_length(btrim(category->>'name')),0) not between 1 and 100
      or jsonb_typeof(category->'attributes') is distinct from 'array' or jsonb_array_length(category->'attributes')>80
  ) or exists (
    select from jsonb_array_elements(p_plan->'products') product
    where jsonb_typeof(product) is distinct from 'object' or product-array['id','name','categoryId','tracking','attributes']<>'{}'
      or coalesce(product->>'id','') !~ '^product:sheet_[a-f0-9]{64}$'
      or coalesce(char_length(btrim(product->>'name')),0) not between 1 and 100
      or coalesce(product->>'tracking','') not in ('unit','quantity')
      or jsonb_typeof(product->'attributes') is distinct from 'object' or coalesce(product->>'categoryId','')=''
      or (product->'attributes' ? 'imei' and (not coalesce(phonebooks_team_private.sheet_imei_valid(product->'attributes'->>'imei'),false) or product->>'tracking'<>'unit'))
      or not (posted_refs ? (product->>'id'))
  ) then raise sqlstate 'PT400' using message='Invalid spreadsheet products or categories'; end if;
  select coalesce(jsonb_object_agg(product->>'id',true),'{}') into product_refs from jsonb_array_elements(p_plan->'products') product;
  if product_refs<>posted_refs then raise sqlstate 'PT400' using message='Spreadsheet product reference is missing'; end if;

  if exists (
    select from jsonb_array_elements(p_plan->'products') product
    join phonebooks_team_private.inventory_products before on before.workspace_id=p_workspace and before.id=product->>'id'
    where before.archived_at is not null or before.name<>product->>'name' or before.tracking<>product->>'tracking'
      or before.category_id<>product->>'categoryId' or not (before.attributes @> (product->'attributes'))
  ) or exists (
    select from jsonb_array_elements(p_plan->'products') product
    join phonebooks_team_private.inventory_products before on before.workspace_id=p_workspace
      and before.attributes->>'imei'=product->'attributes'->>'imei' and before.id<>product->>'id'
  ) or exists (
    select product->'attributes'->>'imei' from jsonb_array_elements(p_plan->'products') product
    where product->'attributes' ? 'imei' group by 1 having count(*)>1
  ) then raise sqlstate 'PT409' using message='Найдена конфликтующая карточка товара или повторный IMEI.'; end if;
  if exists (
    select from jsonb_array_elements(p_plan->'categories') category
    join phonebooks_team_private.inventory_categories before on before.workspace_id=p_workspace and before.id=category->>'id'
    where before.name<>category->>'name' or not (before.attributes @> (category->'attributes'))
  ) then raise sqlstate 'PT409' using message='Найдена категория с другой схемой характеристик.'; end if;

  select coalesce(array_agg(category->>'id'),'{}') into categories from jsonb_array_elements(p_plan->'categories') category
    where not exists(select from phonebooks_team_private.inventory_categories before where before.workspace_id=p_workspace and before.id=category->>'id');
  select coalesce(array_agg(product->>'id'),'{}') into products from jsonb_array_elements(p_plan->'products') product
    where not exists(select from phonebooks_team_private.inventory_products before where before.workspace_id=p_workspace and before.id=product->>'id');
  insert into phonebooks_team_private.inventory_categories(workspace_id,id,name,attributes,cloud_revision)
    select p_workspace,category->>'id',category->>'name',category->'attributes',revision
    from jsonb_array_elements(p_plan->'categories') category where category->>'id'=any(categories);
  insert into phonebooks_team_private.inventory_products(workspace_id,id,category_id,name,tracking,attributes,cloud_revision)
    select p_workspace,product->>'id',product->>'categoryId',product->>'name',product->>'tracking',product->'attributes',revision
    from jsonb_array_elements(p_plan->'products') product where product->>'id'=any(products);

  select min((row->>'sourceRow')::integer) into failure_row from jsonb_array_elements(p_plan->'rows') row
  left join phonebooks_team_private.inventory_products product on product.workspace_id=p_workspace and product.id=row->>'productId'
  where row->>'productId' is not null and (product.id is null or product.archived_at is not null or
    (product.tracking='unit' and (row->>'quantity')::integer<>1) or
    (row->>'type' in ('opening','purchase') and (product.in_repair or product.name<>row->>'name')));
  if failure_row is not null then raise sqlstate 'PT409' using message='Строка '||failure_row||': карточка или остаток изменились.'; end if;

  if exists (
    select from (select row->>'accountId' id,sum((row->>'amountMinor')::bigint) amount
      from jsonb_array_elements(p_plan->'rows') row where row->>'accountId' is not null group by 1) totals
    left join phonebooks_team_private.inventory_accounts account on account.workspace_id=p_workspace and account.id=totals.id
    left join phonebooks_team_private.inventory_account_movements move on move.workspace_id=p_workspace and move.account_id=totals.id
    where account.id is null or account.archived_at is not null or account.opening_balance_minor+coalesce(move.delta_minor,0)<totals.amount
  ) then raise sqlstate 'PT409' using message='Счёт недоступен или средств для импорта недостаточно.'; end if;

  result:=jsonb_build_object('id',p_request,'revision',revision::text,'rows',row_count,'replayed',false);
  insert into phonebooks_team_private.sheet_batches(workspace_id,id,actor_id,digest,result,revision,new_products,new_categories,permissions)
    values(p_workspace,p_request,actor,digest,result,revision,products,categories,rights);
  insert into phonebooks_team_private.sheet_entries(workspace_id,batch_id,operation_id,request_id,digest,document)
    select p_workspace,p_request,'sheet:'||p_request||':'||position,gen_random_uuid(),
      phonebooks_team_private.sheet_row_digest(row),row
    from jsonb_array_elements(p_plan->'rows') with ordinality rows(row,position);

  if exists (
    select from phonebooks_team_private.inventory_products product
    join (select document->>'productId' id,sum((document->>'quantity')::integer) units
      from phonebooks_team_private.sheet_entries where workspace_id=p_workspace and batch_id=p_request
        and document->>'type' in ('opening','purchase') group by 1) totals on totals.id=product.id
    where product.workspace_id=p_workspace and
      ((product.tracking='unit' and (totals.units<>1 or product.quantity<>0 or exists(
        select from phonebooks_team_private.inventory_operation_lines line
        where line.workspace_id=p_workspace and line.product_id=product.id and line.stock_delta<>0))) or
        product.quantity+totals.units>2147483647)
  ) then raise sqlstate 'PT409' using message='Импорт превышает допустимый остаток или повторяет поштучную закупку.'; end if;

  insert into phonebooks_team_private.inventory_operations(workspace_id,id,actor_id,request_id,request_payload,type,status,
    occurred_on,group_id,revenue_minor,cost_minor,expense_minor,cloud_revision,historical)
  select p_workspace,operation_id,actor,request_id,
    jsonb_build_object('sheetType',document->>'type','name',document->>'name','external',document->>'external',
      'lines',jsonb_build_array(jsonb_build_object('productId',document->>'productId')),
      'postings',case when document->>'accountId' is not null then jsonb_build_array(jsonb_build_object('amountMinor',-(document->>'amountMinor')::bigint)) else '[]'::jsonb end),
    case document->>'type' when 'opening' then 'stock_adjustment' when 'historical_sale' then 'sale'
      when 'historical_expense' then 'expense' else document->>'type' end,
    'posted',(document->>'date')::date,
    case when document->>'type'='historical_sale' and coalesce(btrim(document->>'external'),'')<>'' then
      'sheet:receipt:'||lower(btrim(document->>'external')) end,
    case when document->>'type'='historical_sale' then (document->>'amountMinor')::bigint else 0 end,
    (document->>'costMinor')::bigint,case when document->>'type' in ('expense','historical_expense') then (document->>'amountMinor')::bigint else 0 end,
    revision,document->>'type' not in ('purchase','expense')
  from phonebooks_team_private.sheet_entries where workspace_id=p_workspace and batch_id=p_request;

  insert into phonebooks_team_private.inventory_operation_lines(workspace_id,operation_id,position,product_id,tracking,quantity,stock_delta)
    select p_workspace,entry.operation_id,1,product.id,product.tracking,(entry.document->>'quantity')::integer,
      case when entry.document->>'type' in ('opening','purchase') then (entry.document->>'quantity')::integer else 0 end
    from phonebooks_team_private.sheet_entries entry join phonebooks_team_private.inventory_products product
      on product.workspace_id=p_workspace and product.id=entry.document->>'productId'
    where entry.workspace_id=p_workspace and entry.batch_id=p_request;
  insert into phonebooks_team_private.stock_lots(workspace_id,product_id,id,acquired_revision,quantity,cost_minor,origin_purchase)
    select p_workspace,document->>'productId',operation_id,revision,(document->>'quantity')::integer,(document->>'amountMinor')::bigint,
      case when document->>'type'='purchase' then operation_id end
    from phonebooks_team_private.sheet_entries
    where workspace_id=p_workspace and batch_id=p_request and document->>'type' in ('opening','purchase');
  update phonebooks_team_private.inventory_products product set quantity=product.quantity+totals.units,version=version+1,cloud_revision=revision
    from (select document->>'productId' id,sum((document->>'quantity')::integer)::integer units
      from phonebooks_team_private.sheet_entries where workspace_id=p_workspace and batch_id=p_request
        and document->>'type' in ('opening','purchase') group by 1) totals
    where product.workspace_id=p_workspace and product.id=totals.id;
  insert into phonebooks_team_private.inventory_postings(workspace_id,operation_id,account_id,amount_minor)
    select p_workspace,operation_id,document->>'accountId',-(document->>'amountMinor')::bigint
    from phonebooks_team_private.sheet_entries where workspace_id=p_workspace and batch_id=p_request
      and document->>'accountId' is not null and (document->>'amountMinor')::bigint>0;
  update phonebooks_team_private.inventory_accounts account set cloud_revision=revision,version=version+1
    where account.workspace_id=p_workspace and exists (
      select from phonebooks_team_private.sheet_entries entry where entry.workspace_id=p_workspace and entry.batch_id=p_request
        and entry.document->>'accountId'=account.id);
  update phonebooks_team_private.workspaces set cloud_revision=revision where id=p_workspace;
  insert into phonebooks_team_private.team_audit(workspace_id,actor_id,target_id,kind,current_values,owner_details)
    values(p_workspace,actor,p_request::text,'sheet.import',jsonb_build_object('rows',row_count),true);
  return result;
exception when unique_violation then raise sqlstate 'PT409' using message='В таблице есть повторная операция или карточка.';
  when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation or numeric_value_out_of_range
    or invalid_datetime_format or datetime_field_overflow then raise sqlstate 'PT400' using message='Недопустимые данные таблицы.';
end;
$$;
revoke all on function public.phonebooks_team_sheet_import(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_sheet_import(uuid,uuid,uuid,text,jsonb) to authenticated;

commit;
