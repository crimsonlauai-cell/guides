#!/usr/bin/env node
/**
 * scan.mjs — 發佈前敏感資料掃描。有命中就 exit 1，唔准 push。
 *
 * 網站同 repo 都係公開嘅，所以掃描範圍係「會 commit 上去嘅一切文字」：
 * products/<slug>/ 嘅原稿、meta，同 docs/<slug>/ 嘅輸出。
 * 截圖（PNG）掃唔到內容，要靠人手逐張睇 —— SKILL.md 有規定。
 *
 * 用法：
 *   node scan.mjs <slug>          掃一個產品
 *   node scan.mjs --all           掃全部
 *
 * 確認過係安全嘅命中，寫入 products/<slug>/scan-allow.json：
 *   { "allow": ["https://as-exam-training.vercel.app"] }
 * 全站通用嘅（例如反饋 email）寫喺 site.json 的 scanAllow。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'))

const RULES = [
  // ---- 🚫 金鑰、token、密碼
  ['Anthropic key', /sk-ant-[A-Za-z0-9\-_]{20,}/g],
  ['API key (sk-)', /\bsk-[A-Za-z0-9]{32,}/g],
  ['Google API key', /\bAIza[A-Za-z0-9\-_]{30,}/g],
  ['Google AI Studio key', /\bAQ\.[A-Za-z0-9\-_]{20,}/g],
  ['GitHub token', /\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/g],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/g],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Supabase key', /\bsb_(publishable|secret)_[A-Za-z0-9_-]{4,}/g],
  ['Resend key', /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{10,}/g],
  ['Telegram bot token', /\b\d{9,10}:AA[A-Za-z0-9\-_]{30,}/g],
  ['JWT（含 Supabase anon / service_role key）', /\beyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}/g],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['變數式密鑰', /\b[A-Z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Z0-9_]*\s*[=:]\s*['"]?[^\s'"<]{12,}/g],
  ['隨手密碼', /(\b(pw|pwd|pass)\s*[:：=]\s*\S{6,}|密碼\s*[:：=]\s*[A-Za-z0-9!@#$%^&*._\-]{6,})/gi],
  // ---- 🚫 可直接呼叫嘅端點
  ['GAS Web App URL', /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+/g],
  ['Google Sheet / Doc URL', /https:\/\/docs\.google\.com\/(spreadsheets|document|forms)\/d\/[A-Za-z0-9_-]{20,}/g],
  ['Drive 資料夾 / 檔案 URL', /https:\/\/drive\.google\.com\/[^\s"')<]+/g],
  ['Supabase 專案 URL', /https:\/\/[a-z0-9]{15,}\.supabase\.co/g],
  ['Webhook URL', /https:\/\/(hooks\.slack\.com|discord(app)?\.com\/api\/webhooks|[^\s"'<]*\/webhook[s]?\/)[^\s"')<]*/gi],
  ['n8n / Make webhook', /https:\/\/[^\s"'<]*(n8n|make\.com|hook\.)[^\s"'<]*/gi],
  // ---- 🚫 雲端資源 ID
  ['GCP project id', /\bgen-lang-client-\d{6,}\b/g],
  ['Drive / Sheet ID（疑似）', /(?<![A-Za-z0-9_-])1[A-Za-z0-9_-]{32,43}(?![A-Za-z0-9_-])/g],
  // ---- ⚠️ bot 名、email、本機路徑
  ['Telegram chat ID', /(chat[_ ]?id|ALLOWED_CHAT_ID)\s*[:=：]?\s*-?\d{6,}/gi],
  ['Telegram bot 名', /@[A-Za-z0-9_]{3,}_?bot\b/gi],
  ['Email', /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g],
  ['本機路徑', /\b[A-Z]:\\Users\\[^\s"'<]+|\/Users\/[a-z][^\s"'<]*|<HOME>/g],
  ['未清洗佔位符', /<REDACTED[^>]*>|<EMAIL>/g],
]

const TEXT_EXT = new Set(['.md', '.json', '.html', '.svg', '.css', '.js', '.mjs', '.txt'])

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (TEXT_EXT.has(path.extname(f)) && f !== 'scan-allow.json') out.push(p)
  }
  return out
}

function scanSlug(slug) {
  const allowFile = path.join(ROOT, 'products', slug, 'scan-allow.json')
  const allow = new Set([...(site.scanAllow || []), ...(fs.existsSync(allowFile) ? JSON.parse(fs.readFileSync(allowFile, 'utf8')).allow : [])])
  const files = [...walk(path.join(ROOT, 'products', slug)), ...walk(path.join(ROOT, 'docs', slug))]
  const hits = []
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((line, i) => {
      for (const [name, re] of RULES) {
        re.lastIndex = 0
        for (const m of line.matchAll(re)) {
          const value = m[0]
          if ([...allow].some((a) => value === a || value.startsWith(a))) continue
          // docs/ 係 products/ 嘅輸出，同一命中只報原稿嗰次
          if (file.includes(`${path.sep}docs${path.sep}`) && hits.some((h) => h.value === value)) continue
          hits.push({ file: path.relative(ROOT, file), line: i + 1, rule: name, value })
        }
      }
    })
  }
  return hits
}

const target = process.argv[2]
if (!target) {
  console.error('用法：node scan.mjs <slug> | --all')
  process.exit(2)
}
const slugs = target === '--all' ? fs.readdirSync(path.join(ROOT, 'products')) : [target]
let total = 0
for (const slug of slugs) {
  const hits = scanSlug(slug)
  total += hits.length
  if (!hits.length) {
    console.log(`✓ ${slug}：冇命中`)
    continue
  }
  console.log(`\n✗ ${slug}：${hits.length} 個命中\n`)
  for (const h of hits) {
    const shown = h.value.length > 60 ? `${h.value.slice(0, 24)}…${h.value.slice(-8)}` : h.value
    console.log(`  [${h.rule}] ${h.file}:${h.line}\n    ${shown}`)
  }
}
if (total) {
  console.log('\n逐項處理：真係敏感就改原稿；確認安全就加入 scan-allow.json。處理完再掃一次。')
  process.exit(1)
}
