# Crimson Guides

Vibe Coding 產品指南網站。每個產品有「用戶指南」同「開發者筆記」兩面。

- 內容：`products/<slug>/user.md`、`dev.md`、`meta.json`、`images/`
- 輸出：`docs/`（GitHub Pages 由 `main` 分支 `/docs` 發佈）
- 由 `product-guide` skill 產生同維護

```bash
npm install
npm run build          # build 全部
npm run strict         # 發佈前檢查
node scan.mjs <slug>   # 敏感資料掃描
npm run serve          # 本機預覽 http://localhost:4330/guides/
```

章節號由 build 自動生成，Markdown 入面唔寫數字。語法見 skill 嘅 `references/markdown-syntax.md`。
