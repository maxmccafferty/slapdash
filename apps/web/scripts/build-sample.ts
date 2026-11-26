/**
 * Writes the shipped sample project, `src/samples/pool-house.slapdash`, from the pool-house
 * commands (`src/model/sample-shell.ts`). Run it whenever builders or the sample change:
 *
 *   pnpm --filter @slapdash/web sample
 *
 * The file is committed; `test/projects/sample.test.ts` fails if it is out of date.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSampleText, SAMPLE_FILE_NAME } from '../src/samples/build.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const SAMPLE_PATH = resolve(here, '../src/samples', SAMPLE_FILE_NAME);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(SAMPLE_PATH, buildSampleText());
  console.log(`Wrote ${SAMPLE_PATH}`);
}
