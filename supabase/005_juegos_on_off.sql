-- Activar o desactivar juegos desde Gestión → Juegos (settings.juegos). Si un juego está apagado,
-- no sale en el carnet y la base de datos no da puntos por él.
insert into public.settings(key, value) values ('juegos', '{"puzle":true,"penaltis":true,"toques":true,"ruleta":true,"porra":true}'::jsonb)
on conflict (key) do nothing;

create or replace function public.game_on(p_game text) returns void
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if coalesce(((select value from settings where key = 'juegos')->>p_game)::boolean, true) = false then
    raise exception 'Este juego no está activo ahora mismo';
  end if;
end $$;
revoke all on function public.game_on(text) from public, anon;
grant execute on function public.game_on(text) to authenticated;

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
  perform game_on('puzle');
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
  perform game_on(p_game);
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

create or replace function public.spin_wheel(p_member uuid)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  today date := (now() at time zone 'Europe/Madrid')::date;
  w jsonb := (select value->'ruleta' from settings where key = 'puntos');
  total int := 0; r int; acc int := 0; seg jsonb; pts int := 1; idx int := 0; i int := 0;
  streak int; gift record; won boolean := false;
begin
  perform active_member(p_member);
  perform game_on('ruleta');
  if exists(select 1 from spins where member_id = p_member and spin_date = today) then
    raise exception 'Ya has tirado hoy. Vuelve mañana';
  end if;
  select sum((x->>1)::int) into total from jsonb_array_elements(w) x;
  r := floor(random() * total)::int;
  for seg in select * from jsonb_array_elements(w) loop
    acc := acc + (seg->>1)::int;
    if r < acc then pts := (seg->>0)::int; idx := i; exit; end if;
    i := i + 1;
  end loop;
  select count(*) into streak from spins where member_id = p_member and spin_date between today - 6 and today - 1;
  if streak = 6 then pts := pts * 2; end if;
  select * into gift from weekly_gifts
   where week_start = date_trunc('week', today)::date and winner_member is null and release_at <= now() for update skip locked;
  if found then
    update weekly_gifts set winner_member = p_member, won_at = now() where week_start = gift.week_start;
    won := true;
  end if;
  insert into spins(member_id, spin_date, points, won_gift) values (p_member, today, pts, won);
  insert into points_ledger(member_id, delta, reason) values (p_member, pts, 'Ruleta diaria');
  return jsonb_build_object('points', pts, 'segment', idx, 'streak_bonus', streak = 6,
    'gift', case when won then gift.gift end, 'sponsor', case when won then gift.sponsor end);
end $function$;

create or replace function public.predict(p_member uuid, p_match bigint, p_for integer, p_against integer)
 returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  perform active_member(p_member);
  perform game_on('porra');
  if not exists(select 1 from matches m join teams t on t.id = m.team_id where m.id = p_match and t.is_flagship and m.starts_at > now() and not m.finished) then
    raise exception 'La porra de este partido ya está cerrada';
  end if;
  insert into predictions(match_id, member_id, goals_for, goals_against) values (p_match, p_member, p_for, p_against)
  on conflict (match_id, member_id) do update set goals_for = excluded.goals_for, goals_against = excluded.goals_against, created_at = now();
end $function$;
