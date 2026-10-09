import { defineConfig, devices } from '@playwright/test'

const external = process.env.UNDERWATER_E2E_BASE_URL
if (external && (process.env.CI || process.env.UNDERWATER_E2E_ALLOW_OWNED_COPY !== '1')) throw new Error('An external loopback harness requires explicit disposable-copy ownership and is disabled in CI.')
const baseURL = external || 'http://localhost:3013'
const target = new URL(baseURL)
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.protocol !== 'http:' || target.username || target.password || target.pathname !== '/') throw new Error('Mutation E2E tests are restricted to an isolated HTTP loopback harness.')
export default defineConfig({
  testDir: './tests/e2e', timeout: 60_000, expect: { timeout: 15_000 },
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: !!process.env.CI,
  reporter: [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]],
  use: { baseURL, channel: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  ...(external ? {} : { webServer: { command: 'node scripts/qa/e2e-server.mjs', url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 180_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 } } }),
})
