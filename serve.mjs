// 本機預覽：將 docs/ 以 /guides/ 路徑 serve，模擬 GitHub Pages 嘅子路徑
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'docs')
const PORT = Number(process.env.PORT) || 4330
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }

http
  .createServer((req, res) => {
    let url = decodeURIComponent(req.url.split('?')[0])
    if (url === '/') return res.writeHead(302, { Location: '/guides/' }).end()
    if (!url.startsWith('/guides/')) return res.writeHead(404).end('not found')
    let file = path.join(DOCS, url.slice('/guides/'.length))
    if (!file.startsWith(DOCS)) return res.writeHead(403).end()
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!fs.existsSync(file)) return res.writeHead(404).end('not found')
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  .listen(PORT, () => console.log(`http://localhost:${PORT}/guides/`))
