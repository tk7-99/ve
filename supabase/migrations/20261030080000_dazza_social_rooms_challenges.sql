create table if not exists public.dazza_rooms (
  id uuid primary key default gen_random_uuid(),
  room_type text not null check (room_type in ('voice','watch','game')),
  title text not null check (char_length(title) between 2 and 80),
  host_id uuid not null references auth.users(id) on delete cascade,
  visibility text not null default 'public' check (visibility in ('public')),
  video_id text,
  game_key text,
  room_state jsonb not null default '{}'::jsonb,
  max_members integer not null default 8 check (max_members between 2 and 12),
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.dazza_room_members (
  room_id uuid not null references public.dazza_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('host','member')),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

create table if not exists public.dazza_room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.dazza_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.dazza_challenges (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 90),
  description text not null default '' check (char_length(description) <= 500),
  challenge_type text not null default 'general' check (challenge_type in ('general','games','fitness','creative','learning','social')),
  target_count integer not null default 1 check (target_count between 1 and 1000),
  reward_points integer not null default 0 check (reward_points between 0 and 10000),
  expires_at timestamptz,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.dazza_challenge_participants (
  challenge_id uuid not null references public.dazza_challenges(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  progress integer not null default 0 check (progress >= 0),
  status text not null default 'joined' check (status in ('joined','completed')),
  joined_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (challenge_id, user_id)
);

create index if not exists dazza_rooms_open_created_idx on public.dazza_rooms(status, created_at desc);
create index if not exists dazza_rooms_host_idx on public.dazza_rooms(host_id, created_at desc);
create index if not exists dazza_room_members_user_idx on public.dazza_room_members(user_id, joined_at desc);
create index if not exists dazza_room_messages_room_created_idx on public.dazza_room_messages(room_id, created_at desc);
create index if not exists dazza_challenges_open_created_idx on public.dazza_challenges(status, created_at desc);
create index if not exists dazza_challenge_participants_user_idx on public.dazza_challenge_participants(user_id, joined_at desc);

alter table public.dazza_rooms enable row level security;
alter table public.dazza_room_members enable row level security;
alter table public.dazza_room_messages enable row level security;
alter table public.dazza_challenges enable row level security;
alter table public.dazza_challenge_participants enable row level security;

grant select, insert, update, delete on public.dazza_rooms to authenticated;
grant select, insert, delete on public.dazza_room_members to authenticated;
grant select, insert, delete on public.dazza_room_messages to authenticated;
grant select, insert, update, delete on public.dazza_challenges to authenticated;
grant select, insert, update on public.dazza_challenge_participants to authenticated;

drop policy if exists "dazza rooms visible to public or members" on public.dazza_rooms;
create policy "dazza rooms visible to public or members"
on public.dazza_rooms for select to authenticated
using (
  (visibility = 'public' and status = 'open')
  or host_id = (select auth.uid())
  or exists (
    select 1 from public.dazza_room_members rm
    where rm.room_id = id and rm.user_id = (select auth.uid())
  )
);

drop policy if exists "dazza users create rooms as host" on public.dazza_rooms;
create policy "dazza users create rooms as host"
on public.dazza_rooms for insert to authenticated
with check (host_id = (select auth.uid()));

drop policy if exists "dazza hosts update rooms" on public.dazza_rooms;
create policy "dazza hosts update rooms"
on public.dazza_rooms for update to authenticated
using (host_id = (select auth.uid()))
with check (host_id = (select auth.uid()));

drop policy if exists "dazza hosts delete rooms" on public.dazza_rooms;
create policy "dazza hosts delete rooms"
on public.dazza_rooms for delete to authenticated
using (host_id = (select auth.uid()));

drop policy if exists "dazza members read own membership" on public.dazza_room_members;
create policy "dazza members read own membership"
on public.dazza_room_members for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "dazza users join open rooms" on public.dazza_room_members;
create policy "dazza users join open rooms"
on public.dazza_room_members for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (
    (role = 'host' and exists (
      select 1 from public.dazza_rooms r
      where r.id = room_id and r.host_id = (select auth.uid())
    ))
    or
    (role = 'member' and exists (
      select 1 from public.dazza_rooms r
      where r.id = room_id and r.visibility = 'public' and r.status = 'open'
    ))
  )
);

drop policy if exists "dazza users leave own rooms" on public.dazza_room_members;
create policy "dazza users leave own rooms"
on public.dazza_room_members for delete to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.dazza_rooms r
    where r.id = room_id and r.host_id = (select auth.uid())
  )
);

drop policy if exists "dazza room members read chat" on public.dazza_room_messages;
create policy "dazza room members read chat"
on public.dazza_room_messages for select to authenticated
using (
  exists (
    select 1 from public.dazza_room_members rm
    where rm.room_id = dazza_room_messages.room_id
      and rm.user_id = (select auth.uid())
  )
);

drop policy if exists "dazza room members send chat" on public.dazza_room_messages;
create policy "dazza room members send chat"
on public.dazza_room_messages for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.dazza_room_members rm
    where rm.room_id = dazza_room_messages.room_id
      and rm.user_id = (select auth.uid())
  )
);

drop policy if exists "dazza users delete own room chat" on public.dazza_room_messages;
create policy "dazza users delete own room chat"
on public.dazza_room_messages for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "dazza challenges visible" on public.dazza_challenges;
create policy "dazza challenges visible"
on public.dazza_challenges for select to authenticated
using (status = 'open' or created_by = (select auth.uid()));

drop policy if exists "dazza users create own challenges" on public.dazza_challenges;
create policy "dazza users create own challenges"
on public.dazza_challenges for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists "dazza creators update challenges" on public.dazza_challenges;
create policy "dazza creators update challenges"
on public.dazza_challenges for update to authenticated
using (created_by = (select auth.uid()))
with check (created_by = (select auth.uid()));

drop policy if exists "dazza creators delete challenges" on public.dazza_challenges;
create policy "dazza creators delete challenges"
on public.dazza_challenges for delete to authenticated
using (created_by = (select auth.uid()));

drop policy if exists "dazza users read own challenge progress" on public.dazza_challenge_participants;
create policy "dazza users read own challenge progress"
on public.dazza_challenge_participants for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "dazza users join open challenges" on public.dazza_challenge_participants;
create policy "dazza users join open challenges"
on public.dazza_challenge_participants for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.dazza_challenges c
    where c.id = challenge_id and c.status = 'open'
  )
);

drop policy if exists "dazza users update own challenge progress" on public.dazza_challenge_participants;
create policy "dazza users update own challenge progress"
on public.dazza_challenge_participants for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "dazza users leave own challenges" on public.dazza_challenge_participants;
create policy "dazza users leave own challenges"
on public.dazza_challenge_participants for delete to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "dazza room members receive realtime" on realtime.messages;
create policy "dazza room members receive realtime"
on realtime.messages for select to authenticated
using (
  extension in ('broadcast','presence')
  and split_part(realtime.topic(), ':', 1) = 'dazza'
  and split_part(realtime.topic(), ':', 2) = 'room'
  and exists (
    select 1 from public.dazza_room_members rm
    where rm.room_id::text = split_part(realtime.topic(), ':', 3)
      and rm.user_id = (select auth.uid())
  )
);

drop policy if exists "dazza room members send realtime" on realtime.messages;
create policy "dazza room members send realtime"
on realtime.messages for insert to authenticated
with check (
  extension in ('broadcast','presence')
  and split_part(realtime.topic(), ':', 1) = 'dazza'
  and split_part(realtime.topic(), ':', 2) = 'room'
  and exists (
    select 1 from public.dazza_room_members rm
    where rm.room_id::text = split_part(realtime.topic(), ':', 3)
      and rm.user_id = (select auth.uid())
  )
);
