-- オーナーパスコードの設定・変更
-- 'CHANGE_ME' を任意のパスコード（8文字以上推奨）に書き換えてから SQL Editor で実行する。
-- パスコードは bcrypt でハッシュ化して保存されるので、平文は残らない。
insert into public.app_config (id, owner_passcode_hash)
values (1, extensions.crypt('CHANGE_ME', extensions.gen_salt('bf')))
on conflict (id) do update set owner_passcode_hash = excluded.owner_passcode_hash;
