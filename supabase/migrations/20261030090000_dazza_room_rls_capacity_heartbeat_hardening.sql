alter table public.dazza_rooms
  add column if not exists expires_at timestamptz not null default (now() + interval '24 hours');

alter table public.dazza_room_members
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists dazza_room_members_active_idx
  on public.dazza_room_members(room_id, last_seen_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dazza_rooms'::regclass
      and conname = 'dazza_watch_video_id_format'
  ) then
    alter table public.dazza_rooms
      add constraint dazza_watch_video_id_format
      check (room_type <> 'watch' or video_id ~ '^[A-Za-z0-9_-]{11}$');
  end if;
end
$$;

create or replace function private.is_dazza_room_host(_room_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select _user_id = auth.uid() and exists (
    select 1 from public.dazza_rooms r
    where r.id = _room_id and r.host_id = _user_id
  );
$$;

create or replace function private.is_dazza_room_open(_room_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from public.dazza_rooms r
    where r.id = _room_id
      and r.visibility = 'public'
      and r.status = 'open'
      and r.expires_at > now()
  );
$$;

create or replace function private.is_dazza_room_member(_room_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select _user_id = auth.uid() and exists (
    select 1
    from public.dazza_room_members rm
    join public.dazza_rooms r on r.id = rm.room_id
    where rm.room_id = _room_id
      and rm.user_id = _user_id
      and rm.last_seen_at > now() - interval '90 seconds'
      and r.status = 'open'
      and r.expires_at > now()
  );
$$;

create or replace function private.is_dazza_room_member_topic(_topic text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
    and split_part(_topic, ':', 1) = 'dazza'
    and split_part(_topic, ':', 2) = 'room'
    and exists (
      select 1
      from public.dazza_room_members rm
      join public.dazza_rooms r on r.id = rm.room_id
      where rm.room_id::text = split_part(_topic, ':', 3)
        and rm.user_id = auth.uid()
        and rm.last_seen_at > now() - interval '90 seconds'
        and r.status = 'open'
        and r.expires_at > now()
    );
$$;

create or replace function private.enforce_dazza_room_capacity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_host_id uuid;
  v_max_members integer;
  v_status text;
  v_expires_at timestamptz;
  v_active_count integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Room membership must belong to the signed-in user';
  end if;

  select r.host_id, r.max_members, r.status, r.expires_at
    into v_host_id, v_max_members, v_status, v_expires_at
  from public.dazza_rooms r
  where r.id = new.room_id
  for update;

  if not found or v_status <> 'open' or v_expires_at <= now() then
    raise exception 'This room is no longer open';
  end if;

  if new.role = 'host' and v_host_id <> new.user_id then
    raise exception 'Only the room owner can claim the host role';
  end if;

  select count(*)::integer into v_active_count
  from public.dazza_room_members rm
  where rm.room_id = new.room_id
    and rm.user_id <> new.user_id
    and rm.last_seen_at > now() - interval '90 seconds';

  if v_active_count >= v_max_members then
    raise exception 'This room is full';
  end if;

  return new;
end;
$$;

create or replace function private.guard_dazza_room_member_heartbeat()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_max_members integer;
  v_status text;
  v_expires_at timestamptz;
  v_active_count integer;
begin
  if auth.uid() is null
     or old.user_id <> auth.uid()
     or new.room_id is distinct from old.room_id
     or new.user_id is distinct from old.user_id
     or new.role is distinct from old.role
     or new.joined_at is distinct from old.joined_at then
    raise exception 'Room membership fields are immutable';
  end if;

  if old.last_seen_at <= now() - interval '90 seconds' then
    select r.max_members, r.status, r.expires_at
      into v_max_members, v_status, v_expires_at
    from public.dazza_rooms r
    where r.id = old.room_id
    for update;

    if not found or v_status <> 'open' or v_expires_at <= now() then
      raise exception 'This room is no longer open';
    end if;

    select count(*)::integer into v_active_count
    from public.dazza_room_members rm
    where rm.room_id = old.room_id
      and rm.user_id <> old.user_id
      and rm.last_seen_at > now() - interval '90 seconds';

    if v_active_count >= v_max_members then
      raise exception 'This room is full';
    end if;
  end if;

  new.last_seen_at := now();
  return new;
end;
$$;

create or replace function private.enforce_dazza_room_chat_rate()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_recent_count integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'Room chat messages must belong to the signed-in user';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.room_id::text || ':' || new.user_id::text, 0)
  );

  select count(*)::integer into v_recent_count
  from public.dazza_room_messages m
  where m.room_id = new.room_id
    and m.user_id = new.user_id
    and m.created_at > now() - interval '10 seconds';

  if v_recent_count >= 6 then
    raise exception 'You are sending messages too quickly';
  end if;

  return new;
end;
$$;

drop trigger if exists dazza_room_members_capacity_before_insert on public.dazza_room_members;
create trigger dazza_room_members_capacity_before_insert
before insert on public.dazza_room_members
for each row execute function private.enforce_dazza_room_capacity();

drop trigger if exists dazza_room_members_heartbeat_before_update on public.dazza_room_members;
create trigger dazza_room_members_heartbeat_before_update
before update on public.dazza_room_members
for each row execute function private.guard_dazza_room_member_heartbeat();

drop trigger if exists dazza_room_messages_rate_before_insert on public.dazza_room_messages;
create trigger dazza_room_messages_rate_before_insert
before insert on public.dazza_room_messages
for each row execute function private.enforce_dazza_room_chat_rate();

drop policy if exists "dazza rooms visible to public or members" on public.dazza_rooms;
create policy "dazza rooms visible to public or members"
on public.dazza_rooms for select to authenticated
using (
  (visibility = 'public' and status = 'open' and expires_at > now())
  or host_id = (select auth.uid())
  or private.is_dazza_room_member(id, (select auth.uid()))
);

drop policy if exists "dazza users join open rooms" on public.dazza_room_members;
create policy "dazza users join open rooms"
on public.dazza_room_members for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (
    (role = 'host' and private.is_dazza_room_host(room_id, (select auth.uid())))
    or (role = 'member' and private.is_dazza_room_open(room_id))
  )
);

drop policy if exists "dazza users leave own rooms" on public.dazza_room_members;
create policy "dazza users leave own rooms"
on public.dazza_room_members for delete to authenticated
using (
  user_id = (select auth.uid())
  or private.is_dazza_room_host(room_id, (select auth.uid()))
);

drop policy if exists "dazza members update own heartbeat" on public.dazza_room_members;
create policy "dazza members update own heartbeat"
on public.dazza_room_members for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

grant update on public.dazza_room_members to authenticated;

drop policy if exists "dazza room members read chat" on public.dazza_room_messages;
create policy "dazza room members read chat"
on public.dazza_room_messages for select to authenticated
using (private.is_dazza_room_member(room_id, (select auth.uid())));

drop policy if exists "dazza room members send chat" on public.dazza_room_messages;
create policy "dazza room members send chat"
on public.dazza_room_messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_dazza_room_member(room_id, (select auth.uid()))
);

drop policy if exists "dazza room members receive realtime" on realtime.messages;
create policy "dazza room members receive realtime"
on realtime.messages for select to authenticated
using (extension in ('broadcast','presence') and private.is_dazza_room_member_topic(realtime.topic()));

drop policy if exists "dazza room members send realtime" on realtime.messages;
create policy "dazza room members send realtime"
on realtime.messages for insert to authenticated
with check (extension in ('broadcast','presence') and private.is_dazza_room_member_topic(realtime.topic()));

revoke all on function private.is_dazza_room_host(uuid, uuid) from public, anon;
revoke all on function private.is_dazza_room_open(uuid) from public, anon;
revoke all on function private.is_dazza_room_member(uuid, uuid) from public, anon;
revoke all on function private.is_dazza_room_member_topic(text) from public, anon;
revoke all on function private.enforce_dazza_room_capacity() from public, anon, authenticated;
revoke all on function private.guard_dazza_room_member_heartbeat() from public, anon, authenticated;
revoke all on function private.enforce_dazza_room_chat_rate() from public, anon, authenticated;

grant execute on function private.is_dazza_room_host(uuid, uuid) to authenticated;
grant execute on function private.is_dazza_room_open(uuid) to authenticated;
grant execute on function private.is_dazza_room_member(uuid, uuid) to authenticated;
grant execute on function private.is_dazza_room_member_topic(text) to authenticated;
