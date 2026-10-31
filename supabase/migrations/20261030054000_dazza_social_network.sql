-- DAZZA Social Network schema
-- Applied to Supabase project jdtvkapmroqgerqsnjwe on 2026-10-30.
-- Do not place Supabase service-role keys in the browser.

alter table public.profiles
  add column if not exists bio text not null default '',
  add column if not exists avatar_path text,
  add column if not exists website text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  caption text not null default '' check (char_length(caption) <= 2200),
  media_path text,
  media_type text not null default 'text' check (media_type in ('text','image','video')),
  location text check (location is null or char_length(location) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_media_consistency check (
    (media_type = 'text' and media_path is null) or
    (media_type in ('image','video') and media_path is not null)
  )
);

create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,user_id)
);

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('accepted','pending')),
  created_at timestamptz not null default now(),
  primary key (follower_id,following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_path text not null,
  media_type text not null check (media_type in ('image','video')),
  caption text not null default '' check (char_length(caption) <= 300),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  constraint stories_max_lifetime check (
    expires_at <= created_at + interval '24 hours' and expires_at > created_at
  )
);

create table if not exists public.story_views (
  story_id uuid not null references public.stories(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (story_id,viewer_id)
);

create table if not exists public.post_bookmarks (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id,user_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('like','comment','follow','message')),
  post_id uuid references public.posts(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  is_read boolean not null default false
);

alter table public.notifications
  add column if not exists conversation_id uuid references public.conversations(id) on delete cascade;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('like','comment','follow','message'));

create index if not exists posts_created_at_idx on public.posts(created_at desc);
create index if not exists posts_user_created_idx on public.posts(user_id,created_at desc);
create index if not exists comments_post_created_idx on public.post_comments(post_id,created_at asc);
create index if not exists follows_following_status_idx on public.follows(following_id,status);
create index if not exists follows_follower_status_idx on public.follows(follower_id,status);
create index if not exists stories_active_idx on public.stories(expires_at desc);
create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);

alter table public.posts enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.follows enable row level security;
alter table public.stories enable row level security;
alter table public.story_views enable row level security;
alter table public.post_bookmarks enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "authenticated read social posts" on public.posts;
create policy "authenticated read social posts" on public.posts
  for select to authenticated using (true);
drop policy if exists "users create own posts" on public.posts;
create policy "users create own posts" on public.posts
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "users update own posts" on public.posts;
create policy "users update own posts" on public.posts
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "users delete own posts" on public.posts;
create policy "users delete own posts" on public.posts
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "authenticated read post likes" on public.post_likes;
create policy "authenticated read post likes" on public.post_likes
  for select to authenticated using (true);
drop policy if exists "users like as themselves" on public.post_likes;
create policy "users like as themselves" on public.post_likes
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "users remove own likes" on public.post_likes;
create policy "users remove own likes" on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "authenticated read comments" on public.post_comments;
create policy "authenticated read comments" on public.post_comments
  for select to authenticated using (true);
drop policy if exists "users create own comments" on public.post_comments;
create policy "users create own comments" on public.post_comments
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "users update own comments" on public.post_comments;
create policy "users update own comments" on public.post_comments
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "users delete own comments" on public.post_comments;
create policy "users delete own comments" on public.post_comments
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "authenticated read follows" on public.follows;
create policy "authenticated read follows" on public.follows
  for select to authenticated using (true);
drop policy if exists "users follow as themselves" on public.follows;
create policy "users follow as themselves" on public.follows
  for insert to authenticated with check (follower_id = (select auth.uid()));
drop policy if exists "users unfollow themselves" on public.follows;
create policy "users unfollow themselves" on public.follows
  for delete to authenticated using (follower_id = (select auth.uid()));

drop policy if exists "authenticated read active stories" on public.stories;
create policy "authenticated read active stories" on public.stories
  for select to authenticated using (expires_at > now());
drop policy if exists "users create own stories" on public.stories;
create policy "users create own stories" on public.stories
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "users delete own stories" on public.stories;
create policy "users delete own stories" on public.stories
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "users read story views" on public.story_views;
create policy "users read story views" on public.story_views
  for select to authenticated using (
    viewer_id = (select auth.uid()) or exists (
      select 1 from public.stories s where s.id = story_id and s.user_id = (select auth.uid())
    )
  );
drop policy if exists "users record own story views" on public.story_views;
create policy "users record own story views" on public.story_views
  for insert to authenticated with check (viewer_id = (select auth.uid()));

drop policy if exists "users read own bookmarks" on public.post_bookmarks;
create policy "users read own bookmarks" on public.post_bookmarks
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "users bookmark own items" on public.post_bookmarks;
create policy "users bookmark own items" on public.post_bookmarks
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "users remove own bookmarks" on public.post_bookmarks;
create policy "users remove own bookmarks" on public.post_bookmarks
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications" on public.notifications
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function private.create_social_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_user uuid;
  actor_user uuid;
  target_post uuid;
  related_comment uuid;
  target_conversation uuid;
  notification_type text;
begin
  if tg_table_name = 'follows' then
    target_user := new.following_id;
    actor_user := new.follower_id;
    notification_type := 'follow';
  elsif tg_table_name = 'post_likes' then
    select user_id into target_user from public.posts where id = new.post_id;
    actor_user := new.user_id;
    target_post := new.post_id;
    notification_type := 'like';
  elsif tg_table_name = 'post_comments' then
    select user_id into target_user from public.posts where id = new.post_id;
    actor_user := new.user_id;
    target_post := new.post_id;
    related_comment := new.id;
    notification_type := 'comment';
  elsif tg_table_name = 'messages' then
    select user_id into target_user
    from public.conversation_members
    where conversation_id = new.conversation_id and user_id <> new.sender_id
    order by joined_at asc limit 1;
    actor_user := new.sender_id;
    target_conversation := new.conversation_id;
    notification_type := 'message';
  else
    return new;
  end if;

  if target_user is not null and target_user <> actor_user then
    insert into public.notifications(user_id,actor_id,type,post_id,comment_id,conversation_id)
    values (target_user,actor_user,notification_type,target_post,related_comment,target_conversation);
  end if;
  return new;
end;
$$;
revoke all on function private.create_social_notification() from public, anon, authenticated;

drop trigger if exists social_follow_notification on public.follows;
create trigger social_follow_notification after insert on public.follows
for each row execute function private.create_social_notification();
drop trigger if exists social_like_notification on public.post_likes;
create trigger social_like_notification after insert on public.post_likes
for each row execute function private.create_social_notification();
drop trigger if exists social_comment_notification on public.post_comments;
create trigger social_comment_notification after insert on public.post_comments
for each row execute function private.create_social_notification();
drop trigger if exists social_message_notification on public.messages;
create trigger social_message_notification after insert on public.messages
for each row execute function private.create_social_notification();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values (
  'dazza-social-media','dazza-social-media',true,52428800,
  array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm']
)
on conflict (id) do update set
  public=excluded.public,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "social media upload to own folder" on storage.objects;
create policy "social media upload to own folder" on storage.objects
  for insert to authenticated with check (
    bucket_id='dazza-social-media' and (storage.foldername(name))[1]=(select auth.uid())::text
  );
drop policy if exists "social media update own files" on storage.objects;
create policy "social media update own files" on storage.objects
  for update to authenticated using (
    bucket_id='dazza-social-media' and (storage.foldername(name))[1]=(select auth.uid())::text
  ) with check (
    bucket_id='dazza-social-media' and (storage.foldername(name))[1]=(select auth.uid())::text
  );
drop policy if exists "social media delete own files" on storage.objects;
create policy "social media delete own files" on storage.objects
  for delete to authenticated using (
    bucket_id='dazza-social-media' and (storage.foldername(name))[1]=(select auth.uid())::text
  );

create or replace function private.create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid := auth.uid();
  v_conversation uuid;
  v_pair_key text;
begin
  if v_actor is null then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_other_user_id is null or p_other_user_id=v_actor then raise exception 'Choose another valid account' using errcode='22023'; end if;
  if not exists (select 1 from public.profiles where id=p_other_user_id) then raise exception 'Account not found' using errcode='P0002'; end if;
  v_pair_key := least(v_actor::text,p_other_user_id::text) || ':' || greatest(v_actor::text,p_other_user_id::text);
  perform pg_advisory_xact_lock(hashtextextended(v_pair_key,0));
  select c.id into v_conversation
  from public.conversations c
  join public.conversation_members mine on mine.conversation_id=c.id and mine.user_id=v_actor
  join public.conversation_members other on other.conversation_id=c.id and other.user_id=p_other_user_id
  group by c.id having count(*)=2 order by max(c.created_at) desc limit 1;
  if v_conversation is not null then return v_conversation; end if;
  insert into public.conversations(created_by) values (v_actor) returning id into v_conversation;
  insert into public.conversation_members(conversation_id,user_id)
  values (v_conversation,v_actor),(v_conversation,p_other_user_id);
  return v_conversation;
end;
$$;
revoke all on function private.create_direct_conversation(uuid) from public, anon;
grant execute on function private.create_direct_conversation(uuid) to authenticated;

create or replace function public.create_direct_conversation(p_other_user_id uuid)
returns uuid
language sql
security invoker
set search_path = public, pg_temp
as $$ select private.create_direct_conversation(p_other_user_id); $$;
revoke all on function public.create_direct_conversation(uuid) from public, anon;
grant execute on function public.create_direct_conversation(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='posts') then
    alter publication supabase_realtime add table public.posts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='post_likes') then
    alter publication supabase_realtime add table public.post_likes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='post_comments') then
    alter publication supabase_realtime add table public.post_comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='follows') then
    alter publication supabase_realtime add table public.follows;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='stories') then
    alter publication supabase_realtime add table public.stories;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$$;

-- Foreign-key supporting indexes and media feed index.
create index if not exists conversations_created_by_idx on public.conversations(created_by);
create index if not exists notifications_actor_idx on public.notifications(actor_id);
create index if not exists notifications_comment_idx on public.notifications(comment_id);
create index if not exists notifications_conversation_idx on public.notifications(conversation_id);
create index if not exists notifications_post_idx on public.notifications(post_id);
create index if not exists post_bookmarks_user_idx on public.post_bookmarks(user_id);
create index if not exists post_comments_user_idx on public.post_comments(user_id);
create index if not exists post_likes_user_idx on public.post_likes(user_id);
create index if not exists stories_user_idx on public.stories(user_id);
create index if not exists story_views_viewer_idx on public.story_views(viewer_id);
create index if not exists posts_media_created_idx on public.posts(media_type,created_at desc);
