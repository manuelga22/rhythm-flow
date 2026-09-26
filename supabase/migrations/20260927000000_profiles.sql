-- User profiles and account lifecycle.
--
-- Accounts are optional: guests can practice without one, and signing in
-- is what will let sessions be saved. Sign-in itself is handled by Supabase
-- Auth (emailed one-time code or Google). A profile row is created for every
-- new auth user by a trigger and removed with it by the foreign key cascade.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security: a user sees and edits only their own profile. Rows are
-- inserted by handle_new_user() and deleted by the auth.users cascade, so
-- there is no insert or delete policy.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;

create policy "users read their own profile" on public.profiles
  for select to authenticated using (id = auth.uid());

create policy "users update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- New users get a profile. Google supplies a full name; email sign-ups start
-- without a display name.
-- ---------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(left(trim(new.raw_user_meta_data->>'full_name'), 50), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Self-service account deletion. Removes the caller's auth user; the profile
-- goes with it through the cascade.
-- TODO(auth): once attempts carry a user_id, give it `on delete cascade` and
-- delete the user's objects in the attempt-audio bucket as well.
-- ---------------------------------------------------------------------------

create function public.delete_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
