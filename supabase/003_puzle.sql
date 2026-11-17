-- Puzle de patrocinadores (y más adelante comercios colaboradores).
-- Cada partida se guarda en puzzle_plays (estadística interna de impactos por patrocinador; solo la ven los administradores).
-- El puzle del día da puntos una vez al día (settings.puntos.puzle, por defecto 3).
create table if not exists public.puzzle_plays (
  id bigserial primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  sponsor text not null,
  daily boolean not null default false,
  seconds int,
  moves int,
  points int not null default 0,
  played_at timestamptz not null default now()
);
create index if not exists puzzle_plays_member_idx on public.puzzle_plays(member_id, played_at);
alter table public.puzzle_plays enable row level security;
drop policy if exists puzzle_plays_admin on public.puzzle_plays;
create policy puzzle_plays_admin on public.puzzle_plays for select using (public.is_admin());

create or replace function public.puzzle_done(p_member uuid, p_sponsor text, p_daily boolean, p_seconds int, p_moves int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  today date := (now() at time zone 'Europe/Madrid')::date;
  pts int := 0;
  base int := coalesce(((select value from settings where key = 'puntos')->>'puzle')::int, 3);
  already boolean;
begin
  perform active_member(p_member);
  if (select count(*) from puzzle_plays where member_id = p_member and (played_at at time zone 'Europe/Madrid')::date = today) >= 40 then
    return jsonb_build_object('points', 0, 'already', true);
  end if;
  already := exists(select 1 from puzzle_plays where member_id = p_member and daily and points > 0
                    and (played_at at time zone 'Europe/Madrid')::date = today);
  if p_daily and not already and coalesce(p_seconds, 0) >= 5 then
    pts := base;
    insert into points_ledger(member_id, delta, reason, ref) values (p_member, pts, 'Puzle del día', left(p_sponsor, 60));
  end if;
  insert into puzzle_plays(member_id, sponsor, daily, seconds, moves, points)
    values (p_member, left(p_sponsor, 60), coalesce(p_daily, false), p_seconds, p_moves, pts);
  return jsonb_build_object('points', pts, 'already', p_daily and already);
end $$;
revoke all on function public.puzzle_done(uuid, text, boolean, int, int) from public, anon;
grant execute on function public.puzzle_done(uuid, text, boolean, int, int) to authenticated;
update settings set value = value || '{"puzle":3}'::jsonb where key = 'puntos' and not (value ? 'puzle');
