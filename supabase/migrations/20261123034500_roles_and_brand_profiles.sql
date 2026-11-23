create table if not exists public.brand_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.brand_profiles enable row level security;
-- Client admin passcode: empty value = client access disabled
insert into public.app_secrets (key, value) values ('client_passcode_sha256', '') on conflict (key) do nothing;
