begin;

create table phonebooks_team_private.permission_catalog (
  id text primary key,
  section text not null,
  label text not null,
  available boolean not null default false
);
insert into phonebooks_team_private.permission_catalog values
  ('stock.read','Склад','Просмотр товаров',true),
  ('stock.create','Склад','Добавление товаров',true),
  ('stock.edit','Склад','Редактирование товаров',false),
  ('stock.purchase_price.read','Склад','Просмотр закупочных цен',true),
  ('stock.cost.read','Склад','Просмотр себестоимости',true),
  ('stock.planned_price.write','Склад','Изменение планируемых цен продажи',false),
  ('stock.categories.manage','Склад','Управление категориями',false),
  ('stock.bulk_edit','Склад','Массовое редактирование',false),
  ('stock.adjust','Склад','Корректировка остатков',true),
  ('stock.writeoff','Склад','Списание товаров',true),
  ('trade.purchase','Торговые операции','Оформление закупок',true),
  ('trade.sale','Торговые операции','Оформление продаж',true),
  ('trade.reserve','Торговые операции','Бронирование товаров',false),
  ('trade.reserve_cancel','Торговые операции','Отмена бронирования',false),
  ('trade.customer_return','Торговые операции','Возвраты покупателей',false),
  ('trade.supplier_return','Торговые операции','Возвраты поставщикам',false),
  ('trade.compensation','Торговые операции','Частичные компенсации',false),
  ('repair.start','Ремонт','Отправка товара в ремонт',false),
  ('repair.finish','Ремонт','Завершение ремонта',true),
  ('repair.expense','Ремонт','Добавление расходов на ремонт',true),
  ('repair.cost.read','Ремонт','Просмотр стоимости ремонта',true),
  ('finance.cash.read','Финансы','Просмотр кассы',true),
  ('finance.revenue.read','Финансы','Просмотр выручки',true),
  ('finance.profit.read','Финансы','Просмотр прибыли',true),
  ('finance.history.read','Финансы','Просмотр финансовой истории',true),
  ('finance.expense','Финансы','Добавление расходов',true),
  ('finance.deposit','Финансы','Пополнение кассы',true),
  ('finance.adjust','Финансы','Финансовые корректировки',false),
  ('analytics.company','Аналитика','Общая статистика предприятия',true),
  ('analytics.self','Аналитика','Собственная статистика',true),
  ('analytics.others','Аналитика','Статистика других сотрудников',true),
  ('analytics.categories','Аналитика','Аналитика по категориям',false),
  ('analytics.aging','Аналитика','Залежавшиеся товары',false),
  ('data.import','Данные','Импорт Excel/CSV',false),
  ('data.export','Данные','Экспорт Excel/CSV',false),
  ('data.backup','Данные','Создание резервных копий',false),
  ('data.solo_transfer','Данные','Перенос Solo в Team',true),
  ('team.members.read','Управление командой','Просмотр списка сотрудников',true),
  ('team.invite','Управление командой','Приглашение сотрудников',true),
  ('team.audit.read','Управление командой','Просмотр журнала действий',true),
  ('team.members.manage','Управление командой','Отзыв и восстановление ограниченного доступа',true);

create table phonebooks_team_private.team_roles (
  workspace_id uuid not null references phonebooks_team_private.workspaces(id),
  id text not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  grants text[] not null,
  revision integer not null default 1,
  archived_at timestamptz,
  primary key (workspace_id, id)
);
create unique index team_roles_name on phonebooks_team_private.team_roles(workspace_id, lower(name)) where archived_at is null;

create function phonebooks_team_private.seed_team_roles(space uuid) returns void
language sql set search_path = '' as $$
  insert into phonebooks_team_private.team_roles(workspace_id,id,name,grants) values
    (space,'manager','Управляющий',array[
      'stock.read','stock.create','stock.adjust','stock.writeoff','stock.purchase_price.read','stock.cost.read',
      'trade.purchase','trade.sale','repair.finish','repair.expense','repair.cost.read','finance.cash.read',
      'finance.revenue.read','finance.profit.read','finance.history.read','finance.expense','finance.deposit',
      'analytics.company','analytics.self','analytics.others','team.members.read','team.audit.read'
    ]),
    (space,'employee','Сотрудник',array['stock.read','trade.sale','analytics.self'])
  on conflict (workspace_id,id) do nothing;
$$;

create function phonebooks_team_private.init_team_roles() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform phonebooks_team_private.seed_team_roles(new.id);
  return new;
end;
$$;
create trigger init_team_roles after insert on phonebooks_team_private.workspaces
  for each row execute function phonebooks_team_private.init_team_roles();
select phonebooks_team_private.seed_team_roles(id) from phonebooks_team_private.workspaces;

alter table phonebooks_team_private.memberships add role_id text;
alter table phonebooks_team_private.memberships add access_revision integer not null default 1;
alter table phonebooks_team_private.memberships add foreign key (workspace_id,role_id) references phonebooks_team_private.team_roles(workspace_id,id);
alter table phonebooks_team_private.memberships add check (role <> 'owner' or role_id is null);
alter table phonebooks_team_private.invitations add role_id text;
alter table phonebooks_team_private.invitations add foreign key (workspace_id,role_id) references phonebooks_team_private.team_roles(workspace_id,id);

create table phonebooks_team_private.member_overrides (
  workspace_id uuid not null,
  user_id uuid not null,
  permission text not null references phonebooks_team_private.permission_catalog(id),
  allowed boolean not null,
  primary key (workspace_id,user_id,permission),
  foreign key (workspace_id,user_id) references phonebooks_team_private.memberships(workspace_id,user_id)
);

create or replace function phonebooks_team_private.inventory_actor(p_workspace uuid) returns uuid
language plpgsql stable set search_path = '' as $$
declare actor uuid := phonebooks_team_private.session_user();
begin
  if not exists (select from phonebooks_team_private.memberships
    where workspace_id = p_workspace and user_id = actor and revoked_at is null) then
    raise sqlstate 'PT403' using message = 'Active workspace membership required';
  end if;
  return actor;
end;
$$;

create function phonebooks_team_private.team_permissions(space uuid, member_id uuid, include_revoked boolean default false) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(permission.id order by permission.id), '{}'::text[])
  from phonebooks_team_private.memberships member
  cross join phonebooks_team_private.permission_catalog permission
  left join phonebooks_team_private.team_roles assigned
    on assigned.workspace_id=space and assigned.id=coalesce(member.role_id,member.role) and assigned.archived_at is null
  left join phonebooks_team_private.member_overrides override
    on override.workspace_id=space and override.user_id=member_id and override.permission=permission.id
  where member.workspace_id=space and member.user_id=member_id and (include_revoked or member.revoked_at is null)
    and (member.role='owner' or coalesce(override.allowed, permission.id=any(assigned.grants), false));
$$;

create function phonebooks_team_private.require_permissions(space uuid, actor uuid, permissions text[]) returns void
language plpgsql stable set search_path = '' as $$
begin
  if not (permissions <@ phonebooks_team_private.team_permissions(space,actor)) then
    raise sqlstate 'PT403' using message = 'Required permission denied';
  end if;
end;
$$;

create function phonebooks_team_private.lock_team_workspace(space uuid) returns void
language sql set search_path = '' as $$
  select from phonebooks_team_private.workspaces where id=space for update;
$$;

create function public.phonebooks_team_access(p_workspace uuid, p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  permissions text[] := phonebooks_team_private.team_permissions(p_workspace,actor);
  owner_access boolean;
  role_name text;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  select member.role='owner',coalesce(role.name,'Владелец') into owner_access,role_name
    from phonebooks_team_private.memberships member
    left join phonebooks_team_private.team_roles role on role.workspace_id=member.workspace_id and role.id=coalesce(member.role_id,member.role)
    where member.workspace_id=p_workspace and member.user_id=actor;
  return jsonb_build_object('permissions',permissions,'owner',owner_access,'roleName',role_name,
    'inviteRoles',case when 'team.invite'=any(permissions) then (
      select coalesce(jsonb_agg(jsonb_build_object('id',role.id,'name',role.name) order by role.name),'[]')
      from phonebooks_team_private.team_roles role where role.workspace_id=p_workspace and role.archived_at is null
        and (owner_access or (role.grants <@ permissions and not (role.grants && array['team.members.manage','team.invite','data.solo_transfer'])))
    ) else '[]'::jsonb end);
end;
$$;

create function public.phonebooks_team_members(p_workspace uuid, p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  owner_access boolean;
  permissions text[];
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  select role='owner' into owner_access from phonebooks_team_private.memberships where workspace_id=p_workspace and user_id=actor;
  permissions := phonebooks_team_private.team_permissions(p_workspace,actor);
  return jsonb_build_object(
    'permissions',permissions,'owner',owner_access,
    'catalog',case when owner_access then (
      select jsonb_agg(to_jsonb(permission) order by permission.section,permission.id)
      from phonebooks_team_private.permission_catalog permission where permission.available
    ) else '[]'::jsonb end,
    'roles',case when owner_access or 'team.invite'=any(permissions) then (
      select coalesce(jsonb_agg(jsonb_build_object('id',role.id,'name',role.name,'grants',
        case when owner_access then role.grants end,'revision',role.revision,'archived',role.archived_at is not null)
        order by role.name),'[]')
      from phonebooks_team_private.team_roles role where role.workspace_id=p_workspace
        and (owner_access or (role.archived_at is null and role.grants <@ permissions
          and not (role.grants && array['team.members.manage','team.invite'])))
    ) else '[]'::jsonb end,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object('id',member.user_id,'email',account.email,
        'roleId',coalesce(member.role_id,member.role),'roleName',coalesce(role.name,'Владелец'),
        'revoked',member.revoked_at is not null,'joinedAt',member.joined_at,'revision',member.access_revision,
        'overrides',case when owner_access then (
          select coalesce(jsonb_object_agg(override.permission,override.allowed),'{}')
          from phonebooks_team_private.member_overrides override
          where override.workspace_id=p_workspace and override.user_id=member.user_id
        ) end,
        'permissions',case when owner_access or member.user_id=actor
          then phonebooks_team_private.team_permissions(p_workspace,member.user_id,true) end)
        order by member.revoked_at nulls first,account.email),'[]')
      from phonebooks_team_private.memberships member
      join auth.users account on account.id=member.user_id
      left join phonebooks_team_private.team_roles role on role.workspace_id=p_workspace and role.id=coalesce(member.role_id,member.role)
      where member.workspace_id=p_workspace and (member.user_id=actor or 'team.members.read'=any(permissions))
    )
  );
end;
$$;

create function public.phonebooks_team_manage(p_workspace uuid,p_actor uuid,p_action text,p_input jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  owner_access boolean;
  role_key text := p_input->>'roleId';
  role_name text := btrim(p_input->>'name');
  role_data phonebooks_team_private.team_roles;
  assigned text[];
  target uuid;
  member phonebooks_team_private.memberships;
  rules jsonb;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message = 'Account changed'; end if;
  perform phonebooks_team_private.lock_team_workspace(p_workspace);
  perform phonebooks_team_private.inventory_actor(p_workspace);
  select role='owner' into owner_access from phonebooks_team_private.memberships where workspace_id=p_workspace and user_id=actor;
  if p_action in ('save_role','archive_role','set_member') and not owner_access then
    raise sqlstate 'PT403' using message = 'Workspace owner access required';
  end if;
  if jsonb_typeof(p_input) is distinct from 'object' or p_action is null then
    raise sqlstate 'PT400' using message = 'Invalid team request';
  end if;

  if p_action = 'save_role' then
    if not (role_key in ('manager','employee') or role_key ~ '^custom:[a-f0-9-]{36}$') or role_key is null
      or role_name is null or char_length(role_name) not between 1 and 80
      or jsonb_typeof(p_input->'grants') is distinct from 'array'
      or exists (select from jsonb_array_elements(p_input->'grants') grant_item where jsonb_typeof(grant_item) <> 'string'
        or not exists(select from phonebooks_team_private.permission_catalog where id=grant_item#>>'{}')) then
      raise sqlstate 'PT400' using message = 'Invalid role';
    end if;
    select coalesce(array_agg(distinct value order by value),'{}') into assigned from jsonb_array_elements_text(p_input->'grants');
    select * into role_data from phonebooks_team_private.team_roles where workspace_id=p_workspace and id=role_key;
    if found then
      if role_data.archived_at is not null or role_data.revision is distinct from (p_input->>'revision')::integer then
        raise sqlstate 'PT409' using message = 'Role has changed';
      end if;
      update phonebooks_team_private.team_roles set name=role_name,grants=assigned,revision=revision+1
        where workspace_id=p_workspace and id=role_key;
    else
      if (p_input->>'revision')::integer is distinct from 0 then raise sqlstate 'PT409' using message = 'Role has changed'; end if;
      insert into phonebooks_team_private.team_roles(workspace_id,id,name,grants) values(p_workspace,role_key,role_name,assigned);
    end if;
    return true;
  end if;

  if p_action='archive_role' then
    if role_key is null or role_key not like 'custom:%' then raise sqlstate 'PT400' using message = 'Template is protected'; end if;
    if exists(select from phonebooks_team_private.memberships where workspace_id=p_workspace and role_id=role_key)
      or exists(select from phonebooks_team_private.invitations where workspace_id=p_workspace and role_id=role_key
        and revoked_at is null and accepted_by is null and expires_at > clock_timestamp()) then
      raise sqlstate 'PT409' using message = 'Reassign members and pending invitations first';
    end if;
    update phonebooks_team_private.team_roles set archived_at=clock_timestamp(),revision=revision+1
      where workspace_id=p_workspace and id=role_key and archived_at is null and revision=(p_input->>'revision')::integer;
    if not found then raise sqlstate 'PT409' using message = 'Role has changed'; end if;
    return true;
  end if;

  if p_action not in ('set_member','revoke_member','restore_member') then
    raise sqlstate 'PT400' using message = 'Invalid team action';
  end if;
  target := (p_input->>'userId')::uuid;
  select * into member from phonebooks_team_private.memberships where workspace_id=p_workspace and user_id=target;
  if not found or target=actor or member.role='owner' then raise sqlstate 'PT403' using message = 'Member is protected or unavailable'; end if;
  if member.access_revision is distinct from (p_input->>'revision')::integer then raise sqlstate 'PT409' using message = 'Member has changed'; end if;
  if not owner_access then
    perform phonebooks_team_private.require_permissions(p_workspace,actor,array['team.members.manage']);
    assigned := phonebooks_team_private.team_permissions(p_workspace,target,true);
    if not (assigned <@ phonebooks_team_private.team_permissions(p_workspace,actor))
      or assigned && array['team.members.manage','team.invite','data.solo_transfer'] then
      raise sqlstate 'PT403' using message = 'Target is outside delegated authority';
    end if;
  end if;
  if p_action='set_member' then
    rules := p_input->'overrides';
    if not exists(select from phonebooks_team_private.team_roles where workspace_id=p_workspace and id=role_key and archived_at is null)
      or jsonb_typeof(rules) is distinct from 'object'
      or exists(select from jsonb_each(rules) where jsonb_typeof(value)<>'boolean'
        or not exists(select from phonebooks_team_private.permission_catalog where id=key)) then
      raise sqlstate 'PT400' using message = 'Invalid role or override';
    end if;
    delete from phonebooks_team_private.member_overrides
      where workspace_id=p_workspace and user_id=target and not (rules ? permission);
    insert into phonebooks_team_private.member_overrides(workspace_id,user_id,permission,allowed)
      select p_workspace,target,key,value::boolean from jsonb_each(rules)
      on conflict (workspace_id,user_id,permission) do update set allowed=excluded.allowed
      where member_overrides.allowed is distinct from excluded.allowed;
    update phonebooks_team_private.memberships set role_id=role_key,access_revision=access_revision+1
      where workspace_id=p_workspace and user_id=target;
  else
    update phonebooks_team_private.memberships
      set revoked_at=case when p_action='revoke_member' then coalesce(revoked_at,clock_timestamp()) end,
        access_revision=access_revision+1 where workspace_id=p_workspace and user_id=target;
  end if;
  return true;
exception when invalid_text_representation or unique_violation or check_violation then
  raise sqlstate 'PT400' using message = 'Invalid or duplicate team data';
end;
$$;

alter table phonebooks_team_private.permission_catalog enable row level security;
alter table phonebooks_team_private.team_roles enable row level security;
alter table phonebooks_team_private.member_overrides enable row level security;
revoke all on phonebooks_team_private.permission_catalog,phonebooks_team_private.team_roles,phonebooks_team_private.member_overrides
  from public,anon,authenticated;
revoke all on all functions in schema phonebooks_team_private from public,anon,authenticated;
revoke all on function public.phonebooks_team_access(uuid,uuid),public.phonebooks_team_members(uuid,uuid),
  public.phonebooks_team_manage(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_access(uuid,uuid),public.phonebooks_team_members(uuid,uuid),
  public.phonebooks_team_manage(uuid,uuid,text,jsonb) to authenticated;

commit;
