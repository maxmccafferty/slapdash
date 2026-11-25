// Vercel function for `/api/claude`: the Claude keyhole (packages/keyhole).
// `pnpm build:api` bundles it into packages/keyhole/dist/vercel.js during the Vercel build;
// Vercel's Node builder can't run the workspace TypeScript directly. Source:
// packages/keyhole/src/vercel-entry.ts.
export { GET, POST } from '../packages/keyhole/dist/vercel.js';
