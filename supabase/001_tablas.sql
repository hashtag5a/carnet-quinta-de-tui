-- Carnet de socio Quinta de Tui Futsal · Fase 1
create extension if not exists pgcrypto;

-- ===== Tablas =====
create table public.settings (key text primary key, value jsonb not null);

create table public.admins (user_id uuid primary key references auth.users on delete cascade, created_at timestamptz default now());

create table public.teams (
  id bigint generated always as identity primary key,
  name text not null,
  category text,
  federation_url text,
  is_flagship boolean not null default false, -- senior preferente: puntos dobles
  sort int not null default 0,
  active boolean not null default true
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  member_no int generated always as identity unique,
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  birth_date date,
  relation text not null default 'aficionado' check (relation in ('jugador','familiar','aficionado')),
  consent_comms boolean not null default false,
  consent_at timestamptz,
  status text not null default 'pendiente' check (status in ('pendiente','activo','caducado','baja')),
  price numeric(6,2) not null default 12,
  is_protector boolean not null default false,
  paid_until date,
  last_birthday_award int,
  created_at timestamptz not null default now()
);
create index on public.members(owner_id);

create table public.member_teams (
  member_id uuid references public.members on delete cascade,
  team_id bigint references public.teams on delete cascade,
  primary key (member_id, team_id)
);

create table public.matches (
  id bigint generated always as identity primary key,
  team_id bigint not null references public.teams on delete cascade,
  starts_at timestamptz not null,
  is_home boolean not null default true,
  rival text not null,
  venue text,
  goals_for int,
  goals_against int,
  finished boolean not null default false,
  settled boolean not null default false,
  attendance_code text unique default encode(gen_random_bytes(6),'hex'),
  source_ref text unique
);
create index on public.matches(team_id, starts_at);

create table public.merchants (
  id bigint generated always as identity primary key,
  name text not null,
  category text,
  discount text not null,
  address text,
  phone text,
  web text,
  logo_url text,
  contact_name text,
  contact_email text,
  approved boolean not null default false,
  active boolean not null default true,
  scan_code text not null unique default encode(gen_random_bytes(6),'hex'),
  created_at timestamptz not null default now()
);

create table public.points_ledger (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members on delete cascade,
  delta int not null,
  reason text not null,
  ref text,
  created_at timestamptz not null default now()
);
create index on public.points_ledger(member_id);

create table public.prizes (
  id bigint generated always as identity primary key,
  name text not null,
  description text,
  cost_points int not null check (cost_points > 0),
  stock int,
  sponsor text,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.redemptions (
  id bigint generated always as identity primary key,
  member_id uuid not null references public.members on delete cascade,
  prize_id bigint not null references public.prizes,
  status text not null default 'pendiente' check (status in ('pendiente','entregado','anulado')),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table public.spins (
  member_id uuid references public.members on delete cascade,
  spin_date date not null,
  points int not null,
  won_gift boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (member_id, spin_date)
);

create table public.weekly_gifts (
  week_start date primary key,
  gift text not null,
  sponsor text,
  release_at timestamptz not null,
  winner_member uuid references public.members on delete set null,
  won_at timestamptz,
  delivered boolean not null default false
);

create table public.predictions (
  match_id bigint references public.matches on delete cascade,
  member_id uuid references public.members on delete cascade,
  goals_for int not null check (goals_for between 0 and 30),
  goals_against int not null check (goals_against between 0 and 30),
  points int,
  created_at timestamptz not null default now(),
  primary key (match_id, member_id)
);

create table public.porra_jackpots (
  match_id bigint primary key references public.matches on delete cascade,
  gift text not null,
  winner_member uuid references public.members on delete set null,
  delivered boolean not null default false
);

create table public.attendance (
  member_id uuid references public.members on delete cascade,
  match_id bigint references public.matches on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, match_id)
);

create table public.merchant_scans (
  member_id uuid references public.members on delete cascade,
  merchant_id bigint references public.merchants on delete cascade,
  scan_date date not null default (now() at time zone 'Europe/Madrid')::date,
  created_at timestamptz not null default now(),
  primary key (member_id, merchant_id, scan_date)
);

-- Datos importados de Clubber (solo admin). Se usan para rellenar el alta por email verificado.
create table public.clubber_import (
  id bigint generated always as identity primary key,
  email text,
  phone text,
  first_name text,
  last_name text,
  birth_date date,
  team_name text
);
create index on public.clubber_import(lower(email));

-- ===== Seguridad =====
alter table public.settings enable row level security;
alter table public.admins enable row level security;
alter table public.teams enable row level security;
alter table public.members enable row level security;
alter table public.member_teams enable row level security;
alter table public.matches enable row level security;
alter table public.merchants enable row level security;
alter table public.points_ledger enable row level security;
alter table public.prizes enable row level security;
alter table public.redemptions enable row level security;
alter table public.spins enable row level security;
alter table public.weekly_gifts enable row level security;
alter table public.predictions enable row level security;
alter table public.porra_jackpots enable row level security;
alter table public.attendance enable row level security;
alter table public.merchant_scans enable row level security;
alter table public.clubber_import enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from admins where user_id = auth.uid()) $$;

create policy "settings lectura" on public.settings for select using (true);
create policy "settings admin" on public.settings for all using (is_admin()) with check (is_admin());
create policy "admins ver" on public.admins for select using (is_admin());
create policy "teams lectura" on public.teams for select using (true);
create policy "teams admin" on public.teams for all using (is_admin()) with check (is_admin());
create policy "matches lectura" on public.matches for select using (true);
create policy "matches admin" on public.matches for all using (is_admin()) with check (is_admin());
create policy "merchants lectura" on public.merchants for select using ((approved and active) or is_admin());
create policy "merchants admin" on public.merchants for all using (is_admin()) with check (is_admin());
create policy "prizes lectura" on public.prizes for select using (active or is_admin());
create policy "prizes admin" on public.prizes for all using (is_admin()) with check (is_admin());
create policy "members propios" on public.members for select using (owner_id = auth.uid() or is_admin());
create policy "members admin" on public.members for update using (is_admin()) with check (is_admin());
create policy "member_teams propios" on public.member_teams for select using (is_admin() or exists(select 1 from members m where m.id = member_id and m.owner_id = auth.uid()));
create policy "ledger propio" on public.points_ledger for select using (is_admin() or exists(select 1 from members m where m.id = member_id and m.owner_id = auth.uid()));
create policy "redemptions propias" on public.redemptions for select using (is_admin() or exists(select 1 from members m where m.id = member_id and m.owner_id = auth.uid()));
create policy "spins propias" on public.spins for select using (is_admin() or exists(select 1 from members m where m.id = member_id and m.owner_id = auth.uid()));
create policy "predictions propias" on public.predictions for select using (is_admin() or exists(select 1 from members m where m.id = member_id and m.owner_id = auth.uid()));
create policy "attendance propia" on public.attendance for select using (is_admin() or exists(select 1 from members m where m.id = member_id and m.owner_id = auth.uid()));
create policy "scans propios" on public.merchant_scans for select using (is_admin() or exists(select 1 from members m where m.id = member_id and m.owner_id = auth.uid()));
create policy "gifts admin" on public.weekly_gifts for all using (is_admin()) with check (is_admin());
create policy "jackpots admin" on public.porra_jackpots for all using (is_admin()) with check (is_admin());
create policy "clubber admin" on public.clubber_import for all using (is_admin()) with check (is_admin());

-- Los códigos secretos de comercios y partidos no se exponen a socios
revoke select on public.merchants from anon, authenticated;
grant select (id,name,category,discount,address,phone,web,logo_url,approved,active,created_at) on public.merchants to anon, authenticated;
revoke select on public.matches from anon, authenticated;
grant select (id,team_id,starts_at,is_home,rival,venue,goals_for,goals_against,finished) on public.matches to anon, authenticated;

-- ===== Ajustes iniciales =====
insert into public.settings(key,value) values
 ('precios', '{"individual":12,"familiar":6,"protector":[30,50]}'),
 ('puntos', '{"ruleta":[[1,30],[2,25],[3,20],[5,14],[10,8],[25,3]],"porra_ganador":3,"porra_exacto":10,"comercio":15,"asistencia":10,"multiplicador_preferente":2,"cumple":25}'),
 ('club', '{"nombre":"Quinta de Tui Futsal","campus_descuento":10}');

