-- Puzle de patrocinadores y colaboradores (más adelante, comercios colaboradores).
-- Cinco formatos (deslizar, encajar, girar, parejas, cambiar) y dos niveles (1 fácil, 2 difícil).
-- Cada partida se guarda en puzzle_plays (estadística interna de impactos; solo la ven los administradores).
-- El puzle del día da puntos una vez al día: settings.puntos.puzle (fácil, 3), puzle_dificil (5) y puzle_rapido (+2 si se hace por debajo del tiempo del formato).
create table if not exists public.puzzle_plays (
  id bigserial primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  sponsor text not null,
  daily boolean not null default false,
  mode text,
  level int,
  seconds int,
  moves int,
  points int not null default 0,
  played_at timestamptz not null default now()
);
alter table public.puzzle_plays add column if not exists mode text;
alter table public.puzzle_plays add column if not exists level int;
create index if not exists puzzle_plays_member_idx on public.puzzle_plays(member_id, played_at);
alter table public.puzzle_plays enable row level security;
drop policy if exists puzzle_plays_admin on public.puzzle_plays;
create policy puzzle_plays_admin on public.puzzle_plays for select using (public.is_admin());

drop function if exists public.puzzle_done(uuid, text, boolean, int, int);
create or replace function public.puzzle_done(p_member uuid, p_sponsor text, p_daily boolean, p_mode text, p_level int, p_seconds int, p_moves int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  today date := (now() at time zone 'Europe/Madrid')::date;
  cfg jsonb := coalesce((select value from settings where key = 'puntos'), '{}'::jsonb);
  lvl int := case when p_level = 2 then 2 else 1 end;
  lim int := case coalesce(p_mode, '')
               when 'deslizar' then case lvl when 2 then 240 else 90 end
               when 'encajar'  then case lvl when 2 then 150 else 60 end
               when 'girar'    then case lvl when 2 then 120 else 45 end
               when 'parejas'  then case lvl when 2 then 90  else 60 end
               else case lvl when 2 then 100 else 40 end end;
  pts int := 0; bonus int := 0; already boolean;
begin
  perform active_member(p_member);
  if (select count(*) from puzzle_plays where member_id = p_member and (played_at at time zone 'Europe/Madrid')::date = today) >= 40 then
    return jsonb_build_object('points', 0, 'already', true);
  end if;
  already := exists(select 1 from puzzle_plays where member_id = p_member and daily and points > 0
                    and (played_at at time zone 'Europe/Madrid')::date = today);
  if p_daily and not already and coalesce(p_seconds, 0) >= 5 then
    pts := case lvl when 2 then coalesce((cfg->>'puzle_dificil')::int, 5) else coalesce((cfg->>'puzle')::int, 3) end;
    if p_seconds <= lim then bonus := coalesce((cfg->>'puzle_rapido')::int, 2); end if;
    pts := pts + bonus;
    insert into points_ledger(member_id, delta, reason, ref) values (p_member, pts, 'Puzle del día', left(p_sponsor, 60));
  end if;
  insert into puzzle_plays(member_id, sponsor, daily, mode, level, seconds, moves, points)
    values (p_member, left(p_sponsor, 60), coalesce(p_daily, false), left(p_mode, 20), lvl, p_seconds, p_moves, pts);
  return jsonb_build_object('points', pts, 'bonus', bonus, 'already', p_daily and already);
end $$;
revoke all on function public.puzzle_done(uuid, text, boolean, text, int, int, int) from public, anon;
grant execute on function public.puzzle_done(uuid, text, boolean, text, int, int, int) to authenticated;
update settings set value = value || '{"puzle":3,"puzle_dificil":5,"puzle_rapido":2}'::jsonb where key = 'puntos' and not (value ? 'puzle_dificil');
