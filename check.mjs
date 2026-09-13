#!/usr/bin/env node
/**
 * check.mjs — 用無頭 Chrome 截指南頁面，供 AI 檢查排版。
 *
 * Browser pane 喺視窗唔喺前景時可能唔刷新畫面，截圖會空白或逾時，所以另設呢個工具。
 *
 * 用法：
 *   node check.mjs <slug> [base]
 *   base 預設 http://localhost:4330（先行 node serve.mjs）；上線後可傳 https://crimsonlauai-cell.github.io
 * 輸出：.digest/check-<slug>-*.png
 */
import fs from 'node:fs'
import { chromium } from 'playwright-core'

const [slug, base = 'http://localhost:4330'] = process.argv.slice(2)
if (!slug) {
  console.error('用法：node check.mjs <slug> [base]')
  process.exit(2)
}
fs.mkdirSync('.digest', { recursive: true })
// 只有開發者頁嘅產品：開發者頁輸出做 index.html
const metaFile = `products/${slug}/meta.json`
const onlyDev = fs.existsSync(metaFile) && JSON.stringify(JSON.parse(fs.readFileSync(metaFile, 'utf8')).pages || []) === '["dev"]'
const devPath = onlyDev ? '' : 'dev.html'
const allPages = [
  ['user-top', `/guides/${slug}/`, null, 1440, 900],
  ['user-start', `/guides/${slug}/`, '#getting-started', 1440, 900],
  ['dev-top', `/guides/${slug}/${devPath}`, null, 1440, 900],
  ['dev-build', `/guides/${slug}/${devPath}`, '#build', 1440, 900],
  ['dev-journal', `/guides/${slug}/${devPath}`, '#journal', 1440, 900],
  ['mobile', `/guides/${slug}/`, '#getting-started', 390, 844],
  ['hub', '/guides/', null, 1440, 800],
]
const browser = await chromium.launch({ channel: 'chrome' })
const pages = onlyDev ? allPages.filter(([n]) => !n.startsWith('user')) : allPages
for (const [name, url, anchor, w, h] of pages) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  const res = await page.goto(base + url, { waitUntil: 'networkidle' })
  if (anchor) {
    await page.evaluate((a) => {
      document.documentElement.style.scrollBehavior = 'auto'
      document.querySelector(a)?.scrollIntoView()
    }, anchor)
    await page.waitForTimeout(500)
  }
  const out = `.digest/check-${slug}-${name}.png`
  await page.screenshot({ path: out })
  console.log(`${res?.status()} ${out}${errors.length ? `  ⚠️ JS 錯誤：${errors.join('；')}` : ''}`)
  await page.close()
}
await browser.close()
