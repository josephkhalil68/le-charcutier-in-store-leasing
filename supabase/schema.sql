-- Run once in the Supabase SQL editor.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_admin boolean not null default false
);

-- First user to exist becomes admin; everyone after is a normal user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, is_admin)
  values (new.id, new.email, not exists (select 1 from public.profiles));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

create table if not exists public.docs (
  path text primary key,
  collection text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb
);
create index if not exists docs_collection_idx on public.docs (collection);

alter table public.profiles enable row level security;
alter table public.docs enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated using (true);

-- Same rules as the original app: these collections are admin-write, the rest open to signed-in users.
drop policy if exists docs_write on public.docs;
create policy docs_write on public.docs for all to authenticated
  using (collection not in ('branches','spaces','types','branchAccess') or public.is_admin())
  with check (collection not in ('branches','spaces','types','branchAccess') or public.is_admin());

alter publication supabase_realtime add table public.docs;

-- Space photos
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
  on conflict (id) do nothing;
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated with check (bucket_id = 'photos');
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated using (bucket_id = 'photos');
