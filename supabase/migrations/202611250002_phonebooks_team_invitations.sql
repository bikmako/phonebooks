begin;

create table phonebooks_team_private.invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references phonebooks_team_private.workspaces(id) on delete restrict,
  email text not null,
  role text not null check (role in ('manager', 'employee')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '7 days',
  accepted_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz
);
create index phonebooks_team_invites_by_email on phonebooks_team_private.invitations(email);
create index phonebooks_team_invites_by_workspace on phonebooks_team_private.invitations(workspace_id, created_at desc);
alter table phonebooks_team_private.invitations enable row level security;
revoke all on phonebooks_team_private.invitations from public, anon, authenticated;

create function phonebooks_team_private.require_workspace_owner(p_workspace_id uuid, p_actor_id uuid)
returns void language plpgsql stable set search_path = '' as $$
begin
  if not exists (
    select from phonebooks_team_private.memberships
    where workspace_id = p_workspace_id and user_id = p_actor_id and role = 'owner' and revoked_at is null
  ) then
    raise sqlstate 'PT403' using message = 'Workspace owner access required';
  end if;
end;
$$;

create function public.phonebooks_team_account() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
begin
  return (select jsonb_build_object('id', account.id, 'email', account.email)
    from auth.users as account where account.id = actor_id);
end;
$$;

create function public.phonebooks_team_create_invitation(p_workspace_id uuid, p_email text, p_role text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
  recipient text := lower(btrim(p_email));
  existing phonebooks_team_private.invitations;
  invitation_id uuid;
begin
  perform phonebooks_team_private.require_workspace_owner(p_workspace_id, actor_id);
  if recipient is null or char_length(recipient) > 254 or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_role is null or p_role not in ('manager', 'employee') then
    raise sqlstate 'PT400' using message = 'Invalid recipient or role';
  end if;
  -- Serialize outstanding invitations within the workspace.
  perform from phonebooks_team_private.workspaces where id = p_workspace_id for update;
  select * into existing from phonebooks_team_private.invitations
    where workspace_id = p_workspace_id and email = recipient
      and revoked_at is null and accepted_by is null and expires_at > clock_timestamp();
  if found then
    if existing.role <> p_role then
      raise sqlstate 'PT409' using message = 'An active invitation already exists with a different role';
    end if;
    return existing.id;
  end if;
  insert into phonebooks_team_private.invitations(workspace_id, email, role, created_by)
    values (p_workspace_id, recipient, p_role, actor_id)
    returning id into invitation_id;
  return invitation_id;
end;
$$;

create function public.phonebooks_team_outgoing_invitations(p_workspace_id uuid)
returns table (id uuid, email text, role text, expires_at timestamptz, status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
begin
  perform phonebooks_team_private.require_workspace_owner(p_workspace_id, actor_id);
  return query
    select invite.id, invite.email, invite.role, invite.expires_at,
      case when invite.revoked_at is not null then 'revoked'
           when invite.accepted_by is not null then 'accepted'
           when invite.expires_at <= statement_timestamp() then 'expired'
           else 'pending' end
    from phonebooks_team_private.invitations as invite
    where invite.workspace_id = p_workspace_id
    order by invite.created_at desc, invite.id;
end;
$$;

create function public.phonebooks_team_incoming_invitations()
returns table (id uuid, workspace_name text, role text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
begin
  return query
    select invite.id, workspace.name, invite.role, invite.expires_at
    from phonebooks_team_private.invitations as invite
    join phonebooks_team_private.workspaces as workspace on workspace.id = invite.workspace_id
    join auth.users as account on account.id = actor_id and lower(account.email) = invite.email
    where invite.revoked_at is null and invite.accepted_by is null and invite.expires_at > statement_timestamp()
    order by invite.created_at desc, invite.id;
end;
$$;

create function public.phonebooks_team_accept_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
  invitation phonebooks_team_private.invitations;
begin
  select invite.* into invitation from phonebooks_team_private.invitations as invite
    join auth.users as account on account.id = actor_id and lower(account.email) = invite.email
    where invite.id = p_invitation_id for update of invite;
  if not found then
    raise sqlstate 'PT404' using message = 'Invitation not found';
  end if;
  if invitation.accepted_by = actor_id and exists (
    select from phonebooks_team_private.memberships
    where workspace_id = invitation.workspace_id and user_id = actor_id and revoked_at is null
  ) then
    return invitation.workspace_id;
  end if;
  if invitation.revoked_at is not null or invitation.accepted_by is not null or invitation.expires_at <= clock_timestamp() then
    raise sqlstate 'PT409' using message = 'Invitation is no longer active';
  end if;
  insert into phonebooks_team_private.memberships as membership(workspace_id, user_id, role)
    values (invitation.workspace_id, actor_id, invitation.role)
    on conflict (workspace_id, user_id) do update
      set role = excluded.role, revoked_at = null where membership.revoked_at is not null;
  update phonebooks_team_private.invitations set accepted_by = actor_id where id = invitation.id;
  return invitation.workspace_id;
end;
$$;

create function public.phonebooks_team_revoke_invitation(p_workspace_id uuid, p_invitation_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := phonebooks_team_private.session_user();
  invitation phonebooks_team_private.invitations;
begin
  perform phonebooks_team_private.require_workspace_owner(p_workspace_id, actor_id);
  select * into invitation from phonebooks_team_private.invitations
    where workspace_id = p_workspace_id and id = p_invitation_id for update;
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

create function public.phonebooks_team_overview(p_preferred uuid) returns jsonb
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
  if selected->>'role' = 'owner' then
    select coalesce(jsonb_agg(to_jsonb(invite)), '[]'::jsonb) into outgoing
      from public.phonebooks_team_outgoing_invitations((selected->>'id')::uuid) as invite;
  end if;
  return jsonb_build_object('account', account, 'workspaces', workspace_list, 'selected', selected,
    'incoming', incoming, 'outgoing', outgoing);
end;
$$;

revoke all on function phonebooks_team_private.require_workspace_owner(uuid, uuid) from public, anon, authenticated;
revoke all on function public.phonebooks_team_account(),
  public.phonebooks_team_create_invitation(uuid, text, text),
  public.phonebooks_team_outgoing_invitations(uuid), public.phonebooks_team_incoming_invitations(),
  public.phonebooks_team_accept_invitation(uuid), public.phonebooks_team_revoke_invitation(uuid, uuid),
  public.phonebooks_team_overview(uuid)
  from public, anon, authenticated;
grant execute on function public.phonebooks_team_account(),
  public.phonebooks_team_create_invitation(uuid, text, text),
  public.phonebooks_team_outgoing_invitations(uuid), public.phonebooks_team_incoming_invitations(),
  public.phonebooks_team_accept_invitation(uuid), public.phonebooks_team_revoke_invitation(uuid, uuid),
  public.phonebooks_team_overview(uuid)
  to authenticated;

commit;
