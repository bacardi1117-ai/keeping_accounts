"use strict";

const DEFAULT_CATEGORIES = [
  { main: "生活", sub: "全聯" }, { main: "生活", sub: "農會" }, { main: "生活", sub: "五金行" }, { main: "生活", sub: "其他" },
  { main: "外食", sub: "早餐" }, { main: "外食", sub: "午餐" }, { main: "外食", sub: "晚餐" },
  { main: "醫療", sub: "居服費" }, { main: "醫療", sub: "計程車" }, { main: "醫療", sub: "其他" }
];
const URL_KEY = "keeping_accounts_web_app_url";
const CHANNEL = "keeping-accounts-v1";
const $ = (id) => document.getElementById(id);
const money = (amount) => `NT$ ${new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(Number(amount) || 0)}`;
const pad = (number) => String(number).padStart(2, "0");
const dateKey = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
const monthKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
const today = new Date();
const state = {
  month: new Date(today.getFullYear(), today.getMonth(), 1),
  selectedDate: dateKey(today.getFullYear(), today.getMonth(), today.getDate()),
  expenses: [], categories: DEFAULT_CATEGORIES, connected: false, loading: false,
  editId: null, activeMain: null, webAppUrl: localStorage.getItem(URL_KEY) || ""
};
let bridge = null;
let toastTimer;

function toast(message) {
  const element = $("toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.hidden = true; }, 3600);
}

function validWebAppUrl(value) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname === "script.google.com" && /^\/macros\/s\/[^/]+\/exec$/.test(url.pathname);
  } catch { return false; }
}

function disposeBridge(reason = "連線已中斷") {
  if (!bridge) return;
  for (const pending of bridge.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)); }
  bridge.iframe.remove();
  bridge = null;
}

function connectBridge(url) {
  disposeBridge();
  const token = crypto.randomUUID();
  const iframe = document.createElement("iframe");
  iframe.title = "記帳資料連線";
  iframe.src = `${url}?token=${encodeURIComponent(token)}`;
  const instance = { iframe, token, pending: new Map(), ready: false };
  bridge = instance;
  $("bridgeHost").append(iframe);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (bridge === instance && !instance.ready) { disposeBridge("連線逾時"); reject(new Error("連線逾時。請檢查 Web App URL、部署權限及允許的網站來源。")); }
    }, 15000);
    instance.onReady = () => { clearTimeout(timer); resolve(); };
  });
}

window.addEventListener("message", (event) => {
  const data = event.data;
  if (!bridge || !data || data.channel !== CHANNEL || data.token !== bridge.token) return;
  if (event.origin !== "https://script.google.com" && !/^https:\/\/[a-z0-9.-]*script\.googleusercontent\.com$/.test(event.origin)) return;
  if (data.type === "ready") { bridge.targetWindow = event.source; bridge.targetOrigin = event.origin; bridge.ready = true; bridge.onReady?.(); return; }
  if (data.type !== "response") return;
  const pending = bridge.pending.get(data.id);
  if (!pending) return;
  clearTimeout(pending.timer);
  bridge.pending.delete(data.id);
  if (data.ok) pending.resolve(data.result);
  else pending.reject(new Error(data.error || "資料處理失敗"));
});

function rpc(action, payload = {}) {
  if (!bridge?.ready) return Promise.reject(new Error("尚未連接試算表"));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { bridge?.pending.delete(id); reject(new Error("讀取逾時，請稍後重試")); }, 20000);
    bridge.pending.set(id, { resolve, reject, timer });
    bridge.targetWindow.postMessage({ channel: CHANNEL, token: bridge.token, type: "request", id, action, payload }, bridge.targetOrigin);
  });
}

async function startConnection(url) {
  setConnection(false, "連線中…");
  try {
    await connectBridge(url);
    await loadMonth();
    setConnection(true, "已連線");
    $("setupBanner").hidden = true;
  } catch (error) {
    disposeBridge();
    state.expenses = [];
    state.categories = DEFAULT_CATEGORIES;
    setConnection(false, "連線失敗");
    $("setupBanner").hidden = false;
    render();
    throw error;
  }
}

function setConnection(connected, label) {
  state.connected = connected;
  const element = $("connectionStatus");
  element.textContent = label;
  element.classList.toggle("connected", connected);
}

async function loadMonth() {
  const result = await rpc("getMonth", { month: monthKey(state.month) });
  state.expenses = Array.isArray(result.expenses) ? result.expenses : [];
  state.categories = Array.isArray(result.categories) ? result.categories : [];
  if (state.activeMain && !new Set(state.categories.map((item) => item.main)).has(state.activeMain)) state.activeMain = null;
  render();
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function render() {
  const year = state.month.getFullYear();
  const month = state.month.getMonth();
  $("monthHeading").textContent = `${year} 年 ${month + 1} 月`;
  $("calendarTitle").textContent = `${year} 年 ${month + 1} 月`;
  $("monthTotal").textContent = money(state.expenses.reduce((sum, item) => sum + Number(item.amount), 0));
  $("monthCount").textContent = `${state.expenses.length} 筆消費`;
  renderCategories();
  renderCalendar();
}

function renderCategories() {
  const container = $("categorySummary");
  container.replaceChildren();
  const mains = [...new Set([...state.categories.map((item) => item.main), ...state.expenses.map((item) => item.main)])];
  for (const main of mains) {
    const total = state.expenses.filter((item) => item.main === main).reduce((sum, item) => sum + Number(item.amount), 0);
    const button = makeElement("button", `category-item${state.activeMain === main ? " active" : ""}`);
    button.type = "button";
    button.setAttribute("aria-expanded", String(state.activeMain === main));
    const title = makeElement("span", "category-name");
    title.append(makeElement("span", "category-dot"), makeElement("span", "", main));
    button.append(title, makeElement("strong", "", money(total)));
    button.addEventListener("click", () => { state.activeMain = state.activeMain === main ? null : main; renderCategories(); });
    container.append(button);
  }
  if (state.activeMain) {
    const panel = makeElement("div", "sub-summary");
    const subs = [...new Set([...state.categories.filter((item) => item.main === state.activeMain).map((item) => item.sub), ...state.expenses.filter((item) => item.main === state.activeMain).map((item) => item.sub)])];
    for (const sub of subs) {
      const total = state.expenses.filter((item) => item.main === state.activeMain && item.sub === sub).reduce((sum, item) => sum + Number(item.amount), 0);
      const row = makeElement("div", "sub-row");
      row.append(makeElement("span", "", sub), makeElement("strong", "", money(total)));
      panel.append(row);
    }
    container.append(panel);
  }
}

function renderCalendar() {
  const container = $("calendarGrid");
  container.replaceChildren();
  const year = state.month.getFullYear();
  const month = state.month.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = Math.ceil((firstWeekday + days) / 7) * 7;
  const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  for (let i = 0; i < cells; i++) {
    const date = new Date(year, month, i - firstWeekday + 1);
    const key = dateKey(date.getFullYear(), date.getMonth(), date.getDate());
    const inMonth = date.getMonth() === month;
    const entries = inMonth ? state.expenses.filter((item) => item.date === key) : [];
    const button = makeElement("button", `day-cell${!inMonth ? " outside" : ""}${key === todayKey ? " today" : ""}`);
    button.type = "button";
    button.setAttribute("aria-label", `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日，${entries.length} 筆支出`);
    button.append(makeElement("span", "day-number", date.getDate()));
    if (entries.length) {
      button.append(makeElement("span", "day-amount", money(entries.reduce((sum, item) => sum + Number(item.amount), 0)).replace("NT$ ", "$")));
      button.append(makeElement("span", "day-count", `${entries.length} 筆`));
    }
    button.addEventListener("click", async () => {
      state.selectedDate = key;
      if (!inMonth) { state.month = new Date(date.getFullYear(), date.getMonth(), 1); await changeMonth(); }
      openDay();
    });
    container.append(button);
  }
}

async function changeMonth() {
  state.expenses = [];
  render();
  if (!state.connected) return;
  try { await loadMonth(); } catch (error) { toast(error.message); }
}

function openDay() {
  const [year, month, day] = state.selectedDate.split("-").map(Number);
  $("dayDialogTitle").textContent = `${month} 月 ${day} 日`;
  const entries = state.expenses.filter((item) => item.date === state.selectedDate);
  $("dayTotal").textContent = money(entries.reduce((sum, item) => sum + Number(item.amount), 0));
  const container = $("dayEntries");
  container.replaceChildren();
  if (!entries.length) container.append(makeElement("p", "empty-state", state.connected ? "這天還沒有支出，記下第一筆吧。" : "請先完成連線，再新增支出。"));
  for (const item of entries) {
    const row = makeElement("div", "entry");
    const content = makeElement("div", "entry-content");
    content.append(makeElement("div", "entry-title", `${item.main} · ${item.sub}`), makeElement("div", "entry-note", item.note || "無備註"));
    const edit = makeElement("button", "entry-edit", "編輯");
    edit.type = "button";
    edit.addEventListener("click", () => openExpense(item));
    row.append(makeElement("span", "entry-icon", "✎"), content, makeElement("strong", "entry-amount", money(item.amount)), edit);
    container.append(row);
  }
  $("addExpenseButton").disabled = !state.connected;
  if (!$("dayDialog").open) $("dayDialog").showModal();
}

function fillMainOptions(selected) {
  const mains = [...new Set(state.categories.map((item) => item.main))];
  if (selected && !mains.includes(selected)) mains.push(selected);
  const element = $("expenseMain");
  element.replaceChildren();
  for (const main of mains) element.add(new Option(main, main));
  element.value = selected || mains[0] || "";
}

function fillSubOptions(selected) {
  const main = $("expenseMain").value;
  const subs = state.categories.filter((item) => item.main === main).map((item) => item.sub);
  if (selected && !subs.includes(selected)) subs.push(selected);
  const element = $("expenseSub");
  element.replaceChildren();
  for (const sub of subs) element.add(new Option(sub, sub));
  element.value = selected || subs[0] || "";
}

function openExpense(item = null) {
  if (!state.connected) { toast("請先連接試算表"); return; }
  state.editId = item?.id || null;
  $("expenseDialogTitle").textContent = item ? "編輯支出" : "新增支出";
  $("expenseDate").value = item?.date || state.selectedDate;
  $("expenseAmount").value = item?.amount ?? "";
  $("expenseNote").value = item?.note || "";
  fillMainOptions(item?.main);
  fillSubOptions(item?.sub);
  $("deleteExpenseButton").hidden = !item;
  $("formError").hidden = true;
  $("dayDialog").close();
  $("expenseDialog").showModal();
  $("expenseAmount").focus();
}

function setFormBusy(busy) {
  $("saveExpenseButton").disabled = busy;
  $("deleteExpenseButton").disabled = busy;
  $("saveExpenseButton").textContent = busy ? "儲存中…" : "儲存支出";
}

async function saveExpense(event) {
  event.preventDefault();
  const payload = { date: $("expenseDate").value, amount: Number($("expenseAmount").value), main: $("expenseMain").value, sub: $("expenseSub").value, note: $("expenseNote").value.trim() };
  const errorElement = $("formError");
  if (!payload.date || !Number.isFinite(payload.amount) || payload.amount <= 0 || !payload.main || !payload.sub) {
    errorElement.textContent = "請填寫日期、正確金額及分類。"; errorElement.hidden = false; return;
  }
  setFormBusy(true);
  try {
    await rpc(state.editId ? "updateExpense" : "createExpense", state.editId ? { id: state.editId, ...payload } : payload);
    $("expenseDialog").close();
    const previousDate = state.selectedDate;
    state.selectedDate = payload.date;
    const [year, month] = payload.date.split("-").map(Number);
    if (year !== state.month.getFullYear() || month !== state.month.getMonth() + 1) state.month = new Date(year, month - 1, 1);
    await loadMonth();
    openDay();
    toast(previousDate === payload.date ? "支出已儲存" : "支出已儲存，已切換至新日期");
  } catch (error) { errorElement.textContent = error.message; errorElement.hidden = false; }
  finally { setFormBusy(false); }
}

async function deleteExpense() {
  if (!state.editId || !confirm("確定刪除這筆支出？此動作無法復原。")) return;
  setFormBusy(true);
  try {
    await rpc("deleteExpense", { id: state.editId });
    $("expenseDialog").close();
    await loadMonth();
    openDay();
    toast("支出已刪除");
  } catch (error) { $("formError").textContent = error.message; $("formError").hidden = false; }
  finally { setFormBusy(false); }
}

async function saveSettings() {
  const value = $("webAppUrl").value.trim();
  const error = $("settingsError");
  error.hidden = true;
  if (!validWebAppUrl(value)) { error.textContent = "請貼上以 /exec 結尾的 Apps Script Web App 網址。"; error.hidden = false; return; }
  $("saveSettingsButton").disabled = true;
  try {
    await startConnection(value);
    localStorage.setItem(URL_KEY, value);
    state.webAppUrl = value;
    $("settingsDialog").close();
    toast("已連接 Google 試算表");
  } catch (cause) { error.textContent = cause.message; error.hidden = false; }
  finally { $("saveSettingsButton").disabled = false; }
}

function init() {
  $("prevMonth").addEventListener("click", async () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); await changeMonth(); });
  $("nextMonth").addEventListener("click", async () => { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); await changeMonth(); });
  $("todayButton").addEventListener("click", async () => { state.month = new Date(today.getFullYear(), today.getMonth(), 1); await changeMonth(); });
  $("settingsButton").addEventListener("click", () => { $("webAppUrl").value = state.webAppUrl; $("settingsError").hidden = true; $("settingsDialog").showModal(); });
  $("setupBannerButton").addEventListener("click", () => $("settingsButton").click());
  $("saveSettingsButton").addEventListener("click", saveSettings);
  $("disconnectButton").addEventListener("click", () => { disposeBridge(); localStorage.removeItem(URL_KEY); state.webAppUrl = ""; state.expenses = []; state.categories = DEFAULT_CATEGORIES; setConnection(false, "尚未連線"); $("setupBanner").hidden = false; $("settingsDialog").close(); render(); toast("已移除連線設定"); });
  $("expenseMain").addEventListener("change", () => fillSubOptions());
  $("addExpenseButton").addEventListener("click", () => openExpense());
  $("expenseForm").addEventListener("submit", saveExpense);
  $("deleteExpenseButton").addEventListener("click", deleteExpense);
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => $(button.dataset.close).close()));
  for (const dialog of document.querySelectorAll("dialog")) dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  render();
  if (state.webAppUrl && validWebAppUrl(state.webAppUrl)) startConnection(state.webAppUrl).catch((error) => toast(error.message));
  else $("setupBanner").hidden = false;
}

init();
