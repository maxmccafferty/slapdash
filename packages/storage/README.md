# @slapdash/storage

Project storage behind small interfaces (ADR-0001 §10). The app talks only to
`ProjectStore`, `Auth` and `DeviceState`. Backend SDKs are imported only under
`src/adapters/<name>/`, and `test/boundaries.test.ts` fails if anything else imports one.

> **Where this lives.** ADR-0002 §E2 puts the adapters in `apps/web`. There is no app yet,
> and the shared adapter suites need to be importable by the later Supabase adapter, so
> storage is its own package. When `apps/web` exists it depends on this package.

## Entry points

| Import | What |
| --- | --- |
| `@slapdash/storage` | Interfaces, `ProjectSession` (autosave), `.slapdash` encode/decode, record and chat schemas. No backend code. |
| `@slapdash/storage/local` | `createLocalBackend()`: IndexedDB via Dexie, no sign-in. The default. |
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

**What the app must wire** (not done here, as there is no app shell yet):

- Call `session.flush()` on `pagehide` and on `visibilitychange` to hidden.
- Turn `await session.exportFile()` (`{ fileName, mimeType, text }`) into a `Blob` download.
- For Import, read the file as text and pass it to `ProjectSession.importFile(text, { store })`,
  then `ProjectSession.openById(id, deps)`.

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

## Scripts

```sh
pnpm --filter @slapdash/storage test       # vitest (node environment, fake-indexeddb)
pnpm --filter @slapdash/storage typecheck
```
