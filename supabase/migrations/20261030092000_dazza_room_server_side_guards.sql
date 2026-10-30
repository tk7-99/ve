do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dazza_rooms'::regclass
      and conname = 'dazza_voice_room_max_members'
  ) then
    alter table public.dazza_rooms
      add constraint dazza_voice_room_max_members
      check (room_type <> 'voice' or max_members <= 6);
  end if;
end
$$;

create or replace function private.guard_dazza_room_create()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or new.host_id <> auth.uid() then
    raise exception 'Room host must be the signed-in user';
  end if;
  new.created_at := now();
  new.updated_at := now();
  new.expires_at := now() + interval '24 hours';
  new.status := 'open';
  new.visibility := 'public';
  new.room_state := '{}'::jsonb;
  return new;
end;
$$;

create or replace function private.guard_dazza_room_update()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_active_count integer;
begin
  if auth.uid() is null
     or old.host_id <> auth.uid()
     or new.host_id is distinct from old.host_id
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.room_type is distinct from old.room_type
     or (old.status = 'closed' and new.status = 'open') then
    raise exception 'Room ownership and lifecycle fields are protected';
  end if;

  select count(*)::integer into v_active_count
  from public.dazza_room_members rm
  where rm.room_id = old.id
    and rm.last_seen_at > now() - interval '3 minutes';

  if new.max_members < greatest(v_active_count, 2) then
    raise exception 'Room capacity cannot be lower than the active member count';
  end if;

  if new.room_type = 'voice' and new.max_members > 6 then
    raise exception 'Voice rooms are limited to six members';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dazza_rooms_guard_before_insert on public.dazza_rooms;
create trigger dazza_rooms_guard_before_insert
before insert on public.dazza_rooms
for each row execute function private.guard_dazza_room_create();

drop trigger if exists dazza_rooms_guard_before_update on public.dazza_rooms;
create trigger dazza_rooms_guard_before_update
before update on public.dazza_rooms
for each row execute function private.guard_dazza_room_update();

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
    and rm.last_seen_at > now() - interval '3 minutes';

  if v_active_count >= v_max_members then
    raise exception 'This room is full';
  end if;

  new.joined_at := now();
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

  new.created_at := now();

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

revoke all on function private.guard_dazza_room_create() from public, anon, authenticated;
revoke all on function private.guard_dazza_room_update() from public, anon, authenticated;
revoke all on function private.enforce_dazza_room_capacity() from public, anon, authenticated;
revoke all on function private.enforce_dazza_room_chat_rate() from public, anon, authenticated;
