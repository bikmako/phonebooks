begin;

create table phonebooks_team_private.transfer_uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  actor_id uuid not null,
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  byte_count integer not null check (byte_count between 1 and 12582912),
  state text not null default 'open' check (state in ('open','complete','cancelled')),
  expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
  verified boolean not null default false,
  reply jsonb,
  foreign key (workspace_id,actor_id) references phonebooks_team_private.memberships(workspace_id,user_id)
);
create unique index transfer_open_per_workspace on phonebooks_team_private.transfer_uploads(workspace_id) where state='open';
create index transfer_manifest on phonebooks_team_private.transfer_uploads(workspace_id,actor_id,digest,byte_count) where state='complete';
create index transfer_expiry on phonebooks_team_private.transfer_uploads(expires_at) where state='open';

create table phonebooks_team_private.transfer_chunks (
  transfer_id uuid not null references phonebooks_team_private.transfer_uploads(id) on delete cascade,
  position integer not null check (position between 0 and 31),
  data bytea not null check (octet_length(data) between 1 and 393216),
  digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  primary key (transfer_id,position)
);
alter table phonebooks_team_private.transfer_uploads enable row level security;
alter table phonebooks_team_private.transfer_chunks enable row level security;
revoke all on phonebooks_team_private.transfer_uploads,phonebooks_team_private.transfer_chunks from public,anon,authenticated;

create function phonebooks_team_private.prune_transfer_uploads() returns bigint
language sql volatile set search_path = '' as $$
  with expired as (
    update phonebooks_team_private.transfer_uploads set state='cancelled'
    where state='open' and expires_at <= clock_timestamp() returning id
  ), removed as (
    delete from phonebooks_team_private.transfer_chunks where transfer_id in (select id from expired) returning 1
  ) select count(*) from removed;
$$;
revoke all on function phonebooks_team_private.prune_transfer_uploads() from public,anon,authenticated;

create function public.phonebooks_team_transfer(p_workspace uuid,p_actor uuid,p_action text,p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := phonebooks_team_private.inventory_actor(p_workspace);
  upload phonebooks_team_private.transfer_uploads;
  id_input uuid;
  digest_input text := p_input->>'digest';
  bytes_input integer;
  part integer;
  part_count integer;
  expected integer;
  chunk bytea;
  existing phonebooks_team_private.transfer_chunks;
  assembled bytea;
  actual_count integer;
  result jsonb;
begin
  if actor is distinct from p_actor then raise sqlstate 'PT403' using message='Account changed'; end if;
  perform phonebooks_team_private.lock_team_workspace(p_workspace);
  perform phonebooks_team_private.require_permissions(p_workspace,actor,array['data.solo_transfer']);
  if jsonb_typeof(p_input) is distinct from 'object' then raise sqlstate 'PT400' using message='Invalid transfer input'; end if;
  if p_action in ('source','finish') and not exists (
    select from phonebooks_team_private.solo_import_config where key_hash=sha256(convert_to(p_input->>'key','UTF8'))
  ) then raise sqlstate 'PT403' using message='Untrusted transfer worker'; end if;

  if p_action='start' then
    bytes_input := phonebooks_team_private.cloud_integer(p_input->'size',1,12582912);
    if digest_input is null or digest_input !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT400' using message='Invalid manifest'; end if;
    select * into upload from phonebooks_team_private.transfer_uploads
      where workspace_id=p_workspace and actor_id=actor and state='complete' and digest=digest_input and byte_count=bytes_input;
    if found then return jsonb_build_object('state','complete','id',upload.id,'reply',upload.reply||'{"replayed":true}'); end if;

    select * into upload from phonebooks_team_private.transfer_uploads where workspace_id=p_workspace and state='open' for update;
    if found and (upload.expires_at<=clock_timestamp()
      or not ('data.solo_transfer'=any(phonebooks_team_private.team_permissions(p_workspace,upload.actor_id)))) then
      update phonebooks_team_private.transfer_uploads set state='cancelled' where id=upload.id;
      delete from phonebooks_team_private.transfer_chunks where transfer_id=upload.id;
      upload.id := null;
    end if;
    if upload.id is not null then
      if upload.actor_id<>actor or upload.digest<>digest_input or upload.byte_count<>bytes_input then
        return jsonb_build_object('state','busy','id',case when upload.actor_id=actor then upload.id end);
      end if;
    else
      if exists(select from phonebooks_team_private.workspaces where id=p_workspace and cloud_revision<>0) then
        raise sqlstate 'PT409' using message='Destination workspace must be empty';
      end if;
      insert into phonebooks_team_private.transfer_uploads(workspace_id,actor_id,digest,byte_count)
        values(p_workspace,actor,digest_input,bytes_input) returning * into upload;
    end if;
    return jsonb_build_object('state','open','id',upload.id,'received',(
      select coalesce(jsonb_agg(position order by position),'[]') from phonebooks_team_private.transfer_chunks where transfer_id=upload.id
    ));
  end if;

  id_input := (p_input->>'id')::uuid;
  select * into upload from phonebooks_team_private.transfer_uploads
    where id=id_input and workspace_id=p_workspace and actor_id=actor for update;
  if not found then raise sqlstate 'PT404' using message='Transfer not found'; end if;
  if upload.state='complete' then return jsonb_build_object('state','complete','reply',upload.reply||'{"replayed":true}'); end if;
  if upload.state='cancelled' then return jsonb_build_object('state','cancelled'); end if;
  if p_action='cancel' or upload.expires_at<=clock_timestamp() then
    update phonebooks_team_private.transfer_uploads set state='cancelled' where id=upload.id;
    delete from phonebooks_team_private.transfer_chunks where transfer_id=upload.id;
    return jsonb_build_object('state','cancelled');
  end if;

  part_count := (upload.byte_count+393215)/393216;
  if p_action='chunk' then
    part := phonebooks_team_private.cloud_integer(p_input->'position',0,part_count-1);
    if length(p_input->>'data')>524288 or digest_input is null or digest_input !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(p_input->'data') is distinct from 'string' then
      raise sqlstate 'PT400' using message='Invalid chunk';
    end if;
    chunk := decode(p_input->>'data','base64');
    expected := least(393216,upload.byte_count-393216*part);
    if octet_length(chunk)<>expected or encode(sha256(chunk),'hex')<>digest_input then
      raise sqlstate 'PT400' using message='Chunk size or checksum mismatch';
    end if;
    select * into existing from phonebooks_team_private.transfer_chunks where transfer_id=upload.id and position=part;
    if found then
      if existing.digest<>digest_input then raise sqlstate 'PT409' using message='Chunk already differs'; end if;
    else
      insert into phonebooks_team_private.transfer_chunks values(upload.id,part,chunk,digest_input);
    end if;
    return jsonb_build_object('state','open','position',part);
  end if;

  if p_action='source' then
    select count(*),string_agg(data,''::bytea order by position) into actual_count,assembled
      from phonebooks_team_private.transfer_chunks where transfer_id=upload.id;
    if actual_count<>part_count or octet_length(assembled) is distinct from upload.byte_count
      or encode(sha256(assembled),'hex') is distinct from upload.digest then
      raise sqlstate 'PT409' using message='Transfer size or checksum mismatch';
    end if;
    result := convert_from(assembled,'UTF8')::jsonb;
    update phonebooks_team_private.transfer_uploads set verified=true where id=upload.id;
    return jsonb_build_object('state','open','source',result);
  end if;

  if p_action='finish' and upload.verified then
    result := public.phonebooks_team_solo_import(p_workspace,actor,p_input->>'key',p_input->>'fingerprint',p_input->'material');
    update phonebooks_team_private.transfer_uploads set state='complete',reply=result where id=upload.id;
    delete from phonebooks_team_private.transfer_chunks where transfer_id=upload.id;
    return jsonb_build_object('state','complete','reply',result);
  end if;
  raise sqlstate 'PT409' using message='Transfer not ready';
exception when invalid_text_representation or character_not_in_repertoire or invalid_parameter_value
  or untranslatable_character or numeric_value_out_of_range then
  raise sqlstate 'PT400' using message='Invalid transfer content';
end;
$$;
revoke all on function public.phonebooks_team_transfer(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.phonebooks_team_transfer(uuid,uuid,text,jsonb) to authenticated;

commit;
