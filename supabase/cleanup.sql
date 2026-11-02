-- 古いデータの削除（必要なときに SQL Editor で手動実行する）
-- 1) 作成から30日以上たったルームを削除（メンバー、通過、距離、チャットも連鎖して消える）
delete from public.rooms where created_at < now() - interval '30 days';

-- 2) 30日以上前に作られ、どのルームにも属していない匿名ユーザーを削除
delete from auth.users u
where u.is_anonymous is true
  and u.created_at < now() - interval '30 days'
  and not exists (select 1 from public.room_members m where m.user_id = u.id);
