create index if not exists dazza_challenges_created_by_idx
  on public.dazza_challenges(created_by, created_at desc);
create index if not exists dazza_room_messages_user_idx
  on public.dazza_room_messages(user_id, created_at desc);
