create table public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
-- Staff passcode is stored as a SHA-256 hex digest. Set your own:
--   update public.app_secrets set value = encode(extensions.digest('<your passcode>', 'sha256'), 'hex') where key = 'staff_passcode_sha256';
-- (The live project's value is not committed.)
insert into public.app_secrets (key, value) values ('staff_passcode_sha256', 'CHANGE_ME');
