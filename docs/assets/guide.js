// 指南頁互動：目錄 scroll spy、閱讀進度、複製指令、反饋 email、手機目錄
(() => {
  const body = document.body
  const product = body.dataset.product
  const pageLabel = body.dataset.page === 'dev' ? '開發者' : '用戶'

  // ---- 反饋 email：地址唔以純文字寫喺 HTML，載入後先砌出嚟，減少被爬蟲收集
  const mail = (() => {
    try {
      return atob(body.dataset.m || '').split('').reverse().join('')
    } catch {
      return ''
    }
  })()
  const mailto = (section) => {
    const subject = `[${product} / ${pageLabel} / ${section}] 意見`
    const bodyText = `章節：${section}\n頁面：${location.href.split('#')[0]}#${currentId || ''}\n\n我的意見：\n`
    return `mailto:${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`
  }
  document.querySelectorAll('a[data-mail]').forEach((a) => {
    a.href = `mailto:${mail}`
    if (!a.textContent.trim()) a.textContent = mail
  })

  // ---- scroll spy
  const headings = [...document.querySelectorAll('.content .hd')]
  const tocLinks = new Map([...document.querySelectorAll('.toc a[data-target]')].map((a) => [a.dataset.target, a]))
  let currentId = null
  let currentNum = headings[0]?.dataset.num || '1'

  const bar = document.querySelector('.progress span')
  const onScroll = () => {
    const y = window.scrollY + 120
    let active = headings[0]
    for (const h of headings) {
      if (h.offsetTop <= y) active = h
      else break
    }
    if (active && active.id !== currentId) {
      currentId = active.id
      currentNum = active.dataset.num
      // 目錄只有兩層；深層標題高亮佢所屬嘅第二層
      const parts = currentNum.split('.')
      const candidates = [currentNum, parts.slice(0, 2).join('.'), parts[0]]
      tocLinks.forEach((a) => a.classList.remove('active'))
      for (const num of candidates) {
        const h = headings.find((x) => x.dataset.num === num)
        const link = h && tocLinks.get(h.id)
        if (link) {
          link.classList.add('active')
          link.scrollIntoView({ block: 'nearest' })
          break
        }
      }
    }
    if (bar) {
      const max = document.documentElement.scrollHeight - window.innerHeight
      bar.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  // ---- 反饋掣
  document.querySelector('.fb-float')?.addEventListener('click', () => {
    location.href = mailto(currentNum)
  })
  document.querySelectorAll('a[data-fb]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault()
      location.href = mailto(a.dataset.fb)
    })
  })

  // ---- 複製指令
  document.querySelectorAll('.c-prompt .copy').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.closest('.c-prompt').querySelector('code').innerText
      try {
        await navigator.clipboard.writeText(code)
        btn.textContent = '已複製'
      } catch {
        btn.textContent = '複製失敗'
      }
      setTimeout(() => (btn.textContent = '複製'), 1600)
    })
  })

  // ---- 截圖放大：手機上截圖縮得太細，撳一下全屏睇
  const box = document.createElement('div')
  box.className = 'lightbox'
  box.hidden = true
  box.innerHTML = '<img alt="">'
  document.body.appendChild(box)
  document.querySelectorAll('figure.shot img').forEach((img) => {
    img.addEventListener('click', () => {
      box.querySelector('img').src = img.src
      box.querySelector('img').alt = img.alt
      box.hidden = false
    })
  })
  box.addEventListener('click', () => (box.hidden = true))
  document.addEventListener('keydown', (e) => e.key === 'Escape' && (box.hidden = true))

  // ---- 手機目錄
  document.querySelector('.toc-toggle')?.addEventListener('click', () => body.classList.toggle('toc-open'))
  document.querySelectorAll('.toc a').forEach((a) => a.addEventListener('click', () => body.classList.remove('toc-open')))
})()
