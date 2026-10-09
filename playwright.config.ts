import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const external = process.env.UNDERWATER_E2E_BASE_URL
if (external && (process.env.CI || process.env.UNDERWATER_E2E_ALLOW_OWNED_COPY !== '1')) throw new Error('An external loopback harness requires explicit disposable-copy ownership and is disabled in CI.')
const port = Number(process.env.UNDERWATER_E2E_PORT || 3013)
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('E2E requires a valid dedicated unprivileged port.')
const baseURL = external || `http://localhost:${port}`
const reportRoot = process.env.UNDERWATER_E2E_REPORT_ROOT
if (reportRoot && !path.isAbsolute(reportRoot)) throw new Error('An E2E report root must be absolute.')
const target = new URL(baseURL)
if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) || target.protocol !== 'http:' || target.username || target.password || target.pathname !== '/') throw new Error('Mutation E2E tests are restricted to an isolated HTTP loopback harness.')
export default defineConfig({
  testDir: './tests/e2e', timeout: 60_000, expect: { timeout: 15_000 },
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: !!process.env.CI,
  ...(reportRoot ? { outputDir: path.join(reportRoot, 'test-results') } : {}),
  reporter: [['list'], ['html', { open: 'never', ...(reportRoot ? { outputFolder: path.join(reportRoot, 'playwright-report') } : {}) }], ['json', { outputFile: reportRoot ? path.join(reportRoot, 'test-results/results.json') : 'test-results/results.json' }]],
  use: { baseURL, channel: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  ...(external ? {} : { webServer: { command: 'node scripts/qa/e2e-server.mjs', url: `${baseURL}/api/health`, reuseExistingServer: false, timeout: 180_000, gracefulShutdown: { signal: 'SIGTERM', timeout: 20_000 } } }),
})
