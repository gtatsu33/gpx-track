-- =====================================================================
-- gpx-track  Supabase スキーマ（APP_VERSION 1.1.0）
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

-- ライダーの名簿（v1.1.0）。端末（匿名ユーザー）とは別に、ルームごとに持つ
create table if not exists public.riders (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 20),
  -- 参加したときに自動で作った「本人のライダー」なら、その端末のユーザー。名簿から追加した人は null
  user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (room_id, name)
);
create index if not exists riders_user_idx on public.riders (user_id);

alter table public.rooms add column if not exists owner_rider_id uuid references public.riders (id) on delete set null;
alter table public.rooms add column if not exists last_crosser_rider_id uuid references public.riders (id) on delete set null;
alter table public.room_members add column if not exists current_rider_id uuid references public.riders (id) on delete set null;
alter table public.crossings add column if not exists rider_id uuid references public.riders (id) on delete set null;
alter table public.crossings add column if not exists driver_override_rider_id uuid references public.riders (id) on delete set null;
alter table public.distance_segments add column if not exists rider_id uuid references public.riders (id) on delete cascade;

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

-- 内部用：オーナーモードでなければ例外
-- オーナーモード＝その端末の今のライダーが、ルームのオーナーのライダーであること
create or replace function public._require_owner(p_room uuid)
returns public.rooms
language plpgsql security definer set search_path = ''
as $$
declare r public.rooms;
begin
  select * into r from public.rooms where id = p_room;
  if not found then raise exception 'room_not_found'; end if;
  if r.owner_rider_id is null or not exists (
    select 1 from public.room_members m
    where m.room_id = p_room and m.user_id = auth.uid() and m.current_rider_id = r.owner_rider_id
  ) then
    raise exception 'not_owner';
  end if;
  return r;
end $$;

-- 内部用：ルーム内で重複しないライダー名を作る（同じ名前があれば末尾に 2, 3, ... を付ける）
create or replace function public._unique_rider_name(p_room uuid, p_base text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  base text := coalesce(nullif(btrim(p_base), ''), '?');
  n text := left(base, 20);
  i int := 2;
begin
  while exists (select 1 from public.riders where room_id = p_room and name = n) loop
    n := left(base, 20 - length(i::text)) || i::text;
    i := i + 1;
  end loop;
  return n;
end $$;

-- 内部用：参加した端末に「本人のライダー」を割り当てて、今のライダーにする
-- 優先順：その端末の本人のライダー → プロフィールと同じ名前のライダー → 新しく作る
-- オーナーのライダーはパスコードが必要なので、ここでは選ばない
create or replace function public._assign_own_rider(p_room uuid, p_user uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o uuid;
  rid uuid;
  pname text;
begin
  select owner_rider_id into o from public.rooms where id = p_room;
  select name into pname from public.profiles where id = p_user;
  select id into rid from public.riders
   where room_id = p_room and user_id = p_user and id is distinct from o
   order by created_at limit 1;
  if rid is null then
    select id into rid from public.riders
     where room_id = p_room and name = btrim(pname) and id is distinct from o;
  end if;
  if rid is null then
    insert into public.riders (room_id, name, user_id)
    values (p_room, public._unique_rider_name(p_room, pname), p_user)
    returning id into rid;
  end if;
  update public.room_members set current_rider_id = rid where room_id = p_room and user_id = p_user;
  return rid;
end $$;

-- 内部用：その端末の今のライダー
create or replace function public._current_rider(p_room uuid, p_user uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select current_rider_id from public.room_members where room_id = p_room and user_id = p_user;
$$;

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
alter table public.riders enable row level security;

drop policy if exists riders_select on public.riders;
create policy riders_select on public.riders for select to authenticated
  using (public.is_room_member(room_id));

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

-- ユーザーのメッセージの名前はサーバー側で入れる（なりすまし防止）
-- その端末の今のライダーの名前。なければプロフィールの名前
create or replace function public._messages_fill_name()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.kind = 'user' then
    new.name := coalesce(
      (select rd.name from public.room_members m join public.riders rd on rd.id = m.current_rider_id
        where m.room_id = new.room_id and m.user_id = new.user_id),
      (select name from public.profiles where id = new.user_id),
      '');
    new.created_at := now();
  end if;
  return new;
end $$;
drop trigger if exists messages_fill_name on public.messages;
create trigger messages_fill_name before insert on public.messages
  for each row execute function public._messages_fill_name();

-- 走行距離のライダー：送られてきた rider_id がルームのライダーでなければ、その端末の今のライダーにする
create or replace function public._segments_fill_rider()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.rider_id is null
     or not exists (select 1 from public.riders where id = new.rider_id and room_id = new.room_id) then
    new.rider_id := public._current_rider(new.room_id, new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists segments_fill_rider on public.distance_segments;
create trigger segments_fill_rider before insert on public.distance_segments
  for each row execute function public._segments_fill_rider();

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

-- 名簿の追加・名前の変更も member イベントとして配信する
create or replace function public._bc_riders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public._room_broadcast(new.room_id, 'member', jsonb_build_object('room_id', new.room_id));
  return null;
end $$;
drop trigger if exists bc_riders on public.riders;
create trigger bc_riders after insert or update on public.riders
  for each row execute function public._bc_riders();

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
  rid uuid;
  pname text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public._check_passcode(p_passcode);
  select name into pname from public.profiles where id = uid;
  if pname is null then raise exception 'no_profile'; end if;
  insert into public.rooms (code, team_name, owner_id, duration_min, min_lap_sec, moving_kmh)
  values (public._gen_room_code(), btrim(p_team_name), uid, p_duration_min,
          coalesce(p_min_lap_sec, 30), coalesce(p_moving_kmh, 15))
  returning * into r;
  -- 作った人の本人のライダーを、オーナーのライダーにする
  insert into public.riders (room_id, name, user_id) values (r.id, pname, uid) returning id into rid;
  update public.rooms set owner_rider_id = rid where id = r.id;
  insert into public.room_members (room_id, user_id, color_idx, current_rider_id) values (r.id, uid, 0, rid);
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
  if public._current_rider(rid, uid) is null then
    perform public._assign_own_rider(rid, uid);
  end if;
  return rid;
end $$;

-- オーナー権限の復帰：参加して、オーナーのライダーに切り替える
create or replace function public.reclaim_owner(p_code text, p_passcode text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rid uuid;
  o uuid;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public._check_passcode(p_passcode);
  rid := public.join_room(p_code);
  select owner_rider_id into o from public.rooms where id = rid;
  if o is null then
    -- オーナーのライダーがない古いルームは、この端末の今のライダーをオーナーにする
    update public.rooms set owner_rider_id = public._current_rider(rid, uid) where id = rid;
  else
    update public.room_members set current_rider_id = o
     where room_id = rid and user_id = uid and current_rider_id is distinct from o;
  end if;
  return rid;
end $$;

-- この端末のライダーを切り替える。オーナーのライダーにはパスコードが必要
create or replace function public.switch_rider(p_room uuid, p_rider uuid, p_passcode text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.rooms;
begin
  if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'not_member'; end if;
  select * into r from public.rooms where id = p_room;
  if not exists (select 1 from public.riders where id = p_rider and room_id = p_room) then
    raise exception 'not_rider';
  end if;
  if p_rider = r.owner_rider_id then
    perform public._check_passcode(p_passcode);
  end if;
  update public.room_members set current_rider_id = p_rider
   where room_id = p_room and user_id = auth.uid() and current_rider_id is distinct from p_rider;
end $$;

-- 名簿にライダーを追加し、この端末の今のライダーにする
create or replace function public.add_rider(p_room uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  n text := btrim(p_name);
  rid uuid;
begin
  if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'not_member'; end if;
  if n is null or char_length(n) not between 1 and 20 then raise exception 'invalid_name'; end if;
  if exists (select 1 from public.riders where room_id = p_room and name = n) then
    raise exception 'duplicate_name';
  end if;
  insert into public.riders (room_id, name, user_id) values (p_room, n, null) returning id into rid;
  update public.room_members set current_rider_id = rid where room_id = p_room and user_id = auth.uid();
  return rid;
end $$;

-- この端末の今のライダーの名前を変える
create or replace function public.rename_rider(p_room uuid, p_name text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  n text := btrim(p_name);
  rid uuid;
begin
  if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'not_member'; end if;
  if n is null or char_length(n) not between 1 and 20 then raise exception 'invalid_name'; end if;
  rid := public._current_rider(p_room, auth.uid());
  if rid is null then raise exception 'not_rider'; end if;
  if exists (select 1 from public.riders where room_id = p_room and name = n and id <> rid) then
    raise exception 'duplicate_name';
  end if;
  update public.riders set name = n where id = rid and name <> n;
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
    select x.crosser_id as cid, x.rider_id as rid
    from (select 1) one
    left join lateral (
      select crosser_id, rider_id from public.crossings
       where room_id = p_room and not deleted
       order by crossed_at desc limit 1
    ) x on true
  )
  update public.rooms r set last_crosser_id = latest.cid, last_crosser_rider_id = latest.rid
    from latest
   where r.id = p_room
     and (r.last_crosser_id is distinct from latest.cid or r.last_crosser_rider_id is distinct from latest.rid);
$$;

-- v1.0.x の引数（p_room, p_crossed_at）の版を削除（引数の数が違う関数が並ぶと呼び出しがあいまいになるため）
drop function if exists public.record_crossing(uuid, timestamptz);

-- p_rider：通過した瞬間のその端末のライダー（再送で遅れて届くことがあるため端末から送る）。
--          null かルームのライダーでなければ、その端末の今のライダーにする
create or replace function public.record_crossing(p_room uuid, p_crossed_at timestamptz, p_rider uuid default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  r public.rooms;
  rider uuid;
  uname text;
  prev_rider uuid;
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

  if p_rider is not null and exists (select 1 from public.riders where id = p_rider and room_id = p_room) then
    rider := p_rider;
  else
    rider := public._current_rider(p_room, uid);
  end if;
  select coalesce((select name from public.riders where id = rider),
                  (select name from public.profiles where id = uid)) into uname;
  select rider_id into prev_rider from public.crossings
   where room_id = p_room and not deleted and crossed_at < p_crossed_at
   order by crossed_at desc limit 1;

  begin
    insert into public.crossings (room_id, crosser_id, crosser_name, crossed_at, source, rider_id)
    values (p_room, uid, coalesce(uname, '?'), p_crossed_at, 'gps', rider);
  exception when unique_violation then
    return 'too_soon';
  end;

  perform public._refresh_last_crosser(p_room);

  if prev_rider is not null and rider is not null and prev_rider <> rider then
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
  crid uuid;
  cname text;
begin
  r := public._require_owner(p_room);
  if r.status = 'ready' then raise exception 'invalid_status'; end if;
  if p_crossed_at <= r.started_at or p_crossed_at > now() + interval '5 seconds' then
    raise exception 'invalid_time';
  end if;
  -- その時刻の直前に通過したライダー（いなければ最後に通過したライダー、さらにいなければオーナーのライダー）
  select crosser_id, rider_id into cid, crid from public.crossings
   where room_id = p_room and not deleted and crossed_at < p_crossed_at
   order by crossed_at desc limit 1;
  cid := coalesce(cid, r.last_crosser_id, auth.uid());
  crid := coalesce(crid, r.last_crosser_rider_id, r.owner_rider_id);
  select coalesce((select name from public.riders where id = crid),
                  (select name from public.profiles where id = cid)) into cname;
  begin
    insert into public.crossings (room_id, crosser_id, crosser_name, crossed_at, source, rider_id)
    values (p_room, cid, coalesce(cname, '?'), p_crossed_at, 'manual', crid);
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

-- 引数名を p_user から p_rider に変えたので、作り直す
drop function if exists public.set_crossing_driver(uuid, uuid);
create function public.set_crossing_driver(p_id uuid, p_rider uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare rid uuid;
begin
  select room_id into rid from public.crossings where id = p_id;
  if rid is null then raise exception 'not_found'; end if;
  perform public._require_owner(rid);
  if p_rider is not null and not exists (
    select 1 from public.riders where room_id = rid and id = p_rider
  ) then
    raise exception 'not_rider';
  end if;
  update public.crossings set driver_override_rider_id = p_rider, driver_override_id = null where id = p_id;
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
  -- driver_id はライダー（riders.id）。走行距離もライダーごとに集計する
  with c as (
    select x.id, x.crossed_at, x.crosser_id, x.crosser_name, x.source, x.rider_id, x.driver_override_rider_id,
           row_number() over (order by x.crossed_at)::int as n,
           coalesce(lag(x.crossed_at) over (order by x.crossed_at),
                    (select r.started_at from public.rooms r where r.id = p_room)) as lap_start
    from public.crossings x
    where x.room_id = p_room and not x.deleted
  ),
  d as (
    select c.id as cid, s.rider_id,
           sum(
             s.meters * greatest(0, extract(epoch from (least(s.t_to, c.crossed_at) - greatest(s.t_from, c.lap_start))))
             / greatest(extract(epoch from (s.t_to - s.t_from)), 0.001)
           )::double precision as m
    from c
    join public.distance_segments s
      on s.room_id = p_room and s.rider_id is not null and s.t_to > c.lap_start and s.t_from < c.crossed_at
    group by c.id, s.rider_id
  ),
  best as (
    select distinct on (d.cid) d.cid, d.rider_id, d.m
    from d join c on c.id = d.cid
    where d.m > 0
    order by d.cid, d.m desc, (d.rider_id = c.rider_id) desc
  ),
  pick as (
    select c.*, coalesce(c.driver_override_rider_id, best.rider_id, c.rider_id) as drv
    from c left join best on best.cid = c.id
  )
  select pick.n,
         pick.id,
         pick.crossed_at,
         round(extract(epoch from (pick.crossed_at - pick.lap_start)) * 1000)::bigint,
         pick.drv,
         coalesce(rd.name, pick.crosser_name),
         dm.m,
         pick.source,
         pick.driver_override_rider_id is not null,
         pick.crosser_id
  from pick
  left join public.riders rd on rd.id = pick.drv
  left join d dm on dm.cid = pick.id and dm.rider_id = pick.drv
  order by pick.n;
end $$;

-- ---------------------------------------------------------------------
-- v1.0.x のデータをライダーの名簿に移す（何度実行しても、まだ移していない行だけが対象になる）
-- ---------------------------------------------------------------------
do $$
declare
  x record;
  rid uuid;
begin
  -- 1. オーナーのライダー：作った人の本人のライダーを作り、オーナーにする
  for x in
    select r.id as room_id, r.owner_id from public.rooms r
    where r.owner_rider_id is null and r.owner_id is not null
      and exists (select 1 from public.room_members m where m.room_id = r.id and m.user_id = r.owner_id)
  loop
    select current_rider_id into rid from public.room_members where room_id = x.room_id and user_id = x.owner_id;
    if rid is null then
      insert into public.riders (room_id, name, user_id)
      values (x.room_id, public._unique_rider_name(x.room_id, (select name from public.profiles where id = x.owner_id)), x.owner_id)
      returning id into rid;
      update public.room_members set current_rider_id = rid where room_id = x.room_id and user_id = x.owner_id;
    end if;
    update public.rooms set owner_rider_id = rid where id = x.room_id;
  end loop;

  -- 2. ほかのメンバーの本人のライダー
  for x in select room_id, user_id from public.room_members where current_rider_id is null loop
    perform public._assign_own_rider(x.room_id, x.user_id);
  end loop;

  -- 3. 通過・名前の修正・走行距離に、その端末の本人のライダーを入れる
  update public.crossings c set rider_id = (
    select id from public.riders where room_id = c.room_id and user_id = c.crosser_id order by created_at limit 1)
   where c.rider_id is null and c.crosser_id is not null;
  update public.crossings c set driver_override_rider_id = (
    select id from public.riders where room_id = c.room_id and user_id = c.driver_override_id order by created_at limit 1)
   where c.driver_override_rider_id is null and c.driver_override_id is not null;
  update public.distance_segments s set rider_id = (
    select id from public.riders where room_id = s.room_id and user_id = s.user_id order by created_at limit 1)
   where s.rider_id is null;

  -- 4. 最後に通過したライダー
  for x in select id from public.rooms where last_crosser_rider_id is null and last_crosser_id is not null loop
    perform public._refresh_last_crosser(x.id);
  end loop;
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
      '_unique_rider_name', '_assign_own_rider', '_current_rider', '_segments_fill_rider', '_bc_riders',
      'update_profile_name', 'create_room', 'join_room', 'reclaim_owner', 'set_line',
      'update_room_settings', 'start_race', 'set_start_time', 'finish_race', 'record_crossing',
      'add_manual_crossing', 'delete_crossing', 'set_crossing_driver', 'get_lap_table',
      'switch_rider', 'add_rider', 'rename_rider')
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
-- 旧名（v1.0.1 まで）のポリシーを削除
drop policy if exists "pitwall members can receive" on realtime.messages;
drop policy if exists "pitwall members can send" on realtime.messages;

drop policy if exists "gpx-track members can receive" on realtime.messages;
create policy "gpx-track members can receive" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_members m
      where m.user_id = (select auth.uid())
        and 'room:' || m.room_id::text = (select realtime.topic())
    )
  );

drop policy if exists "gpx-track members can send" on realtime.messages;
create policy "gpx-track members can send" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1 from public.room_members m
      where m.user_id = (select auth.uid())
        and 'room:' || m.room_id::text = (select realtime.topic())
    )
  );
