revoke all privileges on table
  public.dazza_rooms,
  public.dazza_room_members,
  public.dazza_room_messages,
  public.dazza_challenges,
  public.dazza_challenge_participants
from anon, authenticated;

grant select, insert, update, delete on public.dazza_rooms to authenticated;
grant select, insert, delete on public.dazza_room_members to authenticated;
grant select, insert, delete on public.dazza_room_messages to authenticated;
grant select, insert, update, delete on public.dazza_challenges to authenticated;
grant select, insert, update, delete on public.dazza_challenge_participants to authenticated;
