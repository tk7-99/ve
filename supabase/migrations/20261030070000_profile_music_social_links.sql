alter table public.profiles
  add column if not exists music_url text,
  add column if not exists social_links jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_social_links_object_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_social_links_object_check
      check (jsonb_typeof(social_links) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_music_url_http_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_music_url_http_check
      check (
        music_url is null
        or (char_length(music_url) <= 500 and music_url ~* '^https?://')
      );
  end if;
end
$$;
