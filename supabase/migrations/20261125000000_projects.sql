-- Slapdash project storage (ADR-0001 §10): one row per project, file metadata rows, and a
-- private bucket for file bytes (photos, card pictures). Every row belongs to one user and
-- row-level security keeps each user to their own rows and their own storage folder.
--
-- Shape notes, from the shared ProjectStore contract (packages/storage/testing):
-- * project ids are any non-empty string the app chooses (not UUIDs), unique per user;
-- * files may be stored before their project is first saved, so project_files has no
--   foreign key to projects;
-- * times are bigint ms since epoch, so ProjectMeta round-trips exactly.

create table public.projects (
  user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id          text    not null check (length(id) between 1 and 200),
  name        text    not null,
  named       boolean not null,
  created_at  bigint  not null,
  updated_at  bigint  not null,
  part_count  integer not null,
  body        jsonb   not null, -- { meta, project, history }
  chat        jsonb   not null,
  primary key (user_id, id)
);

create index projects_user_updated on public.projects (user_id, updated_at desc);

create table public.project_files (
  user_id     uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  project_id  text    not null check (length(project_id) between 1 and 200),
  id          text    not null check (length(id) between 1 and 200),
  name        text    not null,
  mime_type   text    not null,
  size        integer not null,
  created_at  bigint  not null,
  primary key (user_id, project_id, id)
);

alter table public.projects enable row level security;
alter table public.project_files enable row level security;

-- Signed-out callers get nothing.
revoke all on public.projects from anon;
revoke all on public.project_files from anon;
grant select, insert, update, delete on public.projects to authenticated;
grant select, insert, update, delete on public.project_files to authenticated;

create policy "projects: owner selects" on public.projects
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "projects: owner inserts" on public.projects
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "projects: owner updates" on public.projects
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "projects: owner deletes" on public.projects
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "project_files: owner selects" on public.project_files
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "project_files: owner inserts" on public.project_files
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "project_files: owner updates" on public.project_files
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "project_files: owner deletes" on public.project_files
  for delete to authenticated using ((select auth.uid()) = user_id);

-- File bytes. Object path: <user_id>/<project_id>/<file_id> (ids URI-encoded by the adapter).
-- 25 MB per object.
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', false, 26214400)
on conflict (id) do nothing;

create policy "project-files: owner reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "project-files: owner writes" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "project-files: owner replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'project-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "project-files: owner deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'project-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
