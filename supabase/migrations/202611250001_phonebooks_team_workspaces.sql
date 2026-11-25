begin;

create schema phonebooks_team_private;
revoke all on schema phonebooks_team_private from public, anon, authenticated;

create table phonebooks_team_private.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  created_at timestamptz not null default statement_timestamp(),
  created_by uuid not null references auth.users(id) on delete restrict,
  creation_request_id uuid not null,
  creation_name text not null,
  unique (created_by, creation_request_id)
);

create table phonebooks_team_private.memberships (
  workspace_id uuid not null references phonebooks_team_private.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null check (role in ('owner', 'manager', 'employee')),
  joined_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  primary key (workspace_id, user_id)
);

create index phonebooks_team_active_memberships_by_user
  on phonebooks_team_private.memberships (user_id, workspace_id)
  where revoked_at is null;

alter table phonebooks_team_private.workspaces enable row level security;
alter table phonebooks_team_private.memberships enable row level security;
revoke all on all tables in schema phonebooks_team_private from public, anon, authenticated;

-- Check the current Auth session, as in PR #9. A JWT can outlive a revoked session.
create function phonebooks_team_private.session_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare
  actor_id uuid := auth.uid();
  session_id uuid := (auth.jwt()->>'session_id')::uuid;
begin
  if actor_id is null or session_id is null or not exists (
    select from auth.sessions as session
    where session.id = session_id and session.user_id = actor_id
      and (session.not_after is null or session.not_after > statement_timestamp())
  ) then
    raise sqlstate 'PT401' using message = 'Session expired';
  end if;

  if not exists (
    select from auth.users as account
    where account.id = actor_id and account.email_confirmed_at is not null
  ) then
    raise sqlstate 'PT403' using message = 'Confirmed email required';
  end if;

  return actor_id;
end;
$$;

create function public.phonebooks_team_workspaces()
returns table (id uuid, name text, role text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
begin
  return query
  select workspace.id, workspace.name, membership.role, workspace.created_at
  from phonebooks_team_private.memberships as membership
  join phonebooks_team_private.workspaces as workspace on workspace.id = membership.workspace_id
  where membership.user_id = actor_id and membership.revoked_at is null
  order by workspace.created_at, workspace.id;
end;
$$;

create function public.phonebooks_team_create_workspace(p_name text, p_request_id uuid)
returns table (id uuid, name text, role text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
  workspace_name text := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  workspace phonebooks_team_private.workspaces;
  membership_role text;
begin
  if p_request_id is null or workspace_name is null or char_length(workspace_name) not between 1 and 100
    or workspace_name ~ '[[:cntrl:]]' then
    raise sqlstate 'PT400' using message = 'Invalid workspace name or request ID';
  end if;

  insert into phonebooks_team_private.workspaces as entry (name, created_by, creation_request_id, creation_name)
    values (workspace_name, actor_id, p_request_id, workspace_name)
    on conflict (created_by, creation_request_id) do nothing
    returning entry.* into workspace;

  if found then
    insert into phonebooks_team_private.memberships (workspace_id, user_id, role)
      values (workspace.id, actor_id, 'owner');
    membership_role := 'owner';
  else
    select entry.* into strict workspace from phonebooks_team_private.workspaces as entry
      where entry.created_by = actor_id and entry.creation_request_id = p_request_id;

    select membership.role into membership_role from phonebooks_team_private.memberships as membership
      where membership.workspace_id = workspace.id and membership.user_id = actor_id and membership.revoked_at is null;

    if membership_role is null then
      raise sqlstate 'PT403' using message = 'Workspace access revoked';
    end if;
    if workspace_name <> workspace.creation_name then
      raise sqlstate 'PT409' using message = 'Request ID already used with a different name';
    end if;
  end if;

  return query select workspace.id, workspace.name, membership_role, workspace.created_at;
end;
$$;

revoke all on function phonebooks_team_private.session_user() from public, anon, authenticated;
revoke all on function public.phonebooks_team_workspaces() from public, anon, authenticated;
revoke all on function public.phonebooks_team_create_workspace(text, uuid) from public, anon, authenticated;
grant execute on function public.phonebooks_team_workspaces() to authenticated;
grant execute on function public.phonebooks_team_create_workspace(text, uuid) to authenticated;

commit;
