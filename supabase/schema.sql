-- AskAngels Team Chat — database schema
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: every statement checks before creating.

-- ---------------------------------------------------------------
-- 1. Settings: the owner account is approved automatically.
--    Change this address if the owner signs in with a different email.
-- ---------------------------------------------------------------
create or replace function public.owner_email() returns text
language sql immutable as $$ select 'kingobsmith@gmail.com'::text $$;

-- ---------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  title       text not null default '',          -- e.g. "Executive of Education for Trading"
  role        text not null default 'member'
              check (role in ('owner','admin','member')),
  approved    boolean not null default false,    -- nobody gets in until approved
  created_at  timestamptz not null default now()
);

create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  description text not null default '',
  created_at  timestamptz not null default now()
);

create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  room_id      uuid not null references public.rooms(id) on delete cascade,
  author_id    uuid references public.profiles(id) on delete set null,  -- null for Claude / Angel
  author_kind  text not null check (author_kind in ('human','claude','angel')),
  author_name  text not null,
  author_title text not null default '',
  body         text not null check (char_length(body) between 1 and 8000),
  created_at   timestamptz not null default now()
);
create index if not exists messages_room_time on public.messages(room_id, created_at);

-- ---------------------------------------------------------------
-- 3. Helper checks used by the security rules
-- ---------------------------------------------------------------
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved)
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and approved and role in ('owner','admin'))
$$;

-- ---------------------------------------------------------------
-- 4. New sign-ups get a profile; the owner is approved at once
-- ---------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name, role, approved)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when lower(new.email) = owner_email() then 'owner' else 'member' end,
    lower(new.email) = owner_email()
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------
-- 5. A person's name and title on a message always come from their
--    profile, so nobody can post under someone else's name.
-- ---------------------------------------------------------------
create or replace function public.stamp_human_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if new.author_kind = 'human' then
    select * into p from profiles where id = auth.uid();
    if p.id is null or not p.approved then
      raise exception 'Account not approved';
    end if;
    new.author_id    := p.id;
    new.author_name  := p.full_name;
    new.author_title := p.title;
  end if;
  return new;
end $$;

drop trigger if exists stamp_message on public.messages;
create trigger stamp_message before insert on public.messages
  for each row execute function public.stamp_human_message();

-- Members may not promote or approve themselves.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    new.role := old.role;
    new.approved := old.approved;
  end if;
  new.email := old.email;
  return new;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------
-- 6. Row-level security
-- ---------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.rooms    enable row level security;
alter table public.messages enable row level security;

drop policy if exists "read own or all if approved" on public.profiles;
create policy "read own or all if approved" on public.profiles
  for select using (id = auth.uid() or is_approved());

drop policy if exists "update own profile or admin" on public.profiles;
create policy "update own profile or admin" on public.profiles
  for update using (id = auth.uid() or is_admin());

drop policy if exists "approved read rooms" on public.rooms;
create policy "approved read rooms" on public.rooms
  for select using (is_approved());

drop policy if exists "admins manage rooms" on public.rooms;
create policy "admins manage rooms" on public.rooms
  for all using (is_admin()) with check (is_admin());

drop policy if exists "approved read messages" on public.messages;
create policy "approved read messages" on public.messages
  for select using (is_approved());

-- People post only as themselves. Claude and Angel post through the
-- server with the service key, which bypasses these rules.
drop policy if exists "approved post as self" on public.messages;
create policy "approved post as self" on public.messages
  for insert with check (is_approved() and author_kind = 'human');

-- ---------------------------------------------------------------
-- 7. Live updates
-- ---------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- 8. Starting rooms
-- ---------------------------------------------------------------
insert into public.rooms (slug, name, description) values
  ('general',        'General',           'Everyone across GROOVV'),
  ('kingdom-minded', 'Kingdom Minded',    'Curriculum, interns and the four pillars'),
  ('handbooks',      'Hiring & Handbooks','Claude and Angel review handbook drafts here')
on conflict (slug) do nothing;
