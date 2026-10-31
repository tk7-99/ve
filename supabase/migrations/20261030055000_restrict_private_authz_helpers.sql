-- Prevent authenticated users from probing membership or administrator status for other user IDs.
create or replace function private.is_conversation_member(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select _user_id = auth.uid() and exists (
    select 1 from public.conversation_members
    where conversation_id = _conversation_id and user_id = _user_id
  );
$$;
revoke all on function private.is_conversation_member(uuid,uuid) from public, anon;
grant execute on function private.is_conversation_member(uuid,uuid) to authenticated;

create or replace function private.is_conversation_creator(_conversation_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select _user_id = auth.uid() and exists (
    select 1 from public.conversations
    where id = _conversation_id and created_by = _user_id
  );
$$;
revoke all on function private.is_conversation_creator(uuid,uuid) from public, anon;
grant execute on function private.is_conversation_creator(uuid,uuid) to authenticated;

create or replace function private.is_app_admin(_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select _user_id = auth.uid() and exists (
    select 1 from public.app_admins where user_id = _user_id
  );
$$;
revoke all on function private.is_app_admin(uuid) from public, anon;
grant execute on function private.is_app_admin(uuid) to authenticated;
