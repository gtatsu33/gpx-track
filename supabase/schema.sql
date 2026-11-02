-- =====================================================================
-- Pit Wall  Supabase スキーマ（APP_VERSION 1.0.0）
-- SQL Editor でこのファイルを丸ごと実行する。何度実行しても壊れないように書いている。
-- 実行後に set_owner_passcode.sql でオーナーパスコードを設定すること。
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- テーブル
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  owner_passcode_hash text not null
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  team_name text not null check (char_length(team_name) between 1 and 30),
  owner_id uuid references auth.users (id) on delete set null,
  duration_min int check (duration_min is null or duration_min between 1 and 10080),
  min_lap_sec int not null default 30 check (min_lap_sec between 10 and 600),
  moving_kmh int not null default 15 check (moving_kmh between 3 and 100),
  line_a_lat double precision,
  line_a_lng double precision,
  line_b_lat double precision,
  line_b_lng double precision,
  status text not null default 'ready' check (status in ('ready', 'running', 'finished')),
  started_at timestamptz,
  finished_at timestamptz,
  last_crosser_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  color_idx int not null default 0,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists room_members_user_idx on public.room_members (user_id);

create table if not exists public.crossings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  crosser_id uuid references auth.users (id) on delete set null,
  crosser_name text not null,
  crossed_at timestamptz not null,
  source text not null default 'gps' check (source in ('gps', 'manual')),
  driver_override_id uuid references auth.users (id) on delete set null,
  deleted boolean not null default false,
  created_at timestamptz not null default now()
);
-- 削除済みの行は重複チェックの対象外にするため、部分ユニークインデックスにする
create unique index if not exists crossings_room_time_uidx
  on public.crossings (room_id, crossed_at) where not deleted;

create table if not exists public.distance_segments (
  id bigserial primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  t_from timestamptz not null,
  t_to timestamptz not null,
  meters real not null check (meters > 0 and meters < 5000),
  check (t_to >= t_from and t_to - t_from <= interval '5 minutes')
);
create index if not exists distance_segments_room_t_idx on public.distance_segments (room_id, t_to);

create table if not exists public.messages (
  id bigserial primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  name text not null default '',
  body text not null check (char_length(body) between 1 and 50),
  kind text not null default 'user' check (kind in ('user', 'system')),
  created_at timestamptz not null default now()
);
create index if not exists messages_room_idx on public.messages (room_id, id desc);

-- ---------------------------------------------------------------------
-- 共通の関数
-- ---------------------------------------------------------------------
create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.room_members
    where room_id = p_room and user_id = (select auth.uid())
  );
$$;

create or replace function public.shares_room_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members a
    join public.room_members b on a.room_id = b.room_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user
  );
$$;

-- 内部用：オーナーでなければ例外
create or replace function public._require_owner(p_room uuid)
returns public.rooms
language plpgsql security definer set search_path = ''
as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found then raise exception 'room_not_found'; end if;
  if r.owner_id is distinct from auth.uid() then raise exception 'not_owner'; end if;
  return r;
end $$;

-- 内部用：Realtime（private チャネル room:<id>）へ配信。失敗しても本処理は止めない
create or replace function public._room_broadcast(p_room uuid, p_event text, p_payload jsonb)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform realtime.send(p_payload, p_event, 'room:' || p_room::text, true);
exception when others then
  raise warning 'realtime.send failed: %', sqlerrm;
end $$;

-- 内部用：システムメッセージの投稿
create or replace function public._post_system_message(p_room uuid, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.messages (room_id, user_id, name, body, kind)
  values (p_room, null, '', left(p_body, 50), 'system');
$$;

-- 内部用：6文字の参加コードを作る（I, O, 0, 1 は使わない）
create or replace function public._gen_room_code()
returns text
language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = c);
  end loop;
  return c;
end $$;

-- 内部用：オーナーパスコードの照合（失敗時は1秒待ってから例外）
create or replace function public._check_passcode(p_passcode text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare h text;
begin
  select owner_passcode_hash into h from public.app_config where id = 1;
  if h is null or p_passcode is null or extensions.crypt(p_passcode, h) <> h then
    perform pg_sleep(1);
    raise exception 'invalid_passcode';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.app_config enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.crossings enable row level security;
alter table public.distance_segments enable row level security;
alter table public.messages enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_room_with(id));
drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using (public.is_room_member(id));

drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists room_members_delete_self on public.room_members;
create policy room_members_delete_self on public.room_members for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists crossings_select on public.crossings;
create policy crossings_select on public.crossings for select to authenticated
  using (public.is_room_member(room_id));

drop policy if exists distance_segments_select on public.distance_segments;
create policy distance_segments_select on public.distance_segments for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists distance_segments_insert on public.distance_segments;
create policy distance_segments_insert on public.distance_segments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_room_member(room_id)
    and exists (select 1 from public.rooms r where r.id = room_id and r.status = 'running')
  );

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_room_member(room_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and kind = 'user'
    and public.is_room_member(room_id)
  );

-- ユーザーのメッセージの名前はサーバー側でプロフィールから入れる（なりすまし防止）
create or replace function public._messages_fill_name()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'user' then
    select name into new.name from public.profiles where id = new.user_id;
    new.name := coalesce(new.name, '');
    new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists messages_fill_name on public.messages;
create trigger messages_fill_name before insert on public.messages
  for each row execute function public._messages_fill_name();

-- ---------------------------------------------------------------------
-- DB の変更を Realtime に配信するトリガー
-- ---------------------------------------------------------------------
create or replace function public._bc_rooms()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public._room_broadcast(new.id, 'room', jsonb_build_object('id', new.id));
  return null;
end $$;
drop trigger if exists bc_rooms on public.rooms;
create trigger bc_rooms after update on public.rooms
  for each row execute function public._bc_rooms();

create or replace function public._bc_crossings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public._room_broadcast(new.room_id, 'crossing', jsonb_build_object('id', new.id));
  return null;
end $$;
drop trigger if exists bc_crossings on public.crossings;
create trigger bc_crossings after insert or update on public.crossings
  for each row execute function public._bc_crossings();

create or replace function public._bc_messages()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public._room_broadcast(new.room_id, 'message', to_jsonb(new));
  return null;
end $$;
drop trigger if exists bc_messages on public.messages;
create trigger bc_messages after insert on public.messages
  for each row execute function public._bc_messages();

create or replace function public._bc_members()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rid uuid := coalesce(new.room_id, old.room_id);
begin
  perform public._room_broadcast(rid, 'member', jsonb_build_object('room_id', rid));
  return null;
end $$;
drop trigger if exists bc_members on public.room_members;
create trigger bc_members after insert or update or delete on public.room_members
  for each row execute function public._bc_members();

-- プロフィール名の変更も、所属ルームへ member イベントとして配信する
create or replace function public._bc_profiles()
returns trigger language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  for rid in select room_id from public.room_members where user_id = new.id loop
    perform public._room_broadcast(rid, 'member', jsonb_build_object('room_id', rid));
  end loop;
  return null;
end $$;
drop trigger if exists bc_profiles on public.profiles;
create trigger bc_profiles after update on public.profiles
  for each row execute function public._bc_profiles();

-- ---------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------
create or replace function public.update_profile_name(p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare n text := btrim(p_name);
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if n is null or char_length(n) not between 1 and 20 then raise exception 'invalid_name'; end if;
  insert into public.profiles (id, name) values (auth.uid(), n)
  on conflict (id) do update set name = excluded.name, updated_at = now();
end $$;

create or replace function public.create_room(
  p_passcode text, p_team_name text, p_duration_min int, p_min_lap_sec int, p_moving_kmh int
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.rooms;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public._check_passcode(p_passcode);
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'no_profile'; end if;
  insert into public.rooms (code, team_name, owner_id, duration_min, min_lap_sec, moving_kmh)
  values (public._gen_room_code(), btrim(p_team_name), uid, p_duration_min,
          coalesce(p_min_lap_sec, 30), coalesce(p_moving_kmh, 15))
  returning * into r;
  insert into public.room_members (room_id, user_id, color_idx) values (r.id, uid, 0);
  return jsonb_build_object('id', r.id, 'code', r.code);
end $$;

create or replace function public.join_room(p_code text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not exists (select 1 from public.profiles where id = uid) then raise exception 'no_profile'; end if;
  select id into rid from public.rooms where code = upper(btrim(p_code));
  if rid is null then raise exception 'room_not_found'; end if;
  insert into public.room_members (room_id, user_id, color_idx)
  values (rid, uid, (select coalesce(max(color_idx) + 1, 0) from public.room_members where room_id = rid))
  on conflict (room_id, user_id) do nothing;
  return rid;
end $$;

create or replace function public.reclaim_owner(p_code text, p_passcode text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public._check_passcode(p_passcode);
  rid := public.join_room(p_code);
  update public.rooms set owner_id = uid where id = rid;
  return rid;
end $$;

create or replace function public.set_line(p_room uuid, p_a_lat double precision, p_a_lng double precision,
                                           p_b_lat double precision, p_b_lng double precision)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_owner(p_room);
  update public.rooms
     set line_a_lat = p_a_lat, line_a_lng = p_a_lng, line_b_lat = p_b_lat, line_b_lng = p_b_lng
   where id = p_room;
end $$;

create or replace function public.update_room_settings(p_room uuid, p_min_lap_sec int, p_moving_kmh int)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public._require_owner(p_room);
  update public.rooms set min_lap_sec = p_min_lap_sec, moving_kmh = p_moving_kmh where id = p_room;
end $$;

create or replace function public.start_race(p_room uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.rooms;
begin
  r := public._require_owner(p_room);
  if r.status <> 'ready' then raise exception 'invalid_status'; end if;
  update public.rooms set status = 'running', started_at = now(), finished_at = null where id = p_room;
  perform public._post_system_message(p_room, 'レース開始');
end $$;

create or replace function public.set_start_time(p_room uuid, p_ts timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.rooms;
begin
  r := public._require_owner(p_room);
  if r.status = 'ready' then raise exception 'invalid_status'; end if;
  if p_ts > now() then raise exception 'invalid_time'; end if;
  if exists (select 1 from public.crossings where room_id = p_room and not deleted and crossed_at <= p_ts) then
    raise exception 'invalid_time';
  end if;
  update public.rooms set started_at = p_ts where id = p_room;
  -- 1周目のラップタイムが変わるので、ラップ表の再取得を促す
  perform public._room_broadcast(p_room, 'crossing', jsonb_build_object('id', null));
end $$;

create or replace function public.finish_race(p_room uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.rooms;
begin
  r := public._require_owner(p_room);
  if r.status <> 'running' then raise exception 'invalid_status'; end if;
  update public.rooms set status = 'finished', finished_at = now() where id = p_room;
  perform public._post_system_message(p_room, 'レース終了');
end $$;

create or replace function public._refresh_last_crosser(p_room uuid)
returns void
language sql security definer set search_path = ''
as $$
  -- 値が変わるときだけ更新する（rooms の更新は全員に配信されるため）
  with latest as (
    select (select crosser_id from public.crossings
            where room_id = p_room and not deleted
            order by crossed_at desc limit 1) as cid
  )
  update public.rooms r set last_crosser_id = latest.cid
    from latest
   where r.id = p_room and r.last_crosser_id is distinct from latest.cid;
$$;

create or replace function public.record_crossing(p_room uuid, p_crossed_at timestamptz)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.rooms;
  uname text;
  prev_crosser uuid;
begin
  if uid is null or not public.is_room_member(p_room) then raise exception 'not_member'; end if;

  -- 同時通過の競合を防ぐためルーム行をロック
  select * into r from public.rooms where id = p_room for update;
  if r.status <> 'running' then return 'not_running'; end if;

  if exists (select 1 from public.crossings
             where room_id = p_room and crosser_id = uid and crossed_at = p_crossed_at and not deleted) then
    return 'duplicate';
  end if;

  if p_crossed_at < r.started_at or p_crossed_at > now() + interval '5 seconds' then
    return 'out_of_range';
  end if;

  -- レース開始時刻と前後の通過から、最小ラップ秒数以上離れていること
  if p_crossed_at - r.started_at < make_interval(secs => r.min_lap_sec)
     or exists (select 1 from public.crossings
                where room_id = p_room and not deleted
                  and crossed_at > p_crossed_at - make_interval(secs => r.min_lap_sec)
                  and crossed_at < p_crossed_at + make_interval(secs => r.min_lap_sec)) then
    return 'too_soon';
  end if;

  select name into uname from public.profiles where id = uid;
  select crosser_id into prev_crosser from public.crossings
   where room_id = p_room and not deleted and crossed_at < p_crossed_at
   order by crossed_at desc limit 1;

  begin
    insert into public.crossings (room_id, crosser_id, crosser_name, crossed_at, source)
    values (p_room, uid, coalesce(uname, '?'), p_crossed_at, 'gps');
  exception when unique_violation then
    return 'too_soon';
  end;

  perform public._refresh_last_crosser(p_room);

  if prev_crosser is not null and prev_crosser <> uid then
    perform public._post_system_message(p_room, 'ライダー交代：' || coalesce(uname, '?'));
  end if;

  return 'recorded';
end $$;

create or replace function public.add_manual_crossing(p_room uuid, p_crossed_at timestamptz)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  r public.rooms;
  cid uuid;
  cname text;
begin
  r := public._require_owner(p_room);
  if r.status = 'ready' then raise exception 'invalid_status'; end if;
  if p_crossed_at <= r.started_at or p_crossed_at > now() + interval '5 seconds' then
    raise exception 'invalid_time';
  end if;
  -- その時刻の直前に通過した人（いなければ現在の last_crosser、さらにいなければオーナー）
  select crosser_id into cid from public.crossings
   where room_id = p_room and not deleted and crossed_at < p_crossed_at
   order by crossed_at desc limit 1;
  cid := coalesce(cid, r.last_crosser_id, auth.uid());
  select name into cname from public.profiles where id = cid;
  begin
    insert into public.crossings (room_id, crosser_id, crosser_name, crossed_at, source)
    values (p_room, cid, coalesce(cname, '?'), p_crossed_at, 'manual');
  exception when unique_violation then
    raise exception 'duplicate_time';
  end;
  perform public._refresh_last_crosser(p_room);
end $$;

create or replace function public.delete_crossing(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare rid uuid;
begin
  select room_id into rid from public.crossings where id = p_id;
  if rid is null then raise exception 'not_found'; end if;
  perform public._require_owner(rid);
  update public.crossings set deleted = true where id = p_id;
  perform public._refresh_last_crosser(rid);
end $$;

create or replace function public.set_crossing_driver(p_id uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare rid uuid;
begin
  select room_id into rid from public.crossings where id = p_id;
  if rid is null then raise exception 'not_found'; end if;
  perform public._require_owner(rid);
  if p_user is not null and not exists (
    select 1 from public.room_members where room_id = rid and user_id = p_user
  ) then
    raise exception 'not_member';
  end if;
  update public.crossings set driver_override_id = p_user where id = p_id;
end $$;

-- ラップ表（周番号・ラップタイム・ライダーをサーバー側で計算）
create or replace function public.get_lap_table(p_room uuid)
returns table (
  lap_no int,
  crossing_id uuid,
  crossed_at timestamptz,
  lap_ms bigint,
  driver_id uuid,
  driver_name text,
  driver_meters double precision,
  source text,
  is_override boolean,
  crosser_id uuid
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_room_member(p_room) then raise exception 'not_member'; end if;
  return query
  with c as (
    select x.id, x.crossed_at, x.crosser_id, x.crosser_name, x.source, x.driver_override_id,
           row_number() over (order by x.crossed_at)::int as n,
           coalesce(lag(x.crossed_at) over (order by x.crossed_at),
                    (select r.started_at from public.rooms r where r.id = p_room)) as lap_start
    from public.crossings x
    where x.room_id = p_room and not x.deleted
  ),
  d as (
    select c.id as cid, s.user_id,
           sum(
             s.meters * greatest(0, extract(epoch from (least(s.t_to, c.crossed_at) - greatest(s.t_from, c.lap_start))))
             / greatest(extract(epoch from (s.t_to - s.t_from)), 0.001)
           )::double precision as m
    from c
    join public.distance_segments s
      on s.room_id = p_room and s.t_to > c.lap_start and s.t_from < c.crossed_at
    group by c.id, s.user_id
  ),
  best as (
    select distinct on (d.cid) d.cid, d.user_id, d.m
    from d join c on c.id = d.cid
    where d.m > 0
    order by d.cid, d.m desc, (d.user_id = c.crosser_id) desc
  )
  select c.n,
         c.id,
         c.crossed_at,
         round(extract(epoch from (c.crossed_at - c.lap_start)) * 1000)::bigint,
         coalesce(c.driver_override_id, best.user_id, c.crosser_id),
         coalesce(p.name, c.crosser_name),
         dm.m,
         c.source,
         c.driver_override_id is not null,
         c.crosser_id
  from c
  left join best on best.cid = c.id
  left join public.profiles p on p.id = coalesce(c.driver_override_id, best.user_id, c.crosser_id)
  left join d dm on dm.cid = c.id and dm.user_id = coalesce(c.driver_override_id, best.user_id, c.crosser_id)
  order by c.n;
end $$;

-- ---------------------------------------------------------------------
-- 関数の実行権限（匿名キーのままでは実行させず、サインイン済みユーザーだけに許可）
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'is_room_member', 'shares_room_with', '_require_owner', '_room_broadcast', '_post_system_message',
      '_gen_room_code', '_check_passcode', '_messages_fill_name', '_bc_rooms', '_bc_crossings',
      '_bc_messages', '_bc_members', '_bc_profiles', '_refresh_last_crosser',
      'update_profile_name', 'create_room', 'join_room', 'reclaim_owner', 'set_line',
      'update_room_settings', 'start_race', 'set_start_time', 'finish_race', 'record_crossing',
      'add_manual_crossing', 'delete_crossing', 'set_crossing_driver', 'get_lap_table')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname not like '\_%' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Realtime Authorization（private チャネル room:<room_id>）
-- realtime.messages には ALTER TABLE をかけないこと（RLS は既に有効）
-- ---------------------------------------------------------------------
drop policy if exists "pitwall members can receive" on realtime.messages;
create policy "pitwall members can receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_members m
      where m.user_id = (select auth.uid())
        and 'room:' || m.room_id::text = (select realtime.topic())
    )
  );

drop policy if exists "pitwall members can send" on realtime.messages;
create policy "pitwall members can send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_members m
      where m.user_id = (select auth.uid())
        and 'room:' || m.room_id::text = (select realtime.topic())
    )
  );
