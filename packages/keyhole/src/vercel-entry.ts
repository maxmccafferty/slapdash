/**
 * The Vercel function for `/api/claude`, bundled by `pnpm build:api` into `packages/keyhole/dist/vercel.js`
 * (one self-contained ESM file, generated and gitignored), which `api/claude.js` re-exports. Vercel's Node builder can't run
 * the workspace's TypeScript sources directly, so the bundle is what deploys.
 *
 * The Anthropic API key is read from the server environment here and nowhere else.
 */
import { createKeyholeFromEnv } from './index.ts';

const keyhole = createKeyholeFromEnv(process.env);

export const GET = (request: Request): Promise<Response> => keyhole(request);
export const POST = (request: Request): Promise<Response> => keyhole(request);
