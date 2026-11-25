import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64 } from '../src/format/base64.ts';
import {
  decodeSlapdashFile,
  encodeSlapdashFile,
  slapdashFileName,
  type PortableFile,
} from '../src/format/slapdash-file.ts';
import { allBytes, sampleRecord } from '../testing/index.ts';

const clock = () => 1_800_000_000_000;

function files(): PortableFile[] {
  return [
    { id: 'f2', name: 'deck.jpg', mimeType: 'image/jpeg', createdAt: 20, bytes: allBytes(7) },
    { id: 'f1', name: 'site.png', mimeType: 'image/png', createdAt: 10, bytes: allBytes() },
  ];
}

function errorsOf(text: string): string[] {
  const res = decodeSlapdashFile(text);
  if (res.ok) throw new Error('expected decode to fail');
  return res.errors;
}

describe('.slapdash files', () => {
  it('round-trips a project, its history, chat and files exactly', () => {
    const rec = sampleRecord();
    const text = encodeSlapdashFile(rec, files(), { now: clock });
    const decoded = decodeSlapdashFile(text);
    if (!decoded.ok) throw new Error(decoded.errors.join('\n'));
    const { id: _id, ...body } = rec;
    expect(decoded.record).toEqual(body);
    expect(decoded.exportedAt).toBe(1_800_000_000_000);
    expect(decoded.files.map((f) => f.id)).toEqual(['f1', 'f2']);
    for (const f of decoded.files) {
      const original = files().find((o) => o.id === f.id)!;
      expect(f).toEqual(original);
    }
    // export → import → export is byte-identical
    expect(encodeSlapdashFile(decoded.record, decoded.files, { now: clock })).toBe(text);
  });

  it('reads a chat saved before chat prefs existed, and keeps prefs when present', () => {
    const rec = sampleRecord();
    expect(rec.chat.prefs).toEqual({ confirmBigChanges: false });
    const { prefs: _prefs, ...oldChat } = rec.chat;
    const decoded = decodeSlapdashFile(encodeSlapdashFile({ ...rec, chat: oldChat }, [], { now: clock }));
    if (!decoded.ok) throw new Error(decoded.errors.join('\n'));
    expect(decoded.record.chat).toEqual(oldChat);
    expect(decoded.record.chat.prefs).toBeUndefined();
    const withPrefs = decodeSlapdashFile(encodeSlapdashFile(rec, [], { now: clock }));
    expect(withPrefs.ok && withPrefs.record.chat.prefs).toEqual({ confirmBigChanges: false });
  });

  it('is readable JSON with the format fields first', () => {
    const text = encodeSlapdashFile(sampleRecord(), [], { now: clock });
    const obj = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(obj)).toEqual(['format', 'formatVersion', 'exportedAt', 'meta', 'project', 'history', 'chat', 'files']);
    expect(obj.format).toBe('slapdash');
    expect(obj.formatVersion).toBe(1);
    expect(text.split('\n').length).toBeGreaterThan(50);
  });

  it('encodes the same data the same way regardless of key order', () => {
    const rec = sampleRecord();
    const reordered = { ...rec, meta: { updatedAt: rec.meta.updatedAt, createdAt: rec.meta.createdAt, named: rec.meta.named, name: rec.meta.name } };
    expect(encodeSlapdashFile(reordered, [], { now: clock })).toBe(encodeSlapdashFile(rec, [], { now: clock }));
  });

  it('upgrades the project inside through migrateProject (unknown model versions are refused)', () => {
    const obj = JSON.parse(encodeSlapdashFile(sampleRecord(), [], { now: clock })) as { project: { schemaVersion: number } };
    obj.project.schemaVersion = 7;
    expect(errorsOf(JSON.stringify(obj)).join(' ')).toContain('This project is version 7');
  });

  describe('rejects bad files with plain-language messages', () => {
    const good = () => JSON.parse(encodeSlapdashFile(sampleRecord(), files(), { now: clock })) as Record<string, unknown>;

    it('not JSON', () => {
      expect(errorsOf('PK\u0003\u0004 zip?')[0]).toMatch(/^This isn't a \.slapdash file: it couldn't be read as JSON/);
    });

    it('not an object', () => {
      expect(errorsOf('[1,2]')[0]).toBe("This isn't a .slapdash file: it should contain a JSON object.");
    });

    it('wrong format', () => {
      expect(errorsOf(JSON.stringify({ ...good(), format: 'other' }))[0]).toBe(
        "This isn't a .slapdash file: it's JSON, but not a Slapdash project.",
      );
    });

    it('newer format version', () => {
      expect(errorsOf(JSON.stringify({ ...good(), formatVersion: 2 }))[0]).toBe(
        'This file was made by a newer Slapdash (file format 2; this app reads up to 1). Update the app and try again.',
      );
    });

    it('missing format version', () => {
      const { formatVersion: _v, ...rest } = good();
      expect(errorsOf(JSON.stringify(rest))[0]).toBe(
        "This .slapdash file is damaged: it doesn't say which format version it uses.",
      );
    });

    it('invalid project', () => {
      const obj = good() as { project: Record<string, unknown> };
      obj.project.parts = 'none';
      const errs = errorsOf(JSON.stringify(obj));
      expect(errs[0]).toMatch(/^The model: /);
    });

    it('invalid chat and meta', () => {
      const obj = good() as { chat: unknown; meta: Record<string, unknown> };
      obj.chat = { version: 1, messages: [{ id: 'x', role: 'bot', at: 1, content: 1 }] };
      delete obj.meta.named;
      const errs = errorsOf(JSON.stringify(obj));
      expect(errs.some((e) => e.startsWith('The chat'))).toBe(true);
      expect(errs.some((e) => e.startsWith('The project details ("named")'))).toBe(true);
    });

    it('bad base64', () => {
      const obj = good() as { files: { data: string }[] };
      obj.files[0]!.data = 'not base64!';
      expect(errorsOf(JSON.stringify(obj))).toEqual(['The attached file "site.png" is damaged (its data isn\'t valid base64).']);
    });

    it('duplicate file ids', () => {
      const obj = good() as { files: { id: string }[] };
      obj.files[1]!.id = obj.files[0]!.id;
      expect(errorsOf(JSON.stringify(obj))[0]).toContain('appears twice');
    });

    it('missing files array', () => {
      const { files: _f, ...rest } = good();
      expect(errorsOf(JSON.stringify(rest))[0]).toMatch(/^This \.slapdash file is damaged \(files: /);
    });
  });
});

describe('base64', () => {
  it.each([0, 1, 2, 3, 4, 5, 256, 1000])('round-trips %i bytes', (n) => {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) % 256);
    const text = bytesToBase64(bytes);
    expect(text.length % 4).toBe(0);
    expect(base64ToBytes(text)).toEqual(bytes);
  });

  it('matches the standard encoding', () => {
    const enc = (s: string) => bytesToBase64(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg==');
    expect(enc('fo')).toBe('Zm8=');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foobar')).toBe('Zm9vYmFy');
    expect(bytesToBase64(allBytes())).toBe(Buffer.from(allBytes()).toString('base64'));
  });

  it.each(['Zg=', 'Z===', '====', 'Zm9v!', 'Zg==Zm8=', 'Zm9v\n'])('rejects %j', (text) => {
    expect(base64ToBytes(text)).toBeNull();
  });
});

describe('slapdashFileName', () => {
  it.each([
    ['Pool house', 'pool-house.slapdash'],
    ['  Café / Deck #2!  ', 'cafe-deck-2.slapdash'],
    ['', 'project.slapdash'],
    ['???', 'project.slapdash'],
    ['x'.repeat(100), `${'x'.repeat(60)}.slapdash`],
  ])('%j → %j', (name, expected) => {
    expect(slapdashFileName(name)).toBe(expected);
  });
});
