/**
 * The shipped sample (`pool-house.slapdash`): the pool-house shell built from
 * `SAMPLE_SHELL_COMMANDS` on the tier-1 catalog with the default design loads, a fixed
 * clock, no undo history and an empty chat. `scripts/build-sample.ts` writes it; the
 * freshness test (`test/projects/sample.test.ts`) fails if the committed file differs.
 */
import { TIER1_CATALOG } from '@slapdash/catalog';
import { CommandBus, createProject } from '@slapdash/core';
import { emptyChatLog, encodeSlapdashFile } from '@slapdash/storage';
import { buildSampleShell } from '../model/sample-shell.ts';

export const SAMPLE_NAME = 'Pool house';
export const SAMPLE_FILE_NAME = 'pool-house.slapdash';

/** The sample's file text. Deterministic: the same commands always give the same bytes. */
export function buildSampleText(): string {
  const now = () => 0;
  const bus = new CommandBus({ project: createProject({ name: SAMPLE_NAME }), catalog: TIER1_CATALOG, now });
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
