-- Upgrade the previous Elemental Pacman v6.0 email starter.
-- Run this once if you already ran the older setup.sql.
-- Existing email-based test users will not know their new generated account name.
-- For clean testing, delete old Authentication users and create fresh username accounts.

begin;

-- Add username fields without colliding with old display names.
alter table public.profiles
  add column if not exists account_name text;

update public.profiles
set account_name = 'player_' || left(replace(id::text, '-', ''), 8)
where account_name is null or account_name = '';

alter table public.profiles
  alter column account_name set not null;

create unique index if not exists profiles_account_name_key
  on public.profiles(account_name);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_account_name_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_account_name_format_check
      check (account_name ~ '^[a-z0-9_]{3,20}$');
  end if;
end;
$$;

-- Host may become null when the last player leaves.
alter table public.game_rooms
  alter column host_user_id drop not null;

alter table public.game_rooms
  drop constraint if exists game_rooms_host_user_id_fkey;

alter table public.game_rooms
  add constraint game_rooms_host_user_id_fkey
  foreign key (host_user_id)
  references public.profiles(id)
  on delete set null;

-- Heartbeat support for abrupt browser closes.
alter table public.room_players
  add column if not exists last_seen_at timestamptz;

update public.room_players
set last_seen_at = now()
where last_seen_at is null;

alter table public.room_players
  alter column last_seen_at set default now(),
  alter column last_seen_at set not null;

create index if not exists room_players_room_last_seen_idx
  on public.room_players(room_id, last_seen_at);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_name text;
begin
  v_account_name := lower(trim(coalesce(
    new.raw_user_meta_data ->> 'account_name',
    new.raw_user_meta_data ->> 'display_name',
    ''
  )));

  if v_account_name !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Account name must contain 3 to 20 lowercase letters, numbers, or underscores.';
  end if;

  insert into public.profiles (
    id,
    account_name,
    display_name
  )
  values (
    new.id,
    v_account_name,
    v_account_name
  );

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();


commit;

-- ---------------------------------------------------------------------------
-- 3. Internal room reconciliation
-- A player sends a heartbeat every 8 seconds.
-- Members silent for more than 30 seconds are removed.
-- The earliest remaining member becomes host.
-- If nobody remains, the room ends.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_game_room_state(
  p_room_id uuid,
  p_stale_seconds integer default 30
)
returns public.game_rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_room public.game_rooms;
  v_next_host uuid;
begin
  select *
  into v_room
  from public.game_rooms
  where id = p_room_id
  for update;

  if not found then
    return null;
  end if;

  delete from public.room_players
  where room_id = p_room_id
    and last_seen_at < now() - make_interval(secs => greatest(p_stale_seconds, 10));

  select user_id
  into v_next_host
  from public.room_players
  where room_id = p_room_id
  order by joined_at asc, player_slot asc
  limit 1;

  if v_next_host is null then
    update public.game_rooms
    set host_user_id = null,
        status = 'ended',
        ended_at = coalesce(ended_at, now())
    where id = p_room_id;
  elsif v_room.host_user_id is null
     or not exists (
       select 1
       from public.room_players
       where room_id = p_room_id
         and user_id = v_room.host_user_id
     ) then
    update public.game_rooms
    set host_user_id = v_next_host
    where id = p_room_id;
  end if;

  select *
  into v_room
  from public.game_rooms
  where id = p_room_id;

  return v_room;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Atomic room functions
-- ---------------------------------------------------------------------------
create or replace function public.create_game_room(
  p_code text,
  p_map_seed bigint
)
returns public.game_rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.game_rooms;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to create a room.';
  end if;

  p_code := upper(trim(p_code));
  if p_code !~ '^[A-Z0-9]{6}$' then
    raise exception 'Room code must contain six letters or numbers.';
  end if;

  insert into public.game_rooms (
    code,
    host_user_id,
    map_seed
  )
  values (
    p_code,
    v_user_id,
    p_map_seed
  )
  returning * into v_room;

  insert into public.room_players (
    room_id,
    user_id,
    player_slot,
    last_seen_at
  )
  values (
    v_room.id,
    v_user_id,
    1,
    now()
  );

  return v_room;
end;
$$;

create or replace function public.join_game_room(p_code text)
returns public.game_rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.game_rooms;
  v_slot smallint;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to join a room.';
  end if;

  p_code := upper(trim(p_code));

  select *
  into v_room
  from public.game_rooms
  where code = p_code
  for update;

  if not found then
    raise exception 'Room % was not found.', p_code;
  end if;

  v_room := public.reconcile_game_room_state(v_room.id, 30);

  if v_room.status = 'ended' then
    raise exception 'This game has ended.';
  end if;

  if exists (
    select 1
    from public.room_players
    where room_id = v_room.id
      and user_id = v_user_id
  ) then
    update public.room_players
    set last_seen_at = now()
    where room_id = v_room.id
      and user_id = v_user_id;

    return v_room;
  end if;

  select candidate.slot
  into v_slot
  from generate_series(1, v_room.max_players) as candidate(slot)
  where not exists (
    select 1
    from public.room_players rp
    where rp.room_id = v_room.id
      and rp.player_slot = candidate.slot
  )
  order by candidate.slot
  limit 1;

  if v_slot is null then
    raise exception 'This room is full.';
  end if;

  insert into public.room_players (
    room_id,
    user_id,
    player_slot,
    last_seen_at
  )
  values (
    v_room.id,
    v_user_id,
    v_slot,
    now()
  );

  if v_room.host_user_id is null then
    update public.game_rooms
    set host_user_id = v_user_id
    where id = v_room.id
    returning * into v_room;
  end if;

  return v_room;
end;
$$;

create or replace function public.leave_game_room(p_room_id uuid)
returns public.game_rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.game_rooms;
  v_next_host uuid;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  select *
  into v_room
  from public.game_rooms
  where id = p_room_id
  for update;

  if not found then
    return null;
  end if;

  delete from public.room_players
  where room_id = p_room_id
    and user_id = v_user_id;

  select user_id
  into v_next_host
  from public.room_players
  where room_id = p_room_id
  order by joined_at asc, player_slot asc
  limit 1;

  if v_next_host is null then
    update public.game_rooms
    set host_user_id = null,
        status = 'ended',
        ended_at = coalesce(ended_at, now())
    where id = p_room_id
    returning * into v_room;
  elsif v_room.host_user_id = v_user_id
     or not exists (
       select 1
       from public.room_players
       where room_id = p_room_id
         and user_id = v_room.host_user_id
     ) then
    update public.game_rooms
    set host_user_id = v_next_host
    where id = p_room_id
    returning * into v_room;
  else
    select *
    into v_room
    from public.game_rooms
    where id = p_room_id;
  end if;

  return v_room;
end;
$$;

create or replace function public.heartbeat_game_room(p_room_id uuid)
returns public.game_rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.game_rooms;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  update public.room_players
  set last_seen_at = now()
  where room_id = p_room_id
    and user_id = v_user_id;

  if not found then
    raise exception 'You are no longer a member of this room.';
  end if;

  v_room := public.reconcile_game_room_state(p_room_id, 30);
  return v_room;
end;
$$;

create or replace function public.start_game_room(p_room_id uuid)
returns public.game_rooms
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_room public.game_rooms;
begin
  if v_user_id is null then
    raise exception 'You must be logged in.';
  end if;

  update public.room_players
  set last_seen_at = now()
  where room_id = p_room_id
    and user_id = v_user_id;

  v_room := public.reconcile_game_room_state(p_room_id, 30);

  if v_room is null or v_room.status = 'ended' then
    raise exception 'This room has ended.';
  end if;

  update public.game_rooms
  set status = 'playing',
      started_at = coalesce(started_at, now()),
      ended_at = null
  where id = p_room_id
    and host_user_id = v_user_id
    and status = 'waiting'
  returning * into v_room;

  if not found then
    raise exception 'Only the current host can start a waiting room.';
  end if;

  return v_room;
end;
$$;

revoke all on function public.reconcile_game_room_state(uuid, integer) from public, anon, authenticated;
revoke all on function public.create_game_room(text, bigint) from public, anon;
revoke all on function public.join_game_room(text) from public, anon;
revoke all on function public.leave_game_room(uuid) from public, anon;
revoke all on function public.heartbeat_game_room(uuid) from public, anon;
revoke all on function public.start_game_room(uuid) from public, anon;

grant execute on function public.create_game_room(text, bigint) to authenticated;
grant execute on function public.join_game_room(text) to authenticated;
grant execute on function public.leave_game_room(uuid) to authenticated;
grant execute on function public.heartbeat_game_room(uuid) to authenticated;
grant execute on function public.start_game_room(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime lobby updates
-- ---------------------------------------------------------------------------
alter table public.game_rooms replica identity full;
alter table public.room_players replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'game_rooms'
  ) then
    alter publication supabase_realtime add table public.game_rooms;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'room_players'
  ) then
    alter publication supabase_realtime add table public.room_players;
  end if;
end;
$$;
