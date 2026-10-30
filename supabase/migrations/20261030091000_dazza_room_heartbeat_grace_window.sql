create or replace function private.is_dazza_room_member(_room_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select _user_id = auth.uid() and exists (
    select 1
    from public.dazza_room_members rm
    join public.dazza_rooms r on r.id = rm.room_id
    where rm.room_id = _room_id
      and rm.user_id = _user_id
      and rm.last_seen_at > now() - interval '3 minutes'
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
        and rm.last_seen_at > now() - interval '3 minutes'
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
    and rm.last_seen_at > now() - interval '3 minutes';

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

  if old.last_seen_at <= now() - interval '3 minutes' then
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
      and rm.last_seen_at > now() - interval '3 minutes';

    if v_active_count >= v_max_members then
      raise exception 'This room is full';
    end if;
  end if;

  new.last_seen_at := now();
  return new;
end;
$$;
