alter table public.leads alter column photo_id drop not null;
alter table public.leads drop constraint leads_photo_id_fkey;
alter table public.leads add constraint leads_photo_id_fkey foreign key (photo_id) references public.photos(id) on delete set null;
