-- Minijuegos de fútbol sala: penaltis y toques (más adelante portero, regate y diana).
-- Puntos al día por juego según la mejor marca del día (si mejoras, se suma la diferencia):
--   penaltis: settings.puntos.penaltis_gol (1) por gol + penaltis_pleno (3) si metes los 5
--   toques:   1 punto cada settings.puntos.toques_cada (5) toques, hasta toques_max (8)
-- Ranking semanal (lunes a domingo, hora de Madrid) con la mejor marca de cada socio.
create table if not exists public.game_plays (
  id bigserial primary key,
  member_id uuid not null references public.members(id) on delete cascade,
  game text not null,
  score int not null,
  seconds int,
  points int not null default 0,
  played_at timestamptz not null default now()
);
create index if not exists game_plays_idx on public.game_plays(game, played_at);
create index if not exists game_plays_member_idx on public.game_plays(member_id, game, played_at);
alter table public.game_plays enable row level security;
drop policy if exists game_plays_admin on public.game_plays;
create policy game_plays_admin on public.game_plays for select using (public.is_admin());

create or replace function public.game_done(p_member uuid, p_game text, p_score int, p_seconds int)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  today date := (now() at time zone 'Europe/Madrid')::date;
  cfg jsonb := coalesce((select value from settings where key = 'puntos'), '{}'::jsonb);
  sc int := greatest(coalesce(p_score, 0), 0);
  worth int := 0; got int; pts int := 0; best int;
begin
  perform active_member(p_member);
  if p_game not in ('penaltis', 'toques') then raise exception 'Juego desconocido'; end if;
  if (select count(*) from game_plays where member_id = p_member and (played_at at time zone 'Europe/Madrid')::date = today) >= 60 then
    return jsonb_build_object('points', 0, 'limit', true);
  end if;
  if p_game = 'penaltis' then
    if sc > 5 or coalesce(p_seconds, 0) < 6 then sc := least(sc, 5); end if;
    worth := sc * coalesce((cfg->>'penaltis_gol')::int, 1) + case when sc = 5 then coalesce((cfg->>'penaltis_pleno')::int, 3) else 0 end;
  else
    if sc > coalesce(p_seconds, 0) * 6 + 5 or sc > 3000 then raise exception 'Marca no válida'; end if;
    worth := least(sc / greatest(coalesce((cfg->>'toques_cada')::int, 5), 1), coalesce((cfg->>'toques_max')::int, 8));
  end if;
  select coalesce(sum(points), 0) into got from game_plays
   where member_id = p_member and game = p_game and (played_at at time zone 'Europe/Madrid')::date = today;
  pts := greatest(worth - got, 0);
  if pts > 0 then
    insert into points_ledger(member_id, delta, reason, ref) values (p_member, pts, case p_game when 'penaltis' then 'Penaltis' else 'Toques' end, sc::text);
  end if;
  insert into game_plays(member_id, game, score, seconds, points) values (p_member, p_game, sc, p_seconds, pts);
  select max(score) into best from game_plays where member_id = p_member and game = p_game
    and played_at >= (date_trunc('week', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid');
  return jsonb_build_object('points', pts, 'today', got + pts, 'best_week', best);
end $$;

create or replace function public.game_ranking(p_game text)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select m.first_name || ' ' || left(m.last_name, 1) || '.' as name, max(g.score)::int as best
    from game_plays g join members m on m.id = g.member_id
    where g.game = p_game and g.played_at >= (date_trunc('week', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid')
    group by m.id, m.first_name, m.last_name having max(g.score) > 0
    order by best desc, min(g.played_at) limit 10) x
$$;
revoke all on function public.game_done(uuid, text, int, int) from public, anon;
revoke all on function public.game_ranking(text) from public, anon;
grant execute on function public.game_done(uuid, text, int, int) to authenticated;
grant execute on function public.game_ranking(text) to authenticated;
update settings set value = value || '{"penaltis_gol":1,"penaltis_pleno":3,"toques_cada":5,"toques_max":8}'::jsonb
 where key = 'puntos' and not (value ? 'penaltis_gol');
