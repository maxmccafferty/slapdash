/**
 * The shipped sample (`pool-house.slapdash`): the pool-house shell built from
 * `SAMPLE_SHELL_COMMANDS` on the tier-1 catalog with the default design loads, a fixed
 * clock, no undo history and an empty chat. `scripts/build-sample.ts` writes it.
 *
 * The committed file is frozen at project schema v1 (before part cuts, LOC-120): it is the
 * fixture that proves old files still load and render as before. Don't regenerate it
 * unless that fixture moves elsewhere; `test/projects/sample.test.ts` checks it is v1 and
 * has the same parts as a fresh build.
 */
import { CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject } from '@slapdash/core';
import { emptyChatLog, encodeSlapdashFile } from '@slapdash/storage';
import { buildSampleShell } from '../model/sample-shell.ts';

export const SAMPLE_NAME = 'Pool house';
export const SAMPLE_FILE_NAME = 'pool-house.slapdash';

/** The sample's file text. Deterministic: the same commands always give the same bytes. */
export function buildSampleText(): string {
  const now = () => 0;
  const bus = new CommandBus({ project: createProject({ name: SAMPLE_NAME }), catalog: CATALOG, now });
  buildSampleShell(bus);
  return encodeSlapdashFile(
    {
      meta: { name: SAMPLE_NAME, named: true, createdAt: 0, updatedAt: 0 },
      project: bus.project,
      history: null,
      chat: emptyChatLog(),
    },
    [],
    { now },
  );
}
