#!/usr/bin/env node
/**
 * shoot.mjs — 按截圖計劃自動截圖，存入 products/<slug>/images/。
 *
 * Browser pane 嘅截圖只會回傳畀 AI 睇，唔會寫落檔案，所以另外用本機 Chrome 截。
 *
 * 用法：
 *   node shoot.mjs login <slug> <url>   開一個有畫面嘅 Chrome，由「使用者本人」登入，
 *                                       登入完關閉視窗。登入狀態存喺 .shot-profile/<slug>/
 *   node shoot.mjs run <slug> [檔名…]    按 products/<slug>/shots.json 截圖（可以只截指定檔名）
 *
 * ★ AI 永遠唔代使用者輸入密碼。login 模式只負責開視窗，輸入由使用者親自做。
 *
 * shots.json 格式：
 * {
 *   "viewport": [1280, 800],
 *   "shots": [
 *     {
 *       "file": "user-home.png",
 *       "url": "https://example.com/",
 *       "steps": [                              ← 按次序執行
 *         { "click": "text=開始溫習" }, { "fill": ["input[type=date]", "2026-10-14"] },
 *         { "goto": "/practice" }, { "press": "Space" }, { "keys": ["Space", "3"], "gap": 300 },
 *         { "wait": 800 }, { "waitFor": "text=答案" }, { "scroll": ".comment" }, { "eval": "…" }
 *       ],
 *       "fresh": true,                          ← 唔用登入狀態（截登入頁）
 *       （冇 "file" 就淨係執行 steps 唔截圖，可加 "label" 方便辨認）
 *       "mask": [".user-email"],                ← 遮罩：蓋住敏感資料
 *       "css": ".debug { display:none }",       ← 截圖前注入嘅 CSS
 *       "clip": ".card",                        ← 只截某個元素（可選）
 *       "fullPage": false,
 *       "viewport": [390, 844]                  ← 單張覆寫（例如手機版）
 *     }
 *   ]
 * }
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const [mode, slug, ...rest] = process.argv.slice(2)
if (!mode || !slug) {
  console.error('用法：node shoot.mjs login <slug> <url> ｜ node shoot.mjs run <slug> [檔名…]')
  process.exit(2)
}
const profile = path.join(ROOT, '.shot-profile', slug)
const productDir = path.join(ROOT, 'products', slug)

async function launch(headless, viewport) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless,
    viewport: viewport ? { width: viewport[0], height: viewport[1] } : null,
    ...(viewport ? { deviceScaleFactor: 2 } : {}),
    locale: 'zh-HK',
  })
}

if (mode === 'login') {
  const url = rest[0]
  if (!url) throw new Error('login 要提供網址')
  const ctx = await launch(false)
  const page = ctx.pages()[0] || (await ctx.newPage())
  await page.goto(url)
  console.log('Chrome 已開啟。請親自登入，登入完成後關閉視窗。')
  await new Promise((resolve) => ctx.on('close', resolve))
  console.log('✓ 登入狀態已儲存')
} else if (mode === 'run') {
  const plan = JSON.parse(fs.readFileSync(path.join(productDir, 'shots.json'), 'utf8'))
  const only = new Set(rest)
  const shots = plan.shots.filter((s) => !only.size || only.has(s.file) || only.has(s.label))
  fs.mkdirSync(path.join(productDir, 'images'), { recursive: true })

  let failed = 0
  for (const shot of shots) {
    const viewport = shot.viewport || plan.viewport || [1280, 800]
    // fresh：唔用登入 profile，截「未登入」畫面（例如登入頁）
    const ctx = shot.fresh
      ? await (await chromium.launch({ channel: 'chrome', headless: true })).newContext({
          viewport: { width: viewport[0], height: viewport[1] }, deviceScaleFactor: 2, locale: 'zh-HK',
        })
      : await launch(true, viewport)
    const page = ctx.pages()[0] || (await ctx.newPage())
    try {
      await page.goto(shot.url, { waitUntil: 'networkidle' })
      for (const step of shot.steps || []) {
        if (step.click) await page.locator(step.click).first().click()
        else if (step.fill) await page.locator(step.fill[0]).first().fill(step.fill[1])
        else if (step.goto) await page.goto(new URL(step.goto, shot.url).href, { waitUntil: 'networkidle' })
        else if (step.keys) for (const k of step.keys) { await page.keyboard.press(k); await page.waitForTimeout(step.gap ?? 350) }
        else if (step.wait) await page.waitForTimeout(step.wait)
        else if (step.waitFor) await page.locator(step.waitFor).first().waitFor()
        else if (step.press) await page.keyboard.press(step.press)
        else if (step.scroll) await page.locator(step.scroll).first().scrollIntoViewIfNeeded()
        else if (step.eval) await page.evaluate(step.eval)
      }
      if (shot.css) await page.addStyleTag({ content: shot.css })
      await page.waitForTimeout(400)
      // 冇 file = 淨係做操作（例如預先答幾節，令主頁有進度可以展示）
      if (!shot.file) {
        console.log(`✓  （操作）${shot.label || shot.url}`)
        continue
      }
      const out = path.join(productDir, 'images', shot.file)
      const opts = {
        path: out,
        fullPage: !!shot.fullPage,
        mask: (shot.mask || []).map((sel) => page.locator(sel)),
        maskColor: '#dfe7ee',
        animations: 'disabled',
      }
      if (shot.clip) await page.locator(shot.clip).first().screenshot(opts)
      else await page.screenshot(opts)
      const loggedOut = /login|signin|sign-in/i.test(page.url())
      console.log(`${loggedOut ? '⚠️ ' : '✓ '} ${shot.file}${loggedOut ? '（似乎未登入，請先行 login）' : ''}`)
    } catch (err) {
      failed++
      console.error(`✗ ${shot.file}：${err.message.split('\n')[0]}`)
    } finally {
      await ctx.close()
      if (shot.fresh) await ctx.browser()?.close()
    }
  }
  if (failed) process.exit(1)
} else {
  console.error(`未知模式：${mode}`)
  process.exit(2)
}
