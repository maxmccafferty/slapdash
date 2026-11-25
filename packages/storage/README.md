# @slapdash/storage

Project storage behind small interfaces (ADR-0001 §10). The app talks only to
`ProjectStore`, `Auth` and `DeviceState`. Backend SDKs are imported only under
`src/adapters/<name>/`, and `test/boundaries.test.ts` fails if anything else imports one.

> **Where this lives.** ADR-0002 §E2 puts the adapters in `apps/web`. The shared adapter
> suites need to be importable by the later Supabase adapter, so storage is its own package,
> and `apps/web` depends on it.

## Entry points

| Import | What |
| --- | --- |
| `@slapdash/storage` | Interfaces, `ProjectSession` (autosave), `.slapdash` encode/decode, record and chat schemas, and the sync layer (`createSyncedBackend`, `SyncedProjectStore`, `adoptProjects`). No backend SDK. |
| `@slapdash/storage/local` | `createLocalBackend()`: IndexedDB via Dexie, no sign-in. The default. Also `LocalSyncJournal` and `hasProjects()`. |
| `@slapdash/storage/supabase` | `createSupabaseBackend({ url, key, storage?, device? })`: Postgres rows, a private Storage bucket and Supabase Auth (password and passkey). The app loads it lazily, only when the Supabase env vars are set. |
| `@slapdash/storage/testing` | Shared vitest suites every adapter must pass, plus fixtures. |

## Interfaces (`src/types.ts`)

- **`ProjectStore`**: `list()` (newest first), `load(id)`, `save(record)` (upsert, validates
  first), `delete(id)` (record, chat and files), and `files.put/get/list/delete` for photos
  and other uploads (bytes as `Uint8Array`).
- **`ProjectRecord`**: `{ id, meta, project, history, chat }`. `history` is the command bus's
  `SerializedBus` (undo, redo and named versions), so undo survives a reload. `meta` holds
  `name`, `named` (false until the user saves with a name), `createdAt` and `updatedAt`. The
  store keeps the caller's `updatedAt` as is.
- **`Auth`**: `requiresSignIn`, `currentUser()`, `signIn()`, `signOut()`, `onChange()`. The
  local adapter has no sign-in; its user is always "This device".
- **`DeviceState`**: the last project opened on this device. It is separate from
  `ProjectStore` because it stays per-device even with a remote backend.
- **`StorageError`**: `code` is `invalid`, `not_found`, `unavailable` or `too_large`, and
  `message` is a sentence that can be shown to the user.

## Chat (`src/chat.ts`)

`ChatLog = { version: 1, summary?, messages }`. A message is `{ id, role, at, turnId?,
content }`. `content` is any JSON value, so `packages/agent` can store Anthropic content
blocks (and file-id references) without a migration. `summary` holds the summarised older
turns (ADR-0002 §D8); `session.setChatSummary(summary, keep)` drops all but the last `keep`
messages.

## Autosave (`ProjectSession`)

```ts
import { SAMPLE_CATALOG } from '@slapdash/core';
import { ProjectSession } from '@slapdash/storage';
import { createLocalBackend } from '@slapdash/storage/local';

const { store, device } = createLocalBackend();
const session = await ProjectSession.open({ store, device, catalog: SAMPLE_CATALOG });
session.bus.execute('add_assembly', { name: 'South wall', kind: 'wall' }); // autosaved
await session.save({ name: 'Pool house' }); // → { ok: true, message: 'Saved "Pool house".' }
```

- `open()` reopens the device's last project with its undo history, versions and chat. On
  first run it starts an unnamed "New project", which isn't stored until the first change.
  If the last project can't be read, it opens a new one and sets an error status instead of
  throwing.
- Every bus change and chat change schedules a save 500 ms after the last change
  (`debounceMs`). Saves never overlap. A failed save sets `status` to an error and keeps the
  changes; the next change or `flush()` retries. `onStatus(fn)` reports
  `idle | saving | saved | error`.
- While a bus group is open (Claude mid-turn) saving waits, because the group's commands
  aren't in the history until it closes.
- `save()` is the user's Save action. An unnamed project returns `{ needsName: true,
  suggestedName }`; `save({ name })` runs `rename_project` as an undoable step, marks the
  project named and saves.
- Also: `openById`, `newProject`, `appendChat`, `exportFile`, `importFile` (static), `close`.

- `siteDefaults` (optional) is handed to the bus, so builders size members from the app's
  design loads. `newProject(deps, { name })` starts a named project. `setThumbnail(png)`
  stores the Projects card picture as the project file `thumbnail` (only once stored).
- `importFile(text, { store, now })`: with `now`, the copy's `updatedAt` is the import time,
  so it lists first.

**In the app** (`apps/web/src/projects/projects-controller.ts`): `flush()` runs on `pagehide`
and on `visibilitychange` to hidden; Import reads the file as text, calls `importFile`, then
`openById`. Still to wire: turning `exportFile()` into a `Blob` download.

## The `.slapdash` file

One project as UTF-8 JSON:

```json
{
  "format": "slapdash",
  "formatVersion": 1,
  "exportedAt": 1764000000000,
  "meta": { "createdAt": 0, "name": "Pool house", "named": true, "updatedAt": 0 },
  "project": { "...": "the model; carries its own schemaVersion" },
  "history": { "...": "undo, redo, versions" },
  "chat": { "messages": [], "version": 1 },
  "files": [{ "id": "…", "name": "site.jpg", "mimeType": "image/jpeg", "createdAt": 0, "data": "<base64>" }]
}
```

- Encoding is deterministic: top-level fields are in a fixed order, nested keys are sorted,
  and files are ordered by `createdAt` then `id`. With a fixed clock, export → import →
  export gives byte-identical text.
- Import always creates a new project with a new id. File ids are kept, so references to
  them in the chat still work.
- **Versioning.** `formatVersion` covers the wrapper. To change it, bump
  `SLAPDASH_FORMAT_VERSION` and add a case to `migrateSlapdashFile` that upgrades the
  previous version. A file from a newer app is refused with "made by a newer Slapdash". The
  model inside has its own `schemaVersion`, which `migrateProject` in `@slapdash/core`
  upgrades (for the project and for every saved version).

## Writing an adapter

1. Add a folder `src/adapters/<name>/` with a factory that returns a `StorageBackend`
   (`{ store, auth, device, close }`). Only files in that folder may import the SDK.
2. Call `validateRecord` in `save` and `load`, and throw `StorageError` with a plain message.
3. In `test/<name>-adapter.test.ts`, run the shared suites:

   ```ts
   import { describeAuth, describeDeviceState, describeProjectStore } from '../testing/index.ts';
   describeProjectStore('<name>', { create, reopen, cleanup });
   describeAuth('<name>', { create, validCredentials });
   describeDeviceState('<name>', { create, reopen, cleanup });
   ```

4. Add an entry point to `package.json` `exports`.

## The local adapter

Dexie 4 over IndexedDB, in one database (`slapdash` by default) with the tables `projects`
(summaries, for a cheap list), `bodies`, `chats`, `files` and `device`. To change the
schema, add `version(2)` in `src/adapters/local/db.ts`; never edit version 1. Tests inject
a fresh `fake-indexeddb` factory per test with `createLocalBackend({ indexedDB, IDBKeyRange })`.

## The Supabase adapter (`src/adapters/supabase/`)

The hosted copy's backend (ADR-0001 §10, ADR-0002 §D1 P5). The schema is
`supabase/migrations/20261125000000_projects.sql` at the repo root:

- `projects`: one row per project and user, primary key `(user_id, id)`. The summary columns
  (`name`, `named`, `created_at`, `updated_at`, `part_count`) make `list()` cheap; `body`
  (`{ meta, project, history }`) and `chat` are `jsonb`. Times are `bigint` ms, so
  `ProjectMeta` round-trips exactly. Project ids are any string the app picks, not UUIDs.
- `project_files`: file metadata, primary key `(user_id, project_id, id)`. No foreign key to
  `projects`, because the contract lets a file be stored before its project's first save.
- The private bucket `project-files` holds the bytes at `<user_id>/<project_id>/<file_id>`
  (ids that aren't plain `[A-Za-z0-9_-]` are written as `b64.<base64url>`: Storage keys can't
  hold `%`). 25 MB per file.
- Row-level security on both tables and on `storage.objects`: each user reaches only their own
  rows and their own folder. The `anon` role gets nothing.

`save()` is one upsert, so a row is replaced whole or not at all. `delete()` removes the
objects first, then the rows, so a failure leaves rows a retry can find. Errors go through
`toStorageError()` (`errors.ts`): no network, a timeout, 5xx, 540 or "project is paused" become
`unavailable` with "Slapdash's cloud storage isn't answering…"; 413 becomes `too_large`; an
expired session becomes "You've been signed out. Sign in again to sync."

`SupabaseAuth`: `signIn({ kind: 'password' })` and `signIn({ kind: 'passkey' })` (Supabase's
native WebAuthn; `conditional: true` offers it from the email field's autofill), plus the
optional `Auth` extras `accessToken()` and `passkeys.{ supported, register }`.
`currentUser()` reads the persisted session without the network, so the app opens offline or
while the project is paused. Sign-in errors are plain sentences (`SIGN_IN_MESSAGES`).
`@supabase/supabase-js` is pinned exactly because the passkey API is new. (In 2.119 the
`experimental.passkey` client flag is deprecated and ignored: passkeys are on by default, so
the adapter doesn't set it.)

`DeviceState` stays on the device by definition, so the factory takes the caller's
(`device: local.device`); without one it uses an in-memory one (tests).

## Sync (`src/sync/`)

`createSyncedBackend({ local, remote, journal })` is how the app uses a remote backend. It has
no SDK code: `local` and `remote` are any two `StorageBackend`s.

- **Writes** go to `local` and return as soon as that's done. The id goes into the journal
  (the push queue, kept in the local database's `device` table by `LocalSyncJournal`), and the
  push loop sends it. When the remote is unavailable the loop stops, the status becomes
  `offline` with the adapter's sentence, and it retries with backoff (5 s doubling to 5 min) or
  at once on `retry()`.
- **Reads** merge both: the newer `meta.updatedAt` wins, and a remote copy that's newer (and
  not waiting to be pushed from here) is kept locally. A project only the remote has is listed
  and fetched on `load`. A project that was synced before and is gone from the remote was
  deleted on another device and is removed here; one that was never synced is queued, never
  dropped. Reads wait at most 5 s for the remote, then use the local copy.
- **Conflicts**: the journal remembers the `updatedAt` last synced per project (its baseline).
  If the remote copy is newer than that when we push, another device changed it too: the
  remote version wins the id, and ours is saved as a new project "<name> (conflict, this
  device)" (with its files) and pushed. `onConflict` tells the app.
- `adoptProjects(from, into)` copies every project and file (keeping ids). The app uses it once
  per user and device to move projects made before sign-in into the account.

`SyncStatus` is `synced | syncing (pending) | offline (message, pending)`.

## Scripts

```sh
pnpm --filter @slapdash/storage test             # vitest (node environment, fake-indexeddb); the Supabase file skips itself
pnpm --filter @slapdash/storage typecheck
pnpm --filter @slapdash/storage test:supabase    # the shared suites + RLS tests against a local Supabase (needs Docker)
pnpm --filter @slapdash/storage test:supabase --stop   # …and stop the stack afterwards
```

`test:supabase` (also `pnpm test:supabase` at the root) runs `supabase start` (which applies
the migration), reads the URL and keys from `supabase status -o env`, and runs
`test/supabase-adapter.test.ts`: `describeProjectStore`, `describeAuth` and
`describeDeviceState`, then the row-level-security checks (another user sees nothing, can't
download your objects; a signed-out client reads nothing; a wrong password gives a plain
message). Each test gets a fresh confirmed user made with the admin API and deleted after. To
run it against a hosted project instead, set `SUPABASE_TEST_URL`,
`SUPABASE_TEST_PUBLISHABLE_KEY` and `SUPABASE_TEST_SECRET_KEY` and run
`pnpm --filter @slapdash/storage exec vitest run test/supabase-adapter.test.ts`.
