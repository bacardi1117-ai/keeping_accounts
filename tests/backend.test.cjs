const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Sheet {
  constructor(name, rows = []) { this.name = name; this.rows = rows; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  setFrozenRows() {}
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  getRange(row, column, height = 1, width = 1) {
    if (typeof row === 'string') return { setNumberFormat() {} };
    const sheet = this;
    return {
      setNumberFormat() { return this; },
      getValues() { return Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => sheet.rows[row + r - 1]?.[column + c - 1] ?? '')); },
      getDisplayValues() { return this.getValues().map(cells => cells.map(value => String(value).replace(/^'(?==)/, ''))); },
      getDisplayValue() { return this.getDisplayValues()[0][0]; },
      setValue(value) { return this.setValues([[value]]); },
      setValues(values) {
        values.forEach((cells, r) => {
          const index = row + r - 1;
          while (sheet.rows.length <= index) sheet.rows.push([]);
          cells.forEach((value, c) => { sheet.rows[index][column + c - 1] = value; });
        });
        return this;
      }
    };
  }
}

function backend() {
  const sheets = new Map([
    ['Expenses', new Sheet('Expenses', [
      ['id', 'date', 'main', 'sub', 'amount', 'note', 'createdAt', 'updatedAt'],
      ['old-id', '2026-09-10', '生活', '全聯', 50, '舊資料', 'old-time', 'old-time']
    ])],
    ['Categories', new Sheet('Categories', [
      ['main', 'sub', 'enabled', 'sortOrder'], ['生活', '全聯', true, 10]
    ])]
  ]);
  const spreadsheet = {
    getSheetByName(name) { return sheets.get(name); },
    insertSheet(name) { const sheet = new Sheet(name); sheets.set(name, sheet); return sheet; },
    getUrl() { return 'test'; }
  };
  const context = {
    Date, Number, String, Error, Array, Math,
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => key === 'SPREADSHEET_ID' ? 'test' : 'https://example.com' }) },
    SpreadsheetApp: { openById: () => spreadsheet, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Utilities: { getUuid: () => '12345678-1234-1234-1234-123456789abc' },
    Logger: { log() {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), context);
  return { api: context, sheets };
}

test('setup migrates old expenses without changing records', () => {
  const { api, sheets } = backend();
  api.setup();
  assert.equal(sheets.get('Expenses').rows[0][8], 'handler');
  assert.equal(sheets.get('Expenses').rows[1][4], 50);
  assert.deepEqual(sheets.get('People').rows.slice(1).map(row => row[0]), ['淑花', '我']);
  assert.equal(sheets.get('DailyTasks').rows[0][0], 'date');
  api.setup();
  assert.equal(sheets.get('Expenses').rows.length, 2);
  assert.equal(sheets.get('People').rows.length, 3);
});

test('expense handler is saved, updated, and returned in month data', () => {
  const { api, sheets } = backend();
  api.setup();
  sheets.get('People').getRange(4, 1, 1, 3).setValues([['媽媽', true, 30]]);
  assert.ok(api.getMonth({ month: '2026-09' }).people.includes('媽媽'));
  const record = api.createExpense({ date: '2026-09-12', main: '生活', sub: '全聯', amount: 125.5, note: '=danger', handler: '淑花' });
  let month = api.getMonth({ month: '2026-09' });
  assert.equal(month.expenses.find(item => item.id === record.id).handler, '淑花');
  assert.equal(month.expenses.find(item => item.id === record.id).note, '=danger');
  assert.equal(month.expenses.find(item => item.id === 'old-id').handler, '');
  api.updateExpense({ id: record.id, date: '2026-09-12', main: '生活', sub: '全聯', amount: 30, note: '更新', handler: '我' });
  month = api.getMonth({ month: '2026-09' });
  assert.equal(month.expenses.find(item => item.id === record.id).handler, '我');
  api.deleteExpense({ id: record.id });
  assert.equal(api.getMonth({ month: '2026-09' }).expenses.length, 1);
});

test('daily task can be saved, edited, and cleared', () => {
  const { api } = backend();
  api.setup();
  api.saveDailyTask({ date: '2026-09-14', content: '買藥' });
  assert.equal(api.getMonth({ month: '2026-09' }).tasks[0].content, '買藥');
  api.saveDailyTask({ date: '2026-09-14', content: '買藥並領文件' });
  assert.equal(api.getMonth({ month: '2026-09' }).tasks.length, 1);
  assert.equal(api.getMonth({ month: '2026-09' }).tasks[0].content, '買藥並領文件');
  api.saveDailyTask({ date: '2026-09-14', content: '' });
  assert.equal(api.getMonth({ month: '2026-09' }).tasks.length, 0);
});
