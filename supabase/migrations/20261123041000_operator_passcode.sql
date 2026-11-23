-- Operator passcode: sets up and runs booth iPads only (no dashboard). Empty = off.
insert into public.app_secrets (key, value) values ('operator_passcode_sha256', '') on conflict (key) do nothing;
