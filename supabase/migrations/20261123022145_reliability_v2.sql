-- thumbnails
alter table public.photos add column if not exists thumb_path text;
alter table public.photos add column if not exists booth_id text;

-- settings: retention + wifi
alter table public.settings add column if not exists photo_retention_days int not null default 30;
alter table public.settings add column if not exists wifi_name text not null default '';
alter table public.settings add column if not exists wifi_password text not null default '';

-- dedupe leads per photo+email
delete from public.leads a using public.leads b
  where a.id > b.id and a.photo_id = b.photo_id and a.email = b.email;
create unique index if not exists leads_photo_email_uniq on public.leads(photo_id, email);

-- claims waiting for a photo that hasn't uploaded yet (email fallback)
create table if not exists public.pending_claims (
  photo_id uuid not null,
  email text not null,
  first_name text not null,
  last_name text,
  postcode text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (photo_id, email)
);
alter table public.pending_claims enable row level security;

-- booth heartbeats
create table if not exists public.booths (
  id text primary key,
  name text not null,
  last_seen timestamptz not null default now(),
  queue_length int not null default 0,
  last_upload timestamptz,
  app_version text
);
alter table public.booths enable row level security;

-- failed staff logins for rate limiting
create table if not exists public.auth_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists auth_failures_ip_time on public.auth_failures(ip, created_at);
alter table public.auth_failures enable row level security;

-- cron secret for the cleanup job
insert into public.app_secrets(key, value)
values ('cron_key', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;
