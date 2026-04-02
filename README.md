# Notesite

一個全螢幕、單頁式的筆記本網站。進站後直接就是工作區，只有兩個模式：

- `筆記`
- `To-Do List`

資料不是存在 `localStorage`，而是存在雲端 Postgres，所以可以跨分頁、跨視窗、跨裝置同步。前端另外搭配：

- `BroadcastChannel` 做同瀏覽器分頁即時同步
- 5 秒輪詢 + focus / visibility revalidate
- `Cache-Control: no-store` 避免舊快取覆蓋新資料
- 筆記 `revision` 檢查，降低衝突時的覆蓋風險

## 技術棧

- Next.js App Router
- TypeScript
- Route Handlers API
- Postgres
- Vercel 相容部署

## 功能

- 全螢幕單頁工作區，不用再點進去
- 模式切換會記住上次停留的模式
- 筆記區自動儲存、重新整理後保留
- To-Do 可新增 / 勾選 / 編輯 / 刪除
- 最新待辦固定顯示在最上面
- 即時計算總金額與未勾選金額
- 自家 modal，不使用瀏覽器原生 `prompt / alert / confirm`
- 手機、iPad、桌機都有重排版

## 專案結構

```text
.
|-- app
|   |-- api
|   |   |-- note/route.ts
|   |   |-- state/route.ts
|   |   `-- todos
|   |       |-- [id]/route.ts
|   |       `-- route.ts
|   |-- globals.css
|   |-- icon.svg
|   |-- layout.tsx
|   `-- page.tsx
|-- components
|   |-- notebook-workspace.module.css
|   `-- notebook-workspace.tsx
|-- lib
|   |-- db.ts
|   |-- env.ts
|   |-- http.ts
|   |-- money.ts
|   `-- notebook.ts
|-- types
|   `-- notebook.ts
|-- .env.example
`-- README.md
```

## 本機開發

1. 安裝依賴

```bash
npm install
```

2. 建立環境變數

把 `.env.example` 複製成 `.env.local`

3. 填入 Postgres 連線字串後啟動

```bash
npm run dev
```

4. 開啟 `http://localhost:3000`

## 環境變數

### `DATABASE_URL`

必要。Postgres 連線字串。

建議做法：

- 在 Vercel 專案上加一個 Postgres 服務
- 最簡單是直接使用 Vercel Marketplace 可接上的 Postgres 供應商，例如 Neon
- 把供應商提供的 connection string 設成 `DATABASE_URL`

### `NOTEBOOK_ID`

選填。預設是 `default-notebook`。

用途：

- 決定這個部署實際讀寫哪一份筆記本資料
- 如果你有 preview / production 想分開，或同一個資料庫想切不同筆記本，可以改這個值

## 部署到 GitHub + Vercel

1. 把專案推到 GitHub
2. 在 Vercel 匯入這個 repo
3. 在 Vercel 專案設定加入 `DATABASE_URL`
4. 視需要加入 `NOTEBOOK_ID`
5. 重新部署

部署完成後，第一次 API 被呼叫時會自動建立資料表，不需要另外手動跑 migration。

## 資料表

啟動時會自動建立兩張表：

- `notebooks`
- `todos`

其中：

- `notebooks` 會保存筆記內容、筆記 revision、整體 state revision
- `todos` 會保存待辦項目、價格、完成狀態與時間戳

## 同步設計

- 筆記與待辦都存在 Postgres，不依賴單一瀏覽器
- 同瀏覽器多分頁優先用 `BroadcastChannel`
- 不同裝置靠 API 輪詢與 focus revalidate
- API 全部回傳 `no-store`
- 筆記儲存帶 `baseRevision`，如果另一台裝置先改過，前端會開衝突 modal 讓你選擇保留哪個版本

## 指令

```bash
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
```
