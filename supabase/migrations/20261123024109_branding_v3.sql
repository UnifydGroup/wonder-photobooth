alter table public.settings add column if not exists branding jsonb not null default '{}'::jsonb;
alter table public.settings add column if not exists frames jsonb;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;
