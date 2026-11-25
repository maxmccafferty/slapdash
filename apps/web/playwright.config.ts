import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
/** A second build with (fake) Supabase settings, for sign-in (e2e/sign-in.spec.ts). */
export const HOSTED_PORT = 4174;
/** Not a real host: e2e/sign-in.spec.ts answers it with `page.route`. */
export const FAKE_SUPABASE_URL = 'http://supabase.e2e.test';
const HOSTED_OUT = 'node_modules/.e2e-hosted';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    // WebGL 2 in headless Chromium, without a GPU (the renderer specs need it).
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    // `page.route` doesn't see a service worker's requests; e2e/pwa.spec.ts allows it.
    serviceWorkers: 'block',
  },
  webServer: [
    {
      command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npx vite build --outDir ${HOSTED_OUT} --emptyOutDir && npx vite preview --outDir ${HOSTED_OUT} --port ${HOSTED_PORT} --strictPort`,
      url: `http://localhost:${HOSTED_PORT}`,
      env: { VITE_SUPABASE_URL: FAKE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e' },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
});
