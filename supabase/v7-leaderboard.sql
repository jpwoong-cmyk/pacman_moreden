-- P.A.C v7.0 leaderboard upgrade
-- Run this once in Supabase Dashboard -> SQL Editor for an existing project.

alter table public.profiles
  add column if not exists high_score integer not null default 0
  check (high_score >= 0);

create or replace function public.submit_pacman_score(
  p_score integer
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_safe_score integer := greatest(coalesce(p_score, 0), 0);
  v_high_score integer;
begin
  if v_user_id is null then
    raise exception 'You must be logged in to submit a score.';
  end if;

  update public.profiles
  set high_score = greatest(high_score, v_safe_score),
      total_score = total_score + v_safe_score,
      games_played = games_played + 1,
      updated_at = now()
  where id = v_user_id
  returning high_score into v_high_score;

  if v_high_score is null then
    raise exception 'Player profile was not found.';
  end if;

  return v_high_score;
end;
$$;

create or replace function public.get_pacman_high_scores(
  p_limit integer default 10
)
returns table (
  account_name text,
  high_score integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    profiles.account_name,
    profiles.high_score
  from public.profiles
  order by
    profiles.high_score desc,
    profiles.account_name asc
  limit greatest(1, least(coalesce(p_limit, 10), 20));
$$;

revoke all on function public.submit_pacman_score(integer) from public;
revoke all on function public.get_pacman_high_scores(integer) from public;

grant execute on function public.submit_pacman_score(integer) to authenticated;
grant execute on function public.get_pacman_high_scores(integer) to anon, authenticated;
