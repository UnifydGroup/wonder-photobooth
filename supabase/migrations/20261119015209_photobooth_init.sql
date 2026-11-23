create table public.settings (
  id int primary key default 1 check (id = 1),
  event_name text not null default 'Wonder',
  tagline text not null default 'Share the moment',
  frame_message text not null default '#WonderMoments',
  enabled_frames text[] not null default array['classic','polaroid','bold','minimal'],
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1);

create table public.photos (
  id uuid primary key,
  frame text,
  storage_path text not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  shared_at timestamptz
);

create table public.leads (
  id bigint generated always as identity primary key,
  photo_id uuid not null references public.photos(id) on delete cascade,
  first_name text not null,
  last_name text,
  email text not null,
  postcode text,
  marketing_opt_in boolean not null default false,
  terms_accepted boolean not null default false,
  created_at timestamptz not null default now()
);
create index leads_photo_id_idx on public.leads(photo_id);
create index photos_created_at_idx on public.photos(created_at desc);

alter table public.settings enable row level security;
alter table public.photos enable row level security;
alter table public.leads enable row level security;
-- No policies: only the edge function (service role) can read/write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760, array['image/jpeg','image/png']);
