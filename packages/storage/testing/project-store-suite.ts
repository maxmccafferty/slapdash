/**
 * The shared ProjectStore contract. Every adapter runs this from its own test file, so
 * the local and future remote adapters behave the same (ADR-0001 §10).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StorageError } from '../src/errors.ts';
import type { ProjectRecord, ProjectStore } from '../src/types.ts';
import { allBytes, sampleRecord } from './fixtures.ts';

export interface StoreHarness {
  /** A fresh, empty store. Called before each test. */
  create(): Promise<ProjectStore>;
  /** Close the current store and open a new one on the same data (to test durability). */
  reopen?(): Promise<ProjectStore>;
  /** Called after each test. */
  cleanup?(): Promise<void>;
}

async function expectInvalid(p: Promise<unknown>): Promise<StorageError> {
  const err = await p.then(
    () => {
      throw new Error('expected save to be rejected');
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(StorageError);
  expect((err as StorageError).code).toBe('invalid');
  expect((err as StorageError).message.length).toBeGreaterThan(10);
  return err as StorageError;
}

export function describeProjectStore(name: string, harness: StoreHarness): void {
  describe(`ProjectStore contract: ${name}`, () => {
    let store: ProjectStore;

    beforeEach(async () => {
      store = await harness.create();
    });
    afterEach(async () => {
      await harness.cleanup?.();
    });

    it('an empty store lists nothing', async () => {
      expect(await store.list()).toEqual([]);
    });

    it('save then load gives back the same record: model, history, versions and chat', async () => {
      const rec = sampleRecord();
      await store.save(rec);
      const loaded = await store.load(rec.id);
      expect(loaded).toEqual(rec);
      expect(loaded!.history!.undo.length).toBeGreaterThan(0);
      expect(loaded!.history!.redo.length).toBe(1);
      expect(loaded!.history!.versions.map((v) => v.name)).toEqual(['first wall']);
      expect(loaded!.chat.messages).toHaveLength(2);
    });

    it('a record without history round-trips', async () => {
      const rec: ProjectRecord = { ...sampleRecord({ id: 'no-history' }), history: null };
      await store.save(rec);
      expect(await store.load(rec.id)).toEqual(rec);
    });

    it('save returns the summary', async () => {
      const rec = sampleRecord();
      const summary = await store.save(rec);
      expect(summary).toEqual({
        id: rec.id,
        name: 'Pool house',
        named: true,
        createdAt: rec.meta.createdAt,
        updatedAt: rec.meta.updatedAt,
        partCount: Object.keys(rec.project.parts).length,
      });
      expect(summary.partCount).toBe(3);
      expect(await store.list()).toEqual([summary]);
    });

    it('saving again replaces the record; list is newest first with no duplicates', async () => {
      const a = sampleRecord({ id: 'a', name: 'Alpha', updatedAt: 1000 });
      const b = sampleRecord({ id: 'b', name: 'Bravo', updatedAt: 2000 });
      await store.save(a);
      await store.save(b);
      expect((await store.list()).map((s) => s.id)).toEqual(['b', 'a']);

      const a2: ProjectRecord = {
        ...a,
        meta: { ...a.meta, updatedAt: 3000 },
        chat: { ...a.chat, messages: [...a.chat.messages, { id: 'm3', role: 'user', at: 3000, content: 'more' }] },
      };
      await store.save(a2);
      const list = await store.list();
      expect(list.map((s) => s.id)).toEqual(['a', 'b']);
      expect(list[0]!.updatedAt).toBe(3000);
      expect(await store.load('a')).toEqual(a2);
    });

    it('load of an unknown id gives null', async () => {
      expect(await store.load('nope')).toBeNull();
    });

    it('delete removes the record, its chat and its files; deleting an unknown id is a no-op', async () => {
      const rec = sampleRecord();
      await store.save(rec);
      const f = await store.files.put(rec.id, { name: 'a.jpg', mimeType: 'image/jpeg', bytes: allBytes() });
      await store.delete(rec.id);
      expect(await store.load(rec.id)).toBeNull();
      expect(await store.list()).toEqual([]);
      expect(await store.files.list(rec.id)).toEqual([]);
      expect(await store.files.get(rec.id, f.id)).toBeNull();
      await expect(store.delete(rec.id)).resolves.toBeUndefined();
      await expect(store.delete('never-existed')).resolves.toBeUndefined();
    });

    it("two projects' chats and files are kept apart", async () => {
      const a = sampleRecord({ id: 'a' });
      const b: ProjectRecord = { ...sampleRecord({ id: 'b' }), chat: { version: 1, messages: [] } };
      await store.save(a);
      await store.save(b);
      const fa = await store.files.put('a', { name: 'a.png', mimeType: 'image/png', bytes: new Uint8Array([1]) });
      await store.files.put('b', { name: 'b.png', mimeType: 'image/png', bytes: new Uint8Array([2]) });
      expect((await store.load('a'))!.chat).toEqual(a.chat);
      expect((await store.load('b'))!.chat).toEqual(b.chat);
      expect((await store.files.list('a')).map((f) => f.name)).toEqual(['a.png']);
      expect((await store.files.list('b')).map((f) => f.name)).toEqual(['b.png']);
      expect(await store.files.get('b', fa.id)).toBeNull();
      await store.delete('a');
      expect((await store.files.list('b')).map((f) => f.name)).toEqual(['b.png']);
      expect(await store.load('b')).toEqual(b);
    });

    it('save rejects an invalid record and leaves stored data unchanged', async () => {
      const good = sampleRecord();
      await store.save(good);
      const before = await store.list();

      const badVersion = { ...good, project: { ...good.project, schemaVersion: 99 } } as unknown as ProjectRecord;
      const err = await expectInvalid(store.save(badVersion));
      expect(err.message).toContain('version 99');

      const unknownKey = { ...good, meta: { ...good.meta, name: 'Changed' }, project: { ...good.project, bogus: 1 } } as unknown as ProjectRecord;
      await expectInvalid(store.save(unknownKey));

      const badChat = { ...good, chat: { version: 1, messages: [{ id: 'x', role: 'robot', at: 0, content: 'hi' }] } } as unknown as ProjectRecord;
      await expectInvalid(store.save(badChat));

      await expectInvalid(store.save({ ...good, id: '' }));

      expect(await store.list()).toEqual(before);
      expect(await store.load(good.id)).toEqual(good);
    });

    it('files: put/get round-trips the bytes exactly', async () => {
      const bytes = allBytes(1000);
      const ref = await store.files.put('p1', { name: 'photo.jpg', mimeType: 'image/jpeg', bytes });
      expect(ref).toMatchObject({ projectId: 'p1', name: 'photo.jpg', mimeType: 'image/jpeg', size: bytes.length });
      expect(typeof ref.id).toBe('string');
      expect(typeof ref.createdAt).toBe('number');
      const got = await store.files.get('p1', ref.id);
      expect(got).toMatchObject(ref);
      expect(got!.bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(got!.bytes)).toEqual(Array.from(bytes));
    });

    it('files: list is oldest first; delete removes one; a given id and createdAt are kept', async () => {
      const b = await store.files.put('p1', { id: 'file-b', createdAt: 20, name: 'b', mimeType: 'text/plain', bytes: new Uint8Array([2]) });
      const a = await store.files.put('p1', { id: 'file-a', createdAt: 10, name: 'a', mimeType: 'text/plain', bytes: new Uint8Array([1]) });
      expect(a.id).toBe('file-a');
      expect(a.createdAt).toBe(10);
      expect((await store.files.list('p1')).map((f) => f.id)).toEqual(['file-a', 'file-b']);
      await store.files.delete('p1', b.id);
      expect((await store.files.list('p1')).map((f) => f.id)).toEqual(['file-a']);
      await expect(store.files.delete('p1', 'missing')).resolves.toBeUndefined();
      expect(await store.files.get('p1', 'missing')).toBeNull();
    });

    it('files: putting the same id again replaces the file', async () => {
      await store.files.put('p1', { id: 'f', name: 'v1', mimeType: 'text/plain', bytes: new Uint8Array([1]) });
      await store.files.put('p1', { id: 'f', name: 'v2', mimeType: 'text/plain', bytes: new Uint8Array([2, 3]) });
      const list = await store.files.list('p1');
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ name: 'v2', size: 2 });
    });

    it('files: get with the wrong project gives null', async () => {
      const ref = await store.files.put('p1', { name: 'x', mimeType: 'text/plain', bytes: new Uint8Array([1]) });
      expect(await store.files.get('p2', ref.id)).toBeNull();
    });

    it("files: changing the caller's array after put doesn't change the stored file", async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const ref = await store.files.put('p1', { name: 'x', mimeType: 'text/plain', bytes });
      bytes[0] = 99;
      expect(Array.from((await store.files.get('p1', ref.id))!.bytes)).toEqual([1, 2, 3]);
    });

    it('files can be stored before the project is first saved', async () => {
      const ref = await store.files.put('not-saved-yet', { name: 'x', mimeType: 'image/png', bytes: new Uint8Array([7]) });
      expect((await store.files.list('not-saved-yet')).map((f) => f.id)).toEqual([ref.id]);
    });

    it('concurrent saves of different projects both persist', async () => {
      await Promise.all([
        store.save(sampleRecord({ id: 'x', updatedAt: 1 })),
        store.save(sampleRecord({ id: 'y', updatedAt: 2 })),
        store.files.put('x', { name: 'x', mimeType: 'text/plain', bytes: new Uint8Array([1]) }),
      ]);
      expect((await store.list()).map((s) => s.id)).toEqual(['y', 'x']);
      expect(await store.files.list('x')).toHaveLength(1);
    });

    if (harness.reopen) {
      const reopen = harness.reopen.bind(harness);
      it('data survives closing and reopening the store', async () => {
        const rec = sampleRecord();
        await store.save(rec);
        const ref = await store.files.put(rec.id, { name: 'p.jpg', mimeType: 'image/jpeg', bytes: allBytes() });
        store = await reopen();
        expect(await store.load(rec.id)).toEqual(rec);
        expect((await store.list()).map((s) => s.id)).toEqual([rec.id]);
        expect(Array.from((await store.files.get(rec.id, ref.id))!.bytes)).toEqual(Array.from(allBytes()));
      });
    }
  });
}
