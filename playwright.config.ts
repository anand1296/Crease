import { defineConfig, devices, type ReporterDescription } from '@playwright/test';

/**
 * Browser smoke tests run against the production build.
 * Locally:  npm run build && npm run test:e2e   (starts `vite preview` automatically)
 * Against a deployed URL (e.g. a Vercel preview): E2E_BASE_URL=https://… npm run test:e2e
 */
const externalBaseUrl = process.env.E2E_BASE_URL;
const ci = Boolean(process.env.CI);

const reporter: ReporterDescription[] = ci ? [['github'], ['html', { open: 'never' }]] : [['list']];

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter,
  use: {
    baseURL: externalBaseUrl ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Only start a local preview server when not testing a deployed URL.
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: 'npx vite preview --port 4173 --strictPort',
          url: 'http://localhost:4173',
          reuseExistingServer: !ci,
        },
      }),
  projects: [
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // Software WebGL so the 3D canvas renders on GPU-less CI runners.
          args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
          // Optional: use an already-installed Chromium instead of Playwright's download.
          ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}),
        },
      },
    },
  ],
});
