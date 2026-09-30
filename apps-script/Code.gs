/**
 * 日日記帳 — Google Apps Script backend.
 * Script properties: SPREADSHEET_ID, ALLOWED_ORIGINS (comma-separated origins).
 */
const EXPENSE_SHEET = 'Expenses';
const CATEGORY_SHEET = 'Categories';
const PEOPLE_SHEET = 'People';
const TASK_SHEET = 'DailyTasks';
const EXPENSE_HEADERS = ['id', 'date', 'main', 'sub', 'amount', 'note', 'createdAt', 'updatedAt', 'handler'];
const CATEGORY_HEADERS = ['main', 'sub', 'enabled', 'sortOrder'];
const PEOPLE_HEADERS = ['name', 'enabled', 'sortOrder'];
const TASK_HEADERS = ['date', 'content', 'createdAt', 'updatedAt'];
const INITIAL_CATEGORIES = [
  ['生活', '全聯', true, 10], ['生活', '農會', true, 20],
  ['生活', '五金行', true, 30], ['生活', '其他', true, 40],
  ['外食', '早餐', true, 50], ['外食', '午餐', true, 60], ['外食', '晚餐', true, 70],
  ['醫療', '居服費', true, 80], ['醫療', '計程車', true, 90], ['醫療', '其他', true, 100]
];

/** Run once in the Apps Script editor after setting script properties. */
function setup() {
  const spreadsheet = spreadsheet_();
  let expenses = spreadsheet.getSheetByName(EXPENSE_SHEET);
  if (!expenses) expenses = spreadsheet.insertSheet(EXPENSE_SHEET);
  let categories = spreadsheet.getSheetByName(CATEGORY_SHEET);
  if (!categories) categories = spreadsheet.insertSheet(CATEGORY_SHEET);
  let people = spreadsheet.getSheetByName(PEOPLE_SHEET);
  if (!people) people = spreadsheet.insertSheet(PEOPLE_SHEET);
  let tasks = spreadsheet.getSheetByName(TASK_SHEET);
  if (!tasks) tasks = spreadsheet.insertSheet(TASK_SHEET);
  if (expenses.getLastRow() === 0) {
    expenses.getRange(1, 1, 1, EXPENSE_HEADERS.length).setValues([EXPENSE_HEADERS]);
    expenses.setFrozenRows(1);
    expenses.getRange('B:B').setNumberFormat('@');
    expenses.getRange('E:E').setNumberFormat('#,##0.00');
  }
  if (categories.getLastRow() === 0) {
    categories.getRange(1, 1, 1, CATEGORY_HEADERS.length).setValues([CATEGORY_HEADERS]);
    categories.getRange(2, 1, INITIAL_CATEGORIES.length, CATEGORY_HEADERS.length).setValues(INITIAL_CATEGORIES);
    categories.setFrozenRows(1);
  }
  if (expenses.getRange(1, 9).getDisplayValue() === '') {
    expenses.getRange(1, 9).setValue('handler');
  }
  if (people.getLastRow() === 0) {
    people.getRange(1, 1, 1, PEOPLE_HEADERS.length).setValues([PEOPLE_HEADERS]);
    people.getRange(2, 1, 2, PEOPLE_HEADERS.length).setValues([
      ['淑花', true, 10], ['我', true, 20]
    ]);
    people.setFrozenRows(1);
  }
  if (tasks.getLastRow() === 0) {
    tasks.getRange(1, 1, 1, TASK_HEADERS.length).setValues([TASK_HEADERS]);
    tasks.getRange('A:A').setNumberFormat('@');
    tasks.setFrozenRows(1);
  }
  checkHeaders_(expenses, EXPENSE_HEADERS);
  checkHeaders_(categories, CATEGORY_HEADERS);
  checkHeaders_(people, PEOPLE_HEADERS);
  checkHeaders_(tasks, TASK_HEADERS);
  Logger.log('Setup complete: ' + spreadsheet.getUrl());
}

/** Serves the cross-origin bridge used by the GitHub Pages frontend. */
function doGet(e) {
  const token = String((e && e.parameter && e.parameter.token) || '');
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return HtmlService.createHtmlOutput('Invalid bridge request');
  }
  const template = HtmlService.createTemplateFromFile('Bridge');
  template.tokenJson = JSON.stringify(token);
  template.allowedOriginsJson = JSON.stringify(allowedOrigins_()).replace(/</g, '\\u003c');
  return template.evaluate()
    .setTitle('日日記帳資料橋接')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getMonth(payload) {
  const month = String((payload && payload.month) || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('月份格式不正確');
  const spreadsheet = spreadsheet_();
  const expenses = sheet_(spreadsheet, EXPENSE_SHEET, EXPENSE_HEADERS);
  const categories = sheet_(spreadsheet, CATEGORY_SHEET, CATEGORY_HEADERS);
  const people = sheet_(spreadsheet, PEOPLE_SHEET, PEOPLE_HEADERS);
  const tasks = sheet_(spreadsheet, TASK_SHEET, TASK_HEADERS);
  const rows = expenses.getLastRow() > 1
    ? expenses.getRange(2, 1, expenses.getLastRow() - 1, EXPENSE_HEADERS.length).getDisplayValues()
    : [];
  return {
    expenses: rows.filter(row => row[1].slice(0, 7) === month).map(row => ({
      id: row[0], date: row[1], main: row[2], sub: row[3],
      amount: Number(String(row[4]).replace(/,/g, '')), note: row[5],
      createdAt: row[6], updatedAt: row[7], handler: row[8]
    })),
    categories: activeCategories_(categories),
    people: activePeople_(people),
    tasks: tasks.getLastRow() > 1
      ? tasks.getRange(2, 1, tasks.getLastRow() - 1, TASK_HEADERS.length).getDisplayValues()
        .filter(row => row[0].slice(0, 7) === month)
        .map(row => ({ date: row[0], content: row[1], createdAt: row[2], updatedAt: row[3] }))
      : []
  };
}

function createExpense(payload) {
  const data = validateExpense_(payload);
  return withLock_(() => {
    const spreadsheet = spreadsheet_();
    const sheet = sheet_(spreadsheet, EXPENSE_SHEET, EXPENSE_HEADERS);
    assertCategory_(spreadsheet, data.main, data.sub);
    assertPerson_(spreadsheet, data.handler);
    const now = new Date().toISOString();
    const record = [Utilities.getUuid(), data.date, data.main, data.sub, data.amount, data.note, now, now, data.handler];
    writeExpenseRow_(sheet, sheet.getLastRow() + 1, record);
    return { id: record[0] };
  });
}

function updateExpense(payload) {
  const id = validateId_(payload && payload.id);
  const data = validateExpense_(payload);
  return withLock_(() => {
    const spreadsheet = spreadsheet_();
    const sheet = sheet_(spreadsheet, EXPENSE_SHEET, EXPENSE_HEADERS);
    const rowNumber = findExpenseRow_(sheet, id);
    const old = sheet.getRange(rowNumber, 1, 1, EXPENSE_HEADERS.length).getDisplayValues()[0];
    if (old[2] !== data.main || old[3] !== data.sub) assertCategory_(spreadsheet, data.main, data.sub);
    if (old[8] !== data.handler) assertPerson_(spreadsheet, data.handler);
    const record = [id, data.date, data.main, data.sub, data.amount, data.note, old[6], new Date().toISOString(), data.handler];
    writeExpenseRow_(sheet, rowNumber, record);
    return { id: id };
  });
}

function deleteExpense(payload) {
  const id = validateId_(payload && payload.id);
  return withLock_(() => {
    const sheet = sheet_(spreadsheet_(), EXPENSE_SHEET, EXPENSE_HEADERS);
    sheet.deleteRow(findExpenseRow_(sheet, id));
    return { id: id };
  });
}

/** One editable task note per calendar date. Empty content removes it. */
function saveDailyTask(payload) {
  const date = validateDate_(payload && payload.date);
  const content = String((payload && payload.content) || '').trim();
  if (content.length > 1000) throw new Error('辦理事項最多 1000 字');
  return withLock_(() => {
    const sheet = sheet_(spreadsheet_(), TASK_SHEET, TASK_HEADERS);
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues() : [];
    const index = rows.findIndex(row => row[0] === date);
    if (!content) {
      if (index >= 0) sheet.deleteRow(index + 2);
      return { date: date, content: '' };
    }
    const now = new Date().toISOString();
    const createdAt = index >= 0 ? sheet.getRange(index + 2, 3).getDisplayValue() : now;
    const rowNumber = index >= 0 ? index + 2 : sheet.getLastRow() + 1;
    const range = sheet.getRange(rowNumber, 1, 1, TASK_HEADERS.length);
    range.setNumberFormat('@');
    range.setValues([[date, safeSheetText_(content), createdAt, now]]);
    SpreadsheetApp.flush();
    return { date: date, content: content };
  });
}

function spreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('尚未設定 SPREADSHEET_ID');
  try { return SpreadsheetApp.openById(id); }
  catch (error) { throw new Error('無法開啟試算表，請確認 SPREADSHEET_ID 和授權'); }
}

function allowedOrigins_() {
  const value = PropertiesService.getScriptProperties().getProperty('ALLOWED_ORIGINS') || '';
  const origins = value.split(',').map(item => item.trim().replace(/\/$/, '')).filter(Boolean);
  if (!origins.length) throw new Error('尚未設定 ALLOWED_ORIGINS');
  origins.forEach(origin => {
    if (!/^https:\/\/[^/]+$/.test(origin) && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
      throw new Error('ALLOWED_ORIGINS 必須是網站來源，例如 https://username.github.io');
    }
  });
  return origins;
}

function sheet_(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error('找不到 ' + name + ' 工作表，請先執行 setup()');
  checkHeaders_(sheet, headers);
  return sheet;
}

function checkHeaders_(sheet, headers) {
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (actual.some((cell, index) => cell !== headers[index])) {
    throw new Error(sheet.getName() + ' 欄位標題不符，請參照 README 檢查第一列');
  }
}

function activeCategories_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(row => String(row[0]).trim() && String(row[1]).trim() && String(row[2]).toUpperCase() !== 'FALSE')
    .sort((a, b) => Number(a[3] || 0) - Number(b[3] || 0))
    .map(row => ({ main: String(row[0]).trim(), sub: String(row[1]).trim() }));
}

function activePeople_(sheet) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, PEOPLE_HEADERS.length).getValues()
    .filter(row => String(row[0]).trim() && String(row[1]).toUpperCase() !== 'FALSE')
    .sort((a, b) => Number(a[2] || 0) - Number(b[2] || 0))
    .map(row => String(row[0]).trim());
}

function assertPerson_(spreadsheet, name) {
  const people = activePeople_(sheet_(spreadsheet, PEOPLE_SHEET, PEOPLE_HEADERS));
  if (!people.includes(name)) throw new Error('經手人不存在或已停用，請重新整理頁面');
}

function assertCategory_(spreadsheet, main, sub) {
  const categories = activeCategories_(sheet_(spreadsheet, CATEGORY_SHEET, CATEGORY_HEADERS));
  if (!categories.some(item => item.main === main && item.sub === sub)) {
    throw new Error('此分類不存在或已停用，請重新整理頁面');
  }
}

function validateExpense_(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('資料格式不正確');
  const date = validateDate_(payload.date);
  const amount = Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 999999999 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) throw new Error('金額必須大於 0，最多兩位小數');
  const main = String(payload.main || '').trim();
  const sub = String(payload.sub || '').trim();
  const note = String(payload.note || '').trim();
  const handler = String(payload.handler || '').trim();
  if (!main || !sub || main.length > 50 || sub.length > 50 || note.length > 500) throw new Error('分類或備註長度不正確');
  if (!handler || handler.length > 50) throw new Error('請選擇經手人');
  return { date, amount: Math.round(amount * 100) / 100, main, sub, note, handler };
}

function validateDate_(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('日期格式不正確');
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) throw new Error('日期不存在');
  return date;
}

function validateId_(value) {
  const id = String(value || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('支出 ID 不正確');
  return id;
}

function findExpenseRow_(sheet, id) {
  if (sheet.getLastRow() < 2) throw new Error('找不到這筆支出');
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
  const index = ids.findIndex(row => row[0] === id);
  if (index < 0) throw new Error('找不到這筆支出');
  return index + 2;
}

function writeExpenseRow_(sheet, rowNumber, values) {
  const row = sheet.getRange(rowNumber, 1, 1, EXPENSE_HEADERS.length);
  row.setNumberFormat('@');
  sheet.getRange(rowNumber, 5).setNumberFormat('#,##0.00');
  const safeValues = values.slice();
  safeValues[5] = safeSheetText_(safeValues[5]);
  row.setValues([safeValues]);
  SpreadsheetApp.flush();
}

function safeSheetText_(value) {
  const text = String(value || '');
  return text.startsWith('=') ? "'" + text : text;
}

function withLock_(work) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) throw new Error('目前有其他操作進行中，請稍後重試');
  try { return work(); }
  finally { lock.releaseLock(); }
}
