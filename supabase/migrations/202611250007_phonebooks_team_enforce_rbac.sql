begin;

create index inventory_operation_lines_by_product
  on phonebooks_team_private.inventory_operation_lines(workspace_id,product_id,operation_id);

create function phonebooks_team_private.check_invite_role(space uuid, actor uuid, role_key text) returns void
language plpgsql stable set search_path = '' as $$
declare
  permissions text[] := phonebooks_team_private.team_permissions(space,actor);
  assigned text[];
begin
  if not ('team.invite'=any(permissions)) then raise sqlstate 'PT403' using message = 'Invitation denied'; end if;
  select grants into assigned from phonebooks_team_private.team_roles where workspace_id=space and id=role_key and archived_at is null;
  if not found then raise sqlstate 'PT400' using message = 'Unknown invitation role'; end if;
  if not exists(select from phonebooks_team_private.memberships where workspace_id=space and user_id=actor and role='owner')
    and (not (assigned <@ permissions) or assigned && array['team.members.manage','team.invite','data.solo_transfer']) then
    raise sqlstate 'PT403' using message = 'Role is outside delegated authority';
  end if;
end;
$$;

create or replace function public.phonebooks_team_cloud_command(p_workspace uuid, p_actor uuid, p_request uuid, p_command jsonb)
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
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  if p_request is null or jsonb_typeof(p_command) is distinct from 'object' or kind is null
    or kind not in ('purchase','sale','repair','expense','stock_adjustment','deposit')
    or p_command - array['type','productId','expectedVersion','accountId','quantity','unitPriceMinor','amountMinor',
      'name','categoryId','tracking','attributes'] <> '{}'::jsonb then
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

create or replace function public.phonebooks_team_cloud_feed(p_workspace uuid, p_actor uuid, p_cursor bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.session_user();
  member_role text;
  revision bigint;
  permissions text[];
  balances boolean;
  stock boolean;
  history boolean;
  sale_totals boolean;
  costs boolean;
  stock_cost boolean;
begin
  if p_actor is distinct from actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  select membership.role, workspace.cloud_revision into member_role, revision
    from phonebooks_team_private.memberships as membership
    join phonebooks_team_private.workspaces as workspace on workspace.id = membership.workspace_id
    where membership.user_id = actor and membership.workspace_id = p_workspace and membership.revoked_at is null;
  if not found then raise sqlstate 'PT403' using message = 'Active workspace membership required'; end if;
  if p_cursor is not null and p_cursor not between 0 and revision then raise sqlstate 'PT409' using message = 'Invalid revision'; end if;
  permissions := phonebooks_team_private.team_permissions(p_workspace,actor);
  balances := 'finance.cash.read'=any(permissions);
  stock := 'stock.read'=any(permissions);
  history := 'finance.history.read'=any(permissions);
  sale_totals := 'analytics.company'=any(permissions) and 'finance.revenue.read'=any(permissions);
  costs := array['stock.purchase_price.read','stock.cost.read','repair.cost.read','finance.profit.read'] <@ permissions;
  stock_cost := array['stock.purchase_price.read','stock.cost.read','repair.cost.read'] <@ permissions;
  return jsonb_build_object(
    'role',member_role,'cursor',revision::text,'permissions',permissions,
    'categories',(
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'attributes',attributes) order by name),'[]')
      from phonebooks_team_private.inventory_categories where stock and workspace_id = p_workspace and cloud_revision > coalesce(p_cursor,-1)),
    'products',(
      select coalesce(jsonb_agg(jsonb_build_object('id',product.id,'name',product.name,'categoryId',category_id,'tracking',product.tracking,
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
      from phonebooks_team_private.inventory_products product
      where stock and product.workspace_id=p_workspace and product.cloud_revision > coalesce(p_cursor,-1)
    ),
    'accounts',(
      select coalesce(jsonb_agg(
        jsonb_build_object('id',account.id,'name',account.name,'archived',account.archived_at is not null) ||
        case when balances then jsonb_build_object('balanceMinor',(account.opening_balance_minor + coalesce(movement.delta_minor,0))::text) else '{}' end
        order by account.id),'[]')
      from phonebooks_team_private.inventory_accounts as account
      left join phonebooks_team_private.inventory_account_movements as movement
        on movement.workspace_id = account.workspace_id and movement.account_id = account.id and balances
      where (balances or permissions && array['trade.sale','trade.purchase','repair.expense','finance.expense','finance.deposit'])
        and account.workspace_id = p_workspace and account.cloud_revision > coalesce(p_cursor,-1)
    ),
    'totals',case when sale_totals then (
      select jsonb_build_object('revenue_minor',totals.revenue_minor,'sales_count',totals.sales_count)
        || case when costs then jsonb_build_object('cost_minor',totals.cost_minor) else '{}' end
        || case when costs and history then jsonb_build_object('expense_minor',totals.expense_minor) else '{}' end
      from phonebooks_team_private.inventory_totals(p_workspace) as totals
    ) else null end,
    'operations',case when history then (
      select coalesce(jsonb_agg(jsonb_build_object('id',id,'type',type,'actorId',case when not historical then actor_id end,
        'date',occurred_on,'status',status) order by cloud_revision,id),'[]')
      from phonebooks_team_private.inventory_operations where workspace_id = p_workspace and cloud_revision > coalesce(p_cursor,-1)
    ) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.phonebooks_team_create_invitation(p_workspace_id uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
  recipient text := lower(btrim(p_email));
  existing phonebooks_team_private.invitations;
  invitation_id uuid;
begin
  perform phonebooks_team_private.inventory_actor(p_workspace_id);
  perform phonebooks_team_private.lock_team_workspace(p_workspace_id);
  perform phonebooks_team_private.check_invite_role(p_workspace_id,actor_id,p_role);
  if recipient is null or char_length(recipient) > 254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role is null then
    raise sqlstate 'PT400' using message = 'Invalid recipient or role';
  end if;
   select * into existing from phonebooks_team_private.invitations
    where workspace_id = p_workspace_id and email = recipient
      and revoked_at is null and accepted_by is null and expires_at > clock_timestamp();
  if found then
    if coalesce(existing.role_id,existing.role) <> p_role then
      raise sqlstate 'PT409' using message = 'An active invitation already exists with a different role';
    end if;
    return existing.id;
  end if;
  insert into phonebooks_team_private.invitations(workspace_id, email, role, role_id, created_by)
    values (p_workspace_id, recipient, case when p_role='manager' then 'manager' else 'employee' end, p_role, actor_id)
    returning id into invitation_id;
  return invitation_id;
end;
$$;

create or replace function public.phonebooks_team_outgoing_invitations(p_workspace_id uuid)
returns table (id uuid, email text, role text, expires_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
begin
  perform phonebooks_team_private.require_permissions(p_workspace_id,actor_id,array['team.invite']);
  return query
    select invite.id, invite.email, coalesce(invite.role_id,invite.role), invite.expires_at,
      case when invite.revoked_at is not null then 'revoked'
           when invite.accepted_by is not null then 'accepted'
           when invite.expires_at <= statement_timestamp() then 'expired'
           else 'pending' end
    from phonebooks_team_private.invitations as invite
    where invite.workspace_id = p_workspace_id and (invite.created_by=actor_id or exists(
      select from phonebooks_team_private.memberships as member
      where member.workspace_id=p_workspace_id and member.user_id=actor_id and member.role='owner'))
    order by invite.created_at desc, invite.id;
end;
$$;

create or replace function public.phonebooks_team_incoming_invitations()
returns table (id uuid, workspace_name text, role text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
begin
  return query
    select invite.id, workspace.name, coalesce(role.name,'Сотрудник'), invite.expires_at
    from phonebooks_team_private.invitations as invite
    join phonebooks_team_private.workspaces as workspace on workspace.id = invite.workspace_id
    left join phonebooks_team_private.team_roles role on role.workspace_id=invite.workspace_id and role.id=coalesce(invite.role_id,invite.role)
    join auth.users as account on account.id = actor_id and lower(account.email) = invite.email
    where invite.revoked_at is null and invite.accepted_by is null and invite.expires_at > statement_timestamp()
    order by invite.created_at desc, invite.id;
end;
$$;

create or replace function public.phonebooks_team_accept_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
  invitation phonebooks_team_private.invitations;
begin
  select invite.* into invitation from phonebooks_team_private.invitations as invite
    join auth.users as account on account.id = actor_id and lower(account.email) = invite.email
    where invite.id = p_invitation_id;
  if not found then
    raise sqlstate 'PT404' using message = 'Invitation not found';
  end if;
  perform phonebooks_team_private.lock_team_workspace(invitation.workspace_id);
  select * into invitation from phonebooks_team_private.invitations where id=p_invitation_id for update;
  if invitation.accepted_by = actor_id and exists (
    select from phonebooks_team_private.memberships
    where workspace_id = invitation.workspace_id and user_id = actor_id and revoked_at is null
  ) then
    return invitation.workspace_id;
  end if;
  if invitation.revoked_at is not null or invitation.accepted_by is not null or invitation.expires_at <= clock_timestamp() then
    raise sqlstate 'PT409' using message = 'Invitation is no longer active';
  end if;
  perform phonebooks_team_private.check_invite_role(invitation.workspace_id,invitation.created_by,coalesce(invitation.role_id,invitation.role));
  if exists(select from phonebooks_team_private.memberships where workspace_id=invitation.workspace_id
    and user_id=actor_id and revoked_at is not null) then
    raise sqlstate 'PT409' using message = 'Former member access must be restored explicitly';
  end if;
  insert into phonebooks_team_private.memberships(workspace_id,user_id,role,role_id)
    values(invitation.workspace_id,actor_id,invitation.role,invitation.role_id)
    on conflict (workspace_id,user_id) do nothing;
  update phonebooks_team_private.invitations set accepted_by = actor_id where id = invitation.id;
  return invitation.workspace_id;
end;
$$;

create or replace function public.phonebooks_team_revoke_invitation(p_workspace_id uuid, p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
  invitation phonebooks_team_private.invitations;
begin
  perform phonebooks_team_private.inventory_actor(p_workspace_id);
  perform phonebooks_team_private.lock_team_workspace(p_workspace_id);
  perform phonebooks_team_private.require_permissions(p_workspace_id,actor_id,array['team.invite']);
  select * into invitation from phonebooks_team_private.invitations
    where workspace_id = p_workspace_id and id = p_invitation_id
      and (created_by=actor_id or exists(select from phonebooks_team_private.memberships
        where workspace_id=p_workspace_id and user_id=actor_id and role='owner')) for update;
  if not found then
    raise sqlstate 'PT404' using message = 'Invitation not found';
  end if;
  if invitation.revoked_at is not null then
    return true;
  end if;
  if invitation.accepted_by is not null or invitation.expires_at <= clock_timestamp() then
    raise sqlstate 'PT409' using message = 'Invitation is no longer active';
  end if;
  update phonebooks_team_private.invitations set revoked_at = clock_timestamp() where id = invitation.id;
  return true;
end;
$$;

create or replace function public.phonebooks_team_overview(p_preferred uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  account jsonb := public.phonebooks_team_account();
  workspace_list jsonb;
  selected jsonb;
  incoming jsonb;
  outgoing jsonb := '[]'::jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.created_at, workspace.id), '[]'::jsonb)
    into workspace_list from public.phonebooks_team_workspaces() as workspace;
  select entry into selected from jsonb_array_elements(workspace_list) as entry where entry->>'id' = p_preferred::text;
  selected := coalesce(selected, workspace_list->0);
  select coalesce(jsonb_agg(to_jsonb(invite)), '[]'::jsonb) into incoming
    from public.phonebooks_team_incoming_invitations() as invite;
  if selected is not null then
    selected := selected || public.phonebooks_team_access((selected->>'id')::uuid,(account->>'id')::uuid);
  end if;
  if (selected->'permissions') ? 'team.invite' then
    select coalesce(jsonb_agg(to_jsonb(invite)), '[]'::jsonb) into outgoing
      from public.phonebooks_team_outgoing_invitations((selected->>'id')::uuid) as invite;
  end if;
  return jsonb_build_object('account', account, 'workspaces', workspace_list, 'selected', selected,
    'incoming', incoming, 'outgoing', outgoing);
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

revoke all on function phonebooks_team_private.check_invite_role(uuid,uuid,text) from public,anon,authenticated;

commit;
