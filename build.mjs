#!/usr/bin/env node
/**
 * build.mjs — 將 products/<slug>/{user,dev}.md 砌成靜態指南網站，輸出到 docs/。
 *
 * 核心原則：Markdown 入面冇章節號。編號喺 build 時按標題層級生成，
 * 所以刪一章、加一章都自動重排，冇可能跳號。
 *
 * 用法：
 *   node build.mjs                 build 全部產品 + hub 首頁
 *   node build.mjs --only <slug>   只 build 一個產品（hub 首頁照更新）
 *   node build.mjs --strict        發佈前檢查：缺圖、斷 ref、第 4 章缺截圖一律 fail
 *   node build.mjs --shots <slug>  列出該產品仲欠嘅截圖
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(ROOT, 'docs')
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const argOf = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null)

const site = JSON.parse(fs.readFileSync(path.join(ROOT, 'site.json'), 'utf8'))
const PAGES = [
  { kind: 'user', file: 'user.md', html: 'index.html', label: '用戶指南', en: 'User Guide' },
  { kind: 'dev', file: 'dev.md', html: 'dev.html', label: '開發者筆記', en: 'Developer Notes' },
]
// 用戶頁「開始使用」章節嘅固定 id —— strict 模式靠佢判斷邊啲截圖係硬性要求
const GETTING_STARTED_ID = 'getting-started'

const errors = []
const warnings = []
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// ---------------------------------------------------------------- 預處理
/**
 * 標題語法：`## 中文標題 {English} {#custom-id}`，兩個大括號都可選。
 * 回傳 { zh, en, id }。
 */
function parseHeadingText(raw) {
  let text = raw
  let id = null
  let en = null
  text = text.replace(/\s*\{#([a-z0-9-]+)\}\s*$/i, (_, v) => ((id = v), ''))
  text = text.replace(/\s*\{([^}#][^}]*)\}\s*$/, (_, v) => ((en = v.trim()), ''))
  return { zh: text.trim(), en, id }
}

/**
 * 自訂區塊：
 *   :::prompt 標題        → 給 AI 的指令（原文照出，有複製掣）
 *   :::check / warn / tip / note / journal  → 提示框，內容照 Markdown 解析
 *   :::shot 檔名 | 圖說   → 截圖；檔案存在就出圖，未有就出「截圖待補」框
 */
function preprocessBlocks(md, ctx, toc) {
  const lines = md.split(/\r?\n/)
  const out = []
  let inFence = false
  let h = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^```/.test(line)) inFence = !inFence
    if (!inFence && /^#{1,6}\s/.test(line)) {
      const cur = toc[h++]
      if (cur) {
        ctx.currentSection = cur.num
        if (cur.depth === 1) ctx.chapterId = cur.id
      }
    }
    const m = !inFence && line.match(/^:::(\w+)\s*(.*)$/)
    if (!m) {
      out.push(line)
      continue
    }
    const [, type, rest] = m
    const body = []
    i++
    while (i < lines.length && !/^:::\s*$/.test(lines[i])) body.push(lines[i++])
    if (i >= lines.length) errors.push(`${ctx.label}: :::${type} 冇收尾嘅 :::`)
    if (type !== 'prompt' && body.some((l) => /^#{1,6}\s/.test(l))) {
      errors.push(`${ctx.label}: :::${type} 區塊入面唔可以有標題（§${ctx.currentSection}）`)
    }
    out.push(renderBlock(type, rest.trim(), body.join('\n'), ctx), '')
  }
  return out.join('\n')
}

/** 第一輪編號用：抹走 prompt / shot 區塊內文，避免入面 `#` 開頭嘅行被當成標題 */
function stripOpaqueBlocks(md) {
  return md.replace(/^:::(prompt|shot)[^\n]*\n[\s\S]*?^:::\s*$/gm, '')
}

const CALLOUTS = {
  check: '完成後應該看到',
  warn: '注意',
  tip: '提示',
  note: '補充',
  journal: '開發歷程',
  gap: '推導步驟，未經實跑驗證',
}

function renderBlock(type, rest, body, ctx) {
  if (type === 'prompt') {
    const title = rest || '給 AI 的指令'
    return `<div class="c-prompt"><div class="c-prompt-head"><span>${esc(title)}</span><button class="copy" type="button">複製</button></div><pre><code>${esc(body.trim()).replace(/\n/g, '&#10;')}</code></pre><p class="c-prompt-note">※ 由開發紀錄重建，未經逐字實跑驗證。</p></div>`
  }
  if (type === 'shot') {
    const [file, caption = ''] = rest.split('|').map((s) => s.trim())
    const rel = `images/${file}`
    const abs = path.join(ctx.productDir, rel)
    ctx.shots.push({ file, caption, spec: body.trim(), exists: fs.existsSync(abs), section: ctx.currentSection, chapter: ctx.chapterId, page: ctx.kind })
    if (fs.existsSync(abs)) {
      return `<figure class="shot"><img src="${rel}" alt="${esc(caption)}" loading="lazy"><figcaption>${esc(caption)}</figcaption></figure>`
    }
    return `<figure class="shot-missing" data-file="${esc(file)}"><div class="shot-missing-inner"><strong>截圖待補</strong><span>${esc(caption)}</span><small>${esc(body.trim()).replace(/\n/g, '<br>')}</small></div></figure>`
  }
  if (CALLOUTS[type]) {
    const title = rest || CALLOUTS[type]
    return `<div class="callout c-${type}"><div class="callout-title">${esc(title)}</div>\n\n${body}\n\n</div>`
  }
  errors.push(`${ctx.label}: 未知區塊 :::${type}`)
  return body
}

// ---------------------------------------------------------------- 編號
/**
 * 行一次 lexer，按標題層級生成編號同 id。
 * `#` = 第一層（1），`##` = 第二層（1.1），如此類推，冇層數上限（Markdown 最多六層）。
 */
function numberHeadings(tokens, ctx) {
  const counters = []
  const toc = []
  for (const t of tokens) {
    if (t.type !== 'heading') continue
    const depth = t.depth
    if (depth > counters.length + 1) {
      errors.push(`${ctx.label}: 標題「${t.text}」由第 ${counters.length} 層跳到第 ${depth} 層，中間冇上層標題`)
    }
    counters.length = depth
    for (let k = 0; k < depth; k++) counters[k] = counters[k] || 0
    counters[depth - 1] += 1
    const num = counters.slice(0, depth).join('.')
    const { zh, en, id } = parseHeadingText(t.text)
    const anchor = id || `s-${num.replace(/\./g, '-')}`
    Object.assign(t, { _num: num, _zh: zh, _en: en, _id: anchor, _depth: depth })
    t.tokens = marked.Lexer.lexInline(zh)
    toc.push({ num, zh, en, id: anchor, depth })
    if (ctx.refs.has(`${ctx.kind}#${anchor}`)) errors.push(`${ctx.label}: 重複 id「${anchor}」`)
    ctx.refs.set(`${ctx.kind}#${anchor}`, { num, zh, html: ctx.html })
  }
  return toc
}

// ---------------------------------------------------------------- 渲染
function makeRenderer(ctx) {
  const renderer = new marked.Renderer()
  renderer.heading = function (t) {
    const inner = this.parser.parseInline(t.tokens)
    const en = t._en ? ` <span class="en">${esc(t._en)}</span>` : ''
    const tag = `h${Math.min(t._depth + 1, 6)}`
    return `<${tag} id="${t._id}" class="hd d${t._depth}" data-num="${t._num}"><a class="num" href="#${t._id}">${t._num}</a><span class="zh">${inner}</span>${en}</${tag}>\n`
  }
  renderer.paragraph = function (t) {
    // 一段只有一張圖 → 升做 figure；SVG 直接 inline，令圖入面啲字 Ctrl+F 搵得到
    const only = t.tokens.filter((x) => !(x.type === 'text' && !x.text.trim()))
    if (only.length === 1 && only[0].type === 'image') return renderFigure(only[0], ctx)
    return `<p>${this.parser.parseInline(t.tokens)}</p>\n`
  }
  renderer.link = function (t) {
    const inner = this.parser.parseInline(t.tokens)
    const external = /^https?:/.test(t.href)
    return `<a href="${esc(t.href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`
  }
  renderer.table = function (t) {
    const html = marked.Renderer.prototype.table.call(this, t)
    return `<div class="table-wrap">${html}</div>`
  }
  return renderer
}

function renderFigure(img, ctx) {
  const abs = path.join(ctx.productDir, img.href)
  if (!/^https?:/.test(img.href) && !fs.existsSync(abs)) {
    errors.push(`${ctx.label}: 圖片唔存在 ${img.href}`)
    return `<figure class="shot-missing"><div class="shot-missing-inner"><strong>圖片遺失</strong><span>${esc(img.href)}</span></div></figure>`
  }
  const caption = img.text ? `<figcaption>${esc(img.text)}</figcaption>` : ''
  if (img.href.endsWith('.svg')) {
    const svg = fs
      .readFileSync(abs, 'utf8')
      .replace(/<\?xml[^>]*\?>/, '')
      .replace(/<!DOCTYPE[^>]*>/i, '')
      .replace(/<svg\b/, `<svg role="img" aria-label="${esc(img.text)}"`)
    return `<figure class="diagram">${svg}${caption}</figure>\n`
  }
  return `<figure class="shot"><img src="${esc(img.href)}" alt="${esc(img.text)}" loading="lazy">${caption}</figure>\n`
}

// ---------------------------------------------------------------- 頁面模板
function tocHtml(toc) {
  // 側邊導航只顯示頭兩層，避免目錄太長；更深層級喺內文照常編號
  const items = toc
    .filter((x) => x.depth <= 2)
    .map(
      (x) =>
        `<li class="t${x.depth}"><a href="#${x.id}" data-target="${x.id}"><span class="tn">${x.num}</span>${esc(x.zh)}</a></li>`
    )
  return `<ul>${items.join('')}</ul>`
}

function pageHtml({ meta, page, body, toc, slug }) {
  const other = PAGES.find((p) => p.kind !== page.kind)
  const title = `${meta.name}｜${page.label}`
  const mail = Buffer.from(site.feedbackEmail.split('').reverse().join('')).toString('base64')
  return `<!doctype html>
<html lang="zh-Hant-HK">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<meta name="description" content="${esc(meta.tagline)}">
<link rel="stylesheet" href="../assets/style.css">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${meta.icon || '📘'}</text></svg>">
</head>
<body data-product="${esc(slug)}" data-page="${page.kind}" data-m="${mail}">
<div class="bg" aria-hidden="true"></div>
<div class="progress" aria-hidden="true"><span></span></div>
<header class="topbar glass">
  <a class="brand" href="../">${esc(site.title)}</a>
  <span class="crumb">${esc(meta.name)}</span>
  <nav class="switch" aria-label="切換面向">
    <a href="index.html" class="${page.kind === 'user' ? 'on' : ''}">用戶<small>User</small></a>
    <a href="dev.html" class="${page.kind === 'dev' ? 'on' : ''}">開發者<small>Developer</small></a>
  </nav>
  <button class="toc-toggle" type="button" aria-label="目錄">目錄</button>
</header>
<section class="hero">
  <div class="hero-text">
    <p class="eyebrow">${esc(page.label)} <span>${esc(page.en)}</span></p>
    <h1>${esc(meta.name)}</h1>
    <p class="tagline">${esc(meta.tagline)}</p>
    <p class="meta-line">最後更新 ${esc(meta.updated)}　·　${esc(site.author)}</p>
    <div class="hero-actions">
      ${meta.publicUrl ? `<a class="hero-cta" href="${esc(meta.publicUrl)}" target="_blank" rel="noopener">開啟產品 <span>Open App</span> ↗</a>` : ''}
      <a class="hero-switch" href="${other.html}">切換至${other.label} →</a>
    </div>
    ${meta.publicUrl ? `<p class="hero-url">產品網址：<a href="${esc(meta.publicUrl)}" target="_blank" rel="noopener">${esc(meta.publicUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></p>` : ''}
  </div>
  ${meta.hero ? `<div class="hero-art">${inlineHero(meta, slug)}</div>` : ''}
</section>
<div class="layout">
  <aside class="toc glass" aria-label="目錄">${tocHtml(toc)}</aside>
  <main class="content">
${body}
  </main>
</div>
<button class="fb-float glass" type="button" aria-label="對本節有意見">對本節有意見</button>
<footer class="foot">
  <p>${esc(site.author)}　·　最後更新 ${esc(meta.updated)}</p>
  <p><a href="../">返回全部指南</a></p>
</footer>
<script src="../assets/guide.js" defer></script>
</body>
</html>
`
}

function inlineHero(meta, slug) {
  const abs = path.join(ROOT, 'products', slug, meta.hero)
  if (!fs.existsSync(abs)) {
    errors.push(`${slug}: hero 圖唔存在 ${meta.hero}`)
    return ''
  }
  if (meta.hero.endsWith('.svg')) return fs.readFileSync(abs, 'utf8').replace(/<\?xml[^>]*\?>/, '')
  return `<img src="${esc(meta.hero)}" alt="">`
}

function hubHtml(products) {
  const cards = products
    .map(
      (m) => `<article class="card glass">
  <div class="card-icon">${m.icon || '📘'}</div>
  <h2>${esc(m.name)}</h2>
  <p>${esc(m.tagline)}</p>
  <p class="card-meta">最後更新 ${esc(m.updated)}</p>
  ${m.publicUrl ? `<a class="card-app" href="${esc(m.publicUrl)}" target="_blank" rel="noopener">開啟產品 ↗</a>` : ''}
  <div class="card-links"><a href="${m.slug}/">用戶指南</a><a href="${m.slug}/dev.html">開發者筆記</a></div>
</article>`
    )
    .join('\n')
  return `<!doctype html>
<html lang="zh-Hant-HK">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(site.title)}</title>
<link rel="stylesheet" href="assets/style.css">
</head>
<body class="hub">
<div class="bg" aria-hidden="true"></div>
<section class="hero hub-hero">
  <div class="hero-text">
    <p class="eyebrow">Vibe Coding 產品指南 <span>Product Guides</span></p>
    <h1>${esc(site.title)}</h1>
    <p class="tagline">${esc(site.tagline)}</p>
    <p class="meta-line">${esc(site.author)}</p>
  </div>
</section>
<main class="cards">
${cards}
</main>
<footer class="foot"><p>${esc(site.author)}</p></footer>
</body>
</html>
`
}

// ---------------------------------------------------------------- 主流程
function buildProduct(slug) {
  const productDir = path.join(ROOT, 'products', slug)
  const meta = JSON.parse(fs.readFileSync(path.join(productDir, 'meta.json'), 'utf8'))
  meta.slug = slug
  const refs = new Map()
  const shots = []

  // 第一輪：兩頁都 lex 同編號，先收齊所有 id，交叉引用先解析得到
  const lexed = PAGES.map((page) => {
    const file = path.join(productDir, page.file)
    if (!fs.existsSync(file)) {
      errors.push(`${slug}: 缺少 ${page.file}`)
      return null
    }
    const ctx = { label: `${slug}/${page.file}`, kind: page.kind, html: page.html, productDir, refs, shots, currentSection: '' }
    const src = fs.readFileSync(file, 'utf8')
    const tokens = marked.lexer(stripOpaqueBlocks(src))
    const toc = numberHeadings(tokens, ctx)
    return { page, ctx, src, toc }
  })

  // 第二輪：渲染
  for (const item of lexed) {
    if (!item) continue
    const { page, ctx, toc } = item
    const withBlocks = preprocessBlocks(item.src, ctx, toc)
    const tokens = marked.lexer(withBlocks)
    numberHeadings(tokens, { ...ctx, refs: new Map() })
    let body = marked.parser(tokens, { renderer: makeRenderer(ctx) })
    body = resolveRefs(body, ctx, refs)
    body = wrapChapters(body)
    const outDir = path.join(OUT, slug)
    fs.mkdirSync(outDir, { recursive: true })
    fs.writeFileSync(path.join(outDir, page.html), pageHtml({ meta, page, body, toc, slug }))
    item.shots = ctx.shots
  }

  copyDir(path.join(productDir, 'images'), path.join(OUT, slug, 'images'), (f) => !f.endsWith('.svg') || f === meta.hero)
  if (meta.hero && !meta.hero.endsWith('.svg')) {
    fs.copyFileSync(path.join(productDir, meta.hero), path.join(OUT, slug, meta.hero))
  }
  return { meta, shots }
}

/** `[[#id]]` 引用同頁，`[[dev#id]]` / `[[user#id]]` 跨頁；渲染成「編號 標題」連結 */
function resolveRefs(html, ctx, refs) {
  return html.replace(/\[\[(user|dev)?#([a-z0-9-]+)\]\]/gi, (_, kind, id) => {
    const key = `${kind || ctx.kind}#${id}`
    const r = refs.get(key)
    if (!r) {
      errors.push(`${ctx.label}: 引用唔到 [[${kind || ''}#${id}]]`)
      return `<span class="xref broken">[[${kind || ''}#${id}]]</span>`
    }
    const href = (kind && kind !== ctx.kind ? r.html : '') + `#${id}`
    return `<a class="xref" href="${href}">${r.num} ${esc(r.zh)}</a>`
  })
}

/** 將每個第一層章節包成 section，方便排版同章節尾加反饋連結 */
function wrapChapters(html) {
  const parts = html.split(/(?=<h2 id="[^"]+" class="hd d1")/)
  return parts
    .map((part) => {
      const m = part.match(/^<h2 id="([^"]+)" class="hd d1" data-num="([^"]+)"/)
      if (!m) return part
      return `<section class="chapter" id="ch-${m[1]}">\n${part}<p class="chapter-fb"><a href="#" data-fb="${m[2]}">對第 ${m[2]} 章有意見？</a></p>\n</section>`
    })
    .join('')
}

function copyDir(from, to, filter = () => true) {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(to, { recursive: true })
  for (const f of fs.readdirSync(from)) {
    const src = path.join(from, f)
    if (fs.statSync(src).isDirectory()) copyDir(src, path.join(to, f), filter)
    else if (filter(f)) fs.copyFileSync(src, path.join(to, f))
  }
}

function main() {
  const productsDir = path.join(ROOT, 'products')
  const slugs = fs.readdirSync(productsDir).filter((d) => fs.existsSync(path.join(productsDir, d, 'meta.json')))
  const only = argOf('--only')
  const shotsFor = argOf('--shots')

  fs.mkdirSync(OUT, { recursive: true })
  copyDir(path.join(ROOT, 'src'), path.join(OUT, 'assets'))
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '')

  const results = []
  for (const slug of slugs) {
    if (only && slug !== only && !shotsFor) {
      results.push({ meta: { ...JSON.parse(fs.readFileSync(path.join(productsDir, slug, 'meta.json'), 'utf8')), slug } })
      continue
    }
    if (shotsFor && slug !== shotsFor) continue
    results.push({ slug, ...buildProduct(slug) })
  }

  if (shotsFor) {
    const r = results.find((x) => x.meta.slug === shotsFor)
    const missing = (r?.shots || []).filter((s) => !s.exists)
    console.log(`\n${shotsFor} 欠 ${missing.length} 張截圖：\n`)
    for (const s of missing) {
      const must = s.page === 'user' && s.chapter === GETTING_STARTED_ID ? '【必須】' : '【可佔位】'
      console.log(`${must} ${s.page} §${s.section}  images/${s.file}\n   圖說：${s.caption}\n   要求：${s.spec.replace(/\n/g, '；')}\n`)
    }
    return finish()
  }

  const products = results.map((r) => r.meta).sort((a, b) => String(b.updated).localeCompare(String(a.updated)))
  fs.writeFileSync(path.join(OUT, 'index.html'), hubHtml(products))

  if (flag('--strict')) {
    for (const r of results) {
      if (r.shots && !r.meta.publicUrl && !r.meta.noPublicUrlReason) {
        errors.push(`${r.meta.slug}: meta.json 缺 publicUrl（產品連結係指南嘅主體）；真係冇公開網址就填 noPublicUrlReason`)
      }
      for (const s of r.shots || []) {
        if (s.exists) continue
        if (s.page === 'user' && s.chapter === GETTING_STARTED_ID) {
          errors.push(`${r.meta.slug}: 用戶頁「開始使用」章節缺截圖 images/${s.file}（§${s.section}）—— 必須補齊先可以發佈`)
        } else {
          warnings.push(`${r.meta.slug}: 截圖待補 images/${s.file}（${s.page} §${s.section}），准許佔位發佈`)
        }
      }
      if (r.shots) {
        const userToc = fs.readFileSync(path.join(productsDir, r.meta.slug, 'user.md'), 'utf8')
        if (!userToc.includes(`{#${GETTING_STARTED_ID}}`)) errors.push(`${r.meta.slug}: user.md 冇 {#${GETTING_STARTED_ID}} 章節`)
      }
    }
  }
  finish()
}

function finish() {
  for (const w of warnings) console.warn(`⚠️  ${w}`)
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`)
    console.error(`\nBuild 失敗：${errors.length} 個錯誤`)
    process.exit(1)
  }
  console.log('✓ Build 完成')
}

main()
