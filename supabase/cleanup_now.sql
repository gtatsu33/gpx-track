-- =====================================================================
-- 今あるデータをすべて削除する（v1.1.0 の schema.sql を実行する前に、手動で1回だけ実行する）
-- 注意：すべてのルームと匿名ユーザーが消え、元に戻せない。
--   消えるもの：ルーム、メンバー、通過、走行距離、チャット、名簿（riders がある場合）、
--               匿名ユーザーとそのプロフィール
--   残るもの  ：オーナーパスコード（app_config）、匿名でないユーザー
-- 実行したあとは schema.sql を実行してから、アプリをデプロイする。
-- =====================================================================

-- 実行前の件数
select 'before' as at,
       (select count(*) from public.rooms) as rooms,
       (select count(*) from public.room_members) as members,
       (select count(*) from public.crossings) as crossings,
       (select count(*) from public.distance_segments) as segments,
       (select count(*) from public.messages) as messages,
       (select count(*) from public.profiles) as profiles,
       (select count(*) from auth.users where is_anonymous is true) as anon_users;

begin;

-- 1) すべてのルーム（メンバー、通過、走行距離、チャット、名簿も連鎖して消える）
delete from public.rooms;

-- 2) すべての匿名ユーザー（プロフィールも連鎖して消える）
delete from auth.users where is_anonymous is true;

commit;

-- 実行後の件数（anon_users と rooms などが 0 になっていること）
select 'after' as at,
       (select count(*) from public.rooms) as rooms,
       (select count(*) from public.room_members) as members,
       (select count(*) from public.crossings) as crossings,
       (select count(*) from public.distance_segments) as segments,
       (select count(*) from public.messages) as messages,
       (select count(*) from public.profiles) as profiles,
       (select count(*) from auth.users where is_anonymous is true) as anon_users;
