/** Mobile lab only: all samples, a11y findings and bounded interaction observations.
 * Runs on a separate loopback QA copy. It never submits an order or CMS form.
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import lighthouse from 'lighthouse'
import { chromium } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const require = createRequire(import.meta.url)
const lighthouseRequire = createRequire(require.resolve('lighthouse'))
const chromeLauncher = await import(pathToFileURL(lighthouseRequire.resolve('chrome-launcher')).href)
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1])
const phase = args.get('--phase') || 'baseline'
const output = path.resolve(args.get('--output') || '')
const fixturePath = args.get('--fixtures')
if (!fixturePath || !args.get('--output') || !['baseline', 'after'].includes(phase)) throw new Error('Use --phase baseline|after --fixtures <private JSON> --output <private directory>.')
const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'))
const origin = new URL(fixture.origin)
if (!['localhost', '127.0.0.1'].includes(origin.hostname) || origin.protocol !== 'http:' || origin.username || origin.password) throw new Error('Quality runner is restricted to an isolated HTTP loopback copy.')
const samples = Number(args.get('--runs') || 3)
if (samples !== 3) throw new Error('Keep exactly three Lighthouse samples per route.')
const routes = [
  { name: 'home', route: fixture.routes.home },
  { name: 'category', route: fixture.routes.category },
  { name: 'product', route: fixture.routes.product },
  { name: 'course', route: fixture.routes.course },
  { name: 'cart-empty', route: '/koszyk' },
  { name: 'checkout-populated', route: '/koszyk', cart: true },
]
for (const route of routes) if (typeof route.route !== 'string' || !/^\/(?!\/)/.test(route.route) || /[?#\\]/.test(route.route)) throw new Error('Expected six public QA route paths without query secrets.')
const cart = [{ id: fixture.productID, slug: '9999201-test-qa-maska', name: 'TEST QA maska', priceCents: 3500, qty: 1, maxQty: 99 }]
const mobile = { width: 412, height: 823, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true }
const settings = {
  formFactor: 'mobile', screenEmulation: { mobile: true, width: mobile.width, height: mobile.height, deviceScaleFactor: mobile.deviceScaleFactor, disabled: false },
  throttlingMethod: 'simulate', throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4, requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675 },
  onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], disableStorageReset: true,
}
let summary = {
  phase, startedAt: new Date().toISOString(), origin: origin.origin, settings,
  method: 'Three separate cold-browser Lighthouse profiles per route; fixture localStorage survives Lighthouse reset. Server is warmed, browser HTTP cache explicitly cleared. First-visit privacy banner present. Cart-empty and checkout-populated share /koszyk.',
  bounds: ['Lab LCP/CLS and controlled interaction samples are not field p75 CWV.', 'Lighthouse TBT is not INP.', 'axe and these keyboard/reflow checks do not certify full WCAG 2.2 AA.'],
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpuCount: os.cpus().length, chromePath: chromium.executablePath(), lighthouse: require('lighthouse/package.json').version, playwright: require('@playwright/test/package.json').version },
  lighthouse: [], functional: [], cleanup: [], resources: [], failures: [],
}
await fs.mkdir(output, { recursive: true })
if (args.get('--resume') === 'true') {
  const previous = JSON.parse(await fs.readFile(path.join(output, 'summary.json'), 'utf8'))
  if (previous.phase !== phase || previous.origin !== origin.origin || JSON.stringify(previous.settings) !== JSON.stringify(settings)) throw new Error('Resume settings must match the retained samples exactly.')
  summary = previous
  summary.harnessFailures = [...(previous.harnessFailures || []), ...previous.failures]
  summary.failures = []
  summary.resources ||= []
  summary.continuedAt = new Date().toISOString()
} else {
  try { await fs.stat(path.join(output, 'summary.json')); throw new Error('Output already exists. Use a new directory or --resume true; samples are never overwritten.') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
}
const ps = promisify(execFile)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const liveOwnedPids = async (pid, profile) => {
  const found = new Set()
  if (pid) { try { process.kill(pid, 0); found.add(pid) } catch (error) { if (error.code !== 'ESRCH') throw error } }
  if (profile) {
    const { stdout } = await ps('/bin/ps', ['-axo', 'pid=,args='])
    for (const line of stdout.split('\n')) if (line.includes(`--user-data-dir=${profile}`)) { const match = line.trim().match(/^(\d+)\s/); if (match) found.add(Number(match[1])) }
  }
  return [...found].filter((foundPid) => foundPid !== process.pid)
}
const cleanupOwned = async (resource, closeActions) => {
  resource.cleanupErrors = []
  for (const close of closeActions) {
    let timeout
    try { await Promise.race([close(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Browser close exceeded 10 seconds.')), 10000) })]) }
    catch (error) { resource.cleanupErrors.push(String(error.message || error)) }
    finally { clearTimeout(timeout) }
  }
  let remaining = await liveOwnedPids(resource.pid, resource.profile)
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    if (!remaining.length) break
    resource.cleanupSignals ||= []
    for (const pid of remaining) { try { process.kill(pid, signal); resource.cleanupSignals.push({ pid, signal }) } catch (error) { if (error.code !== 'ESRCH') resource.cleanupErrors.push(String(error.message || error)) } }
    for (let attempt = 0; attempt < 20 && remaining.length; attempt++) { await pause(100); remaining = await liveOwnedPids(resource.pid, resource.profile) }
  }
  resource.remainingPids = remaining
  resource.exitConfirmed = remaining.length === 0
  resource.cleaned = false
  resource.profileRemoved = false
  if (resource.exitConfirmed && resource.profile && resource.profile.startsWith(os.tmpdir() + path.sep)) { try { await fs.rm(resource.profile, { recursive: true, force: true }); resource.profileRemoved = true } catch (error) { resource.cleanupErrors.push(String(error.message || error)) } }
  if (resource.exitConfirmed && !resource.profileRemoved) resource.cleanupErrors.push('Owned temporary profile was not confirmed/removed.')
  resource.cleaned = resource.exitConfirmed && resource.profileRemoved && resource.cleanupErrors.length === 0
  if (resource.cleanupErrors.length || !resource.exitConfirmed) summary.failures.push({ stage: 'cleanup', resource: { pid: resource.pid, profile: resource.profile }, errors: resource.cleanupErrors, remainingPids: remaining })
  summary.cleanup.push({ ...resource })
}
const step = async (route, stage) => { summary.currentFunctionalStage = { route: route.name, stage, at: new Date().toISOString() }; await save(); console.log(JSON.stringify({ phase, route: route.name, stage })) }
const save = async () => fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
const seedCart = async (page, populated) => {
  await page.goto(origin.origin, { waitUntil: 'domcontentloaded' })
  await page.evaluate(({ populated, cart }) => { localStorage.clear(); sessionStorage.clear(); if (populated) localStorage.setItem('uw-cart', JSON.stringify(cart)) }, { populated: !!populated, cart })
}
const waitReady = async (page, route) => {
  await page.locator('h1').first().waitFor()
  if (route.cart) await page.locator('form.checkout').waitFor()
  else if (route.name === 'cart-empty') await page.getByText('Koszyk jest pusty.', { exact: true }).waitFor()
  await page.locator('.privacy-banner').waitFor()
  const fontsReady = await page.evaluate(() => Promise.race([document.fonts.ready.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 15000))]))
  if (!fontsReady) throw new Error('Document fonts did not settle within 15 seconds.')
}

try {
  for (const route of routes) {
    for (let run = 1; run <= samples; run++) {
      if (summary.lighthouse.some((sample) => sample.route === route.name && sample.run === run)) continue
      const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'underwater-quality-lighthouse-'))
      const resource = { route: route.name, run, profile, cleaned: false }
      summary.resources.push(resource)
      await save()
      let chrome, browser
      try {
        chrome = await chromeLauncher.launch({ chromePath: chromium.executablePath(), userDataDir: profile, chromeFlags: ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check'] })
        resource.pid = chrome.pid
        await save()
        const browserPort = `http://127.0.0.1:${chrome.port}`
        browser = await chromium.connectOverCDP(browserPort)
        const context = browser.contexts()[0]
        const page = context.pages()[0] || await context.newPage()
        await seedCart(page, route.cart)
        const cdp = await context.newCDPSession(page)
        await cdp.send('Network.enable')
        await cdp.send('Network.clearBrowserCache')
        await cdp.detach()
        const url = new URL(route.route, origin).href
        const result = await lighthouse(url, { ...settings, port: chrome.port, output: 'json', logLevel: 'error' })
        if (!result?.lhr || result.lhr.runtimeError) throw new Error(result?.lhr.runtimeError?.message || 'No Lighthouse result.')
        const lhr = result.lhr
        const name = `${route.name}-${run}.lighthouse.json`
        await fs.writeFile(path.join(output, name), JSON.stringify(lhr, null, 2) + '\n')
        summary.environment.chromeUserAgent = lhr.environment?.hostUserAgent
        summary.lighthouse.push({ route: route.name, path: route.route, run, report: name, LCP_ms: lhr.audits['largest-contentful-paint']?.numericValue, CLS: lhr.audits['cumulative-layout-shift']?.numericValue, TBT_ms: lhr.audits['total-blocking-time']?.numericValue, performance: lhr.categories.performance?.score, accessibility: lhr.categories.accessibility?.score, settings: lhr.configSettings, LCPDetails: lhr.audits['largest-contentful-paint-element']?.details, a11yFailures: Object.values(lhr.audits).filter((audit) => audit.score === 0 && lhr.categories.accessibility.auditRefs.some((ref) => ref.id === audit.id)).map((audit) => ({ id: audit.id, title: audit.title, details: audit.details })) })
        console.log(JSON.stringify({ phase, route: route.name, run, LCP_ms: Math.round(lhr.audits['largest-contentful-paint']?.numericValue || 0), CLS: lhr.audits['cumulative-layout-shift']?.numericValue, accessibility: lhr.categories.accessibility?.score }))
      } finally {
        await cleanupOwned(resource, [async () => { if (browser) await browser.close() }, async () => { if (chrome) await chrome.kill() }])
        await save()
      }
    }
  }

  const vitalsBundle = await build({ stdin: { contents: "import {onINP} from 'web-vitals';window.__qaINP=[];onINP(m=>window.__qaINP.push({value:m.value,rating:m.rating,delta:m.delta,interactionCount:performance.interactionCount??null}),{reportAllChanges:true});window.__qaEvents=[];new PerformanceObserver(l=>{for(const e of l.getEntries())if(e.interactionId)window.__qaEvents.push({name:e.name,duration:e.duration,interactionId:e.interactionId})}).observe({type:'event',buffered:true,durationThreshold:16});", resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife' })
  const browserServer = await chromium.launchServer({ headless: true, executablePath: chromium.executablePath() })
  const browserProcess = browserServer.process()
  const interactionResource = { kind: 'functional', pid: browserProcess.pid, profile: browserProcess.spawnargs.find((arg) => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length), cleaned: false }
  let browser
  // Connecting, validation and saving are all covered by the same cleanup guard.
  try {
    summary.resources.push(interactionResource)
    if (!interactionResource.profile?.startsWith(os.tmpdir() + path.sep)) throw new Error('Unexpected programmatic browser profile location.')
    await save()
    browser = await chromium.connect(browserServer.wsEndpoint())
    summary.environment.interactionBrowserVersion = browser.version()
    for (const route of routes) {
      if (summary.functional.some((check) => check.route === route.name)) continue
      await step(route, 'context')
      const context = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: mobile.deviceScaleFactor, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
      const page = await context.newPage()
      const outsideOrigins = new Set()
      page.on('request', (request) => { const url = new URL(request.url()); if (['http:', 'https:'].includes(url.protocol) && url.origin !== origin.origin) outsideOrigins.add(url.origin) })
      try {
        await context.addInitScript(({ populated, cart }) => { localStorage.clear(); sessionStorage.clear(); if (populated) localStorage.setItem('uw-cart', JSON.stringify(cart)) }, { populated: !!route.cart, cart })
        await context.addInitScript({ content: vitalsBundle.outputFiles[0].text })
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
        const response = await page.goto(new URL(route.route, origin).href, { waitUntil: 'domcontentloaded' })
        if (response?.status() !== 200) throw new Error(`Unexpected page status ${response?.status()}.`)
        await step(route, 'wait-ready')
        await waitReady(page, route)
        await step(route, 'axe-first')
        const firstVisit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        await fs.writeFile(path.join(output, `${route.name}.axe-first-visit.json`), JSON.stringify(firstVisit, null, 2) + '\n')
        await step(route, 'screenshot-first')
        await page.screenshot({ path: path.join(output, `${route.name}.first-visit-320.png`) })
        const reflow = await page.evaluate(() => ({ viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, banner: document.querySelector('.privacy-banner')?.getBoundingClientRect().toJSON(), overflow: [...document.querySelectorAll('body *')].filter((node) => { const bounds = node.getBoundingClientRect(); return bounds.width > 0 && bounds.right > innerWidth + 1 && !node.closest('.table-scroll,.hp') }).slice(0, 20).map((node) => ({ tag: node.tagName, className: node.className, width: node.getBoundingClientRect().width })) }))
        await page.getByRole('button', { name: 'Tylko niezbędne', exact: true }).click()
        await page.locator('.privacy-banner').waitFor({ state: 'detached' })
        await step(route, 'axe-settled')
        const settled = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
        await fs.writeFile(path.join(output, `${route.name}.axe-settled.json`), JSON.stringify(settled, null, 2) + '\n')
        await step(route, 'keyboard-and-actions')
        // Exercise native dialog without submitting any form or enabling optional measurement.
        const privacyOpener = page.getByRole('button', { name: 'Ustawienia prywatności', exact: true })
        let privacyOpenerPointer = { passed: true, keyboardFallback: false }
        try { await privacyOpener.click({ timeout: 2000 }) }
        catch (error) {
          privacyOpenerPointer = { passed: false, keyboardFallback: true, message: String(error.message || error) }
          await privacyOpener.focus(); await page.keyboard.press('Enter')
        }
        const dialogOpen = await page.evaluate(() => ({ open: !!document.querySelector('dialog[open]'), focusInside: !!document.activeElement?.closest('dialog[open]') }))
        await page.keyboard.press('Escape')
        const dialogReturn = await page.evaluate(() => document.activeElement?.textContent === 'Ustawienia prywatności')
        await page.getByRole('button', { name: 'Otwórz menu', exact: true }).focus()
        await page.keyboard.press('Enter')
        let tabsToLeave = 0
        for (; tabsToLeave < 30; tabsToLeave++) {
          await page.keyboard.press('Tab')
          if (await page.evaluate(() => !document.activeElement?.closest('.head'))) break
        }
        const menuAfterTab = await page.evaluate((tabsToLeave) => {
          const active = document.activeElement, bounds = active?.getBoundingClientRect()
          const covering = bounds ? document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, bounds.left + bounds.width / 2)), Math.min(innerHeight - 1, Math.max(0, bounds.top + bounds.height / 2))) : null
          return { drawerVisible: !!document.querySelector('.drawer:not([hidden])'), focusedTag: active?.tagName, focusedText: active?.textContent?.trim().slice(0, 80), coveredByDrawer: !!covering?.closest('.drawer'), tabsToLeave }
        }, tabsToLeave)
        await page.keyboard.press('Escape')
        if (route.name === 'category') { await page.locator('.rail-m summary').click(); await page.locator('.rail-m summary').click() }
        if (route.name === 'product') { await page.getByRole('button', { name: 'Zwiększ ilość', exact: true }).click(); await page.getByRole('button', { name: 'Dodaj do koszyka', exact: true }).click() }
        if (route.name === 'course') { await page.locator('textarea[name=message]').pressSequentially('TEST QA interaction') }
        if (route.cart) { await page.getByRole('button', { name: 'Zwiększ ilość', exact: true }).click(); await page.locator('input[name=customerName]').pressSequentially('TEST QA name') }
        await page.waitForTimeout(1000)
        const interactions = await page.evaluate(() => ({ provisionalINP: window.__qaINP || [], eventTiming: window.__qaEvents || [], interactionCount: performance.interactionCount ?? null, supportedEntryTypes: PerformanceObserver.supportedEntryTypes, method: 'Controlled trusted keyboard/click actions on this page, 4x CPU throttle. Provisional web-vitals samples; not field p75. Events below 16ms are censored by Event Timing.' }))
        summary.functional.push({ route: route.name, path: route.route, cartPopulated: !!route.cart, responseStatus: response.status(), axeVersion: settled.testEngine.version, axeViolationsFirstVisit: firstVisit.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })), axeViolationsSettled: settled.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })), incompleteFirstVisit: firstVisit.incomplete.length, incompleteSettled: settled.incomplete.length, reflow, privacyOpenerPointer, dialogOpen, dialogReturn, menuAfterTab, interactions, outsideOrigins: [...outsideOrigins] })
        console.log(JSON.stringify({ phase, route: route.name, axeFirst: firstVisit.violations.length, axeSettled: settled.violations.length, horizontalOverflow: reflow.documentWidth > 321, INP_samples: interactions.provisionalINP.map((metric) => metric.value), menuCoveredFocus: menuAfterTab.coveredByDrawer }))
      } finally { try { await context.close() } catch (error) { summary.failures.push({ stage: 'functional-context-close', message: String(error.message || error) }) }; await save() }
    }
  } finally { await cleanupOwned(interactionResource, [async () => { if (browser) await browser.close() }, () => browserServer.close()]); await save() }
} catch (error) {
  summary.failures.push({ message: error instanceof Error ? error.message : String(error) })
  process.exitCode = 1
} finally {
  summary.finishedAt = new Date().toISOString()
  summary.sampleCount = summary.lighthouse.length
  summary.expectedSampleCount = routes.length * samples
  await save()
  console.log(JSON.stringify({ phase, sampleCount: summary.sampleCount, functionalCount: summary.functional.length, failures: summary.failures.length, output }))
}
