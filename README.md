# 日日記帳｜個人支出日曆

純 HTML、CSS、JavaScript 的個人支出網站。前端可放在 GitHub Pages；資料存於你自己的 Google Sheets，透過 Google Apps Script Web App 讀寫。只記支出，支援日曆、新增、編輯、刪除、每月分類與經手人統計，以及每日辦理事項，版面適用手機。

## 專案架構

```text
keeping_accounts/
├─ index.html              網站畫面
├─ styles.css              響應式樣式
├─ app.js                  日曆、統計、表單及橋接通訊
├─ apps-script/
│  ├─ Code.gs              試算表初始化與 CRUD 函式
│  └─ Bridge.html          GitHub Pages 與 Apps Script 的通訊頁
├─ tests/
│  └─ backend.test.cjs     試算表升級、經手人及事項流程測試
└─ README.md
```

不需 PHP、npm、建置工具或 Google Sheets API key。前端不保存記帳資料；Web App URL 僅存在使用者瀏覽器的 `localStorage`。換手機或瀏覽器時，需要再次輸入 URL。

## 1. 建立 Google 試算表

1. 在 [Google Sheets](https://sheets.google.com/) 新增空白試算表，例如「日日記帳資料」。**不要公開分享這份試算表。**
2. 從試算表網址複製 ID：`https://docs.google.com/spreadsheets/d/這一段是ID/edit`。
3. 選擇 **擴充功能 → Apps Script**，建立與試算表關聯的 Apps Script 專案。
4. 用本專案 `apps-script/Code.gs` 全文取代編輯器中的 `Code.gs`。
5. 在 Apps Script 左側按 **＋ → HTML**，檔名填 `Bridge`，把 `apps-script/Bridge.html` 全文貼入。檔名須是 `Bridge`，在 Apps Script 中會顯示 `Bridge.html`。

### 設定指令碼屬性

在 Apps Script 左側 **專案設定（齒輪）→ 指令碼屬性 → 新增指令碼屬性**，新增：

| 屬性名稱 | 值 | 範例 |
| --- | --- | --- |
| `SPREADSHEET_ID` | 第 2 步複製的試算表 ID | `1AbC…` |
| `ALLOWED_ORIGINS` | 網站的**來源**，只有協定與網域，無尾端 `/` 或 repository 路徑 | `https://你的帳號.github.io` |

如果本機也要測試，可用逗號加入 `http://localhost:8000`，例如 `https://你的帳號.github.io,http://localhost:8000`。GitHub Pages 專案網址雖是 `https://你的帳號.github.io/keeping_accounts/`，來源仍只填 `https://你的帳號.github.io`。自訂網域則填實際網域。這個設定是允許前端呼叫的來源清單，**不是密碼或完整身分驗證**。

在編輯器上方函式選單選 `setup`，按 **執行**。首次執行會要求授權存取試算表；完成後應新增 `Expenses`、`Categories`、`People`、`DailyTasks` 四個工作表，以及預設類別和經手人。之後再次執行 `setup` 不會清空既有資料。

### 已使用舊版網站的更新步驟

1. 將本專案**新版** `apps-script/Code.gs` 與 `apps-script/Bridge.html` 全文重新貼入 Apps Script 對應檔案並儲存。
2. 在 Apps Script 編輯器選 `setup`，再按 **執行**。它會在原有 `Expenses` 的 **I 欄**新增 `handler` 標題，並建立 `People`、`DailyTasks`；**原有支出資料不會刪除**。
3. 到 **部署 → 管理部署 → 編輯**，選擇**新版本**重新部署。通常可以沿用原 `/exec` URL。
4. 自行將更新的前端檔案推送到 GitHub，等待 Pages 更新，然後重新整理網站。

舊支出因為原本沒有經手人，月結算會列在「未指定」。編輯舊支出時選擇經手人並儲存，即可歸入該人的統計。

## 2. 試算表欄位

`setup()` 會建立以下欄位。**不要更改第一列標題或欄位順序。**

### `Expenses`

| 欄 | 名稱 | 用途 |
| --- | --- | --- |
| A | `id` | 每筆支出的 UUID，修改和刪除時使用 |
| B | `date` | 消費日期，文字格式 `YYYY-MM-DD` |
| C | `main` | 主項目，例如生活 |
| D | `sub` | 子項目，例如全聯 |
| E | `amount` | 支出金額，正數，最多兩位小數 |
| F | `note` | 該筆支出的備註，可留白 |
| G | `createdAt` | 建立時間，UTC ISO 格式 |
| H | `updatedAt` | 最近修改時間，UTC ISO 格式 |
| I | `handler` | 經手人；舊資料可留空，會列在「未指定」 |

### `Categories`

| 欄 | 名稱 | 用途 |
| --- | --- | --- |
| A | `main` | 主項目 |
| B | `sub` | 子項目 |
| C | `enabled` | `TRUE` 啟用；`FALSE` 停用 |
| D | `sortOrder` | 顯示順序，數字越小越前面 |

預設含生活（全聯、農會、五金行、其他）、外食（早餐、午餐、晚餐）、醫療（居服費、計程車、其他）。**新增分類**：在 `Categories` 最下方加一列，填主項目、子項目、`TRUE`、排序數字，重新整理網站後即可選擇。相同主項目會自動合併成一組，也能新增全新的主項目。每筆支出都有獨立備註欄；分類本身不需要備註。停用類別後，既有支出仍保留於統計中。

### `People`

| 欄 | 名稱 | 用途 |
| --- | --- | --- |
| A | `name` | 經手人名稱，預設「淑花」、「我」 |
| B | `enabled` | `TRUE` 啟用；`FALSE` 停用 |
| C | `sortOrder` | 顯示順序 |

**新增經手人**：在 `People` 最下方加一列，例如 `媽媽`、`TRUE`、`30`，重新整理網站後即可在支出表單選擇。請避免重複名稱。停用的人不再出現於新增選單，既有支出仍會列入該人的月結算。

### `DailyTasks`

| 欄 | 名稱 | 用途 |
| --- | --- | --- |
| A | `date` | 日期，文字格式 `YYYY-MM-DD`，每一天一列 |
| B | `content` | 當日辦理事項，最多 1000 字 |
| C | `createdAt` | 建立時間 |
| D | `updatedAt` | 最近修改時間 |

在日曆日期上**按滑鼠右鍵**可新增、查看、編輯辦理事項；手機和平板可**長按日期**，也可以先點日期，再按「辦理事項」。日曆只顯示欄位容得下的文字，完整內容在編輯視窗可看見。一天有一則事項；清空內容並儲存即可移除。點日期的普通操作仍是查看及新增支出。

## 3. 部署 Apps Script Web App

1. Apps Script 右上角選 **部署 → 新增部署**。
2. 類型選 **網頁應用程式（Web app）**。
3. **執行身分**選「我」。**存取權**選「任何人」（若介面顯示 *Anyone, even anonymous*，選這項）。GitHub Pages 的訪客才能從網站呼叫這個 Web App。
4. 按 **部署**並完成授權。部署完成畫面會顯示「網頁應用程式 URL」；請複製**整串以 `/exec` 結尾的網址**，例如 `https://script.google.com/macros/s/部署ID/exec`。網址中間那段是部署 ID，**不必另外複製或貼進任何程式碼**。等第 4 節的 GitHub Pages 網站開啟後，按網站右上角的 **齒輪 → Web App URL**，貼上整串網址，按 **儲存並連線**。不要使用以 `/dev` 結尾的測試網址。

**首次設定到這裡不必再修改 `Code.gs` 或 `Bridge.html`。** 前面第 1 節將專案檔案貼入 Apps Script，以及設定兩個指令碼屬性，已經是所需的程式設定。

### 日後更新 Apps Script 程式時

只有當你日後想修改記帳功能或修正程式時，才需編輯 Apps Script 裡的 `Code.gs` 或 `Bridge.html`。修改後到 **部署 → 管理部署 → 編輯**，選擇**新版本**並重新部署，既有 `/exec` 網址才會使用新程式。單純新增記帳資料、修改分類表或經手人名單、使用網站，都不需要做這一步。

前端使用嵌入的 Apps Script HTML 頁面及 `google.script.run` 取得呼叫結果。`getMonth` 讀取所選月份、分類、經手人與辦理事項；`createExpense`、`updateExpense`、`deleteExpense` 對支出執行新增、修改、刪除；`saveDailyTask` 儲存或清除當日事項。這種做法避開一般跨網域 `fetch` 對 Apps Script 回應的 CORS 限制。

## 4. 發佈 GitHub Pages

前端變更需要你自行 commit、push；本次修改不會替你操作 GitHub 或發佈。要自行發佈：

1. 在 `keeping_accounts` repository 執行 commit 與 push 到 `main` 分支。
2. 到 GitHub repository **Settings → Pages**，將 **Build and deployment → Source** 設為 **Deploy from a branch**，分支選 `main`、資料夾選 `/ (root)`，按 **Save**。
3. 等待 GitHub Pages 部署完成，開啟顯示的網址，通常是 `https://你的帳號.github.io/keeping_accounts/`。
4. 按網站右上角齒輪，貼上第 3 節取得的 `/exec` URL，按 **儲存並連線**。
5. 點日曆日期 → **新增支出**，記一筆測試資料。確認月統計和 Google Sheet 的 `Expenses` 都出現該筆資料，再試一次編輯及刪除。

若網站顯示「連線逾時」，先檢查 `/exec` URL、Web App 的存取權、`ALLOWED_ORIGINS` 是否與目前網址的來源完全相同，以及修改 Apps Script 後是否重新部署新版本。本機測試請用 HTTP 伺服器（例如 `python -m http.server 8000`）開啟 `http://localhost:8000`，不要直接雙擊 `index.html` 用 `file://` 開啟。

程式邏輯的本機測試可執行 `node tests/backend.test.cjs`。這些測試使用模擬試算表，不會連接你的 Google 帳號；完成部署後仍須在實際網站測試連線與操作。

## 存取與隱私

這是個人使用的第一版，沒有登入系統。GitHub Pages 是公開網站；Web App 設為「任何人」且「以我執行」時，部署會使用你的試算表權限。來源檢查限制橋接頁接收哪些網站訊息，但**不等同使用者驗證**，因此不要把敏感財務資料放在你無法接受公開端點風險的試算表。若需要真正的私人存取，下一版須加入可靠的登入與伺服端授權機制。不要把 Google 密碼、存取權杖、API key、試算表 ID 或私人資料提交到 repository。

資料由 Google Sheets 保存；刪除支出會刪除該列，無還原功能。建議定期使用 Google Sheets 的版本記錄或另存備份。若 Web App URL 洩漏或不再使用，請至 Apps Script **管理部署**停用該部署，並重新部署。

## 參考文件

- [Google Apps Script：部署網頁應用程式](https://developers.google.com/apps-script/guides/web)
- [Google Apps Script：HTML 頁面呼叫伺服器函式](https://developers.google.com/apps-script/guides/html/communication)
- [Google Apps Script：允許 HTML 頁面嵌入 iframe](https://developers.google.com/apps-script/reference/html/x-frame-options-mode)
- [GitHub Docs：設定 GitHub Pages 發佈來源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
