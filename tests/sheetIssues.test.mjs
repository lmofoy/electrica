// Этап 7: единый список «Замечания и ошибки» для экрана и листов.
// Порядок, нумерация, перенос строк и разбиение на страницы.
// Запуск: node tests/sheetIssues.test.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let passed = 0;
let failed = 0;
async function test(name, body) {
  try {
    await body();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n${error.stack ?? error}`);
  }
}

function finding(id, severity, message, extra = {}) {
  return { id, severity, message, ...extra };
}

let server;
try {
  server = await createServer({
    root: fileURLToPath(new URL('../', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });

  const {
    buildSheetIssues,
    wrapIssueText,
    issueLineCount,
    paginateIssues,
    summarizeIssues,
  } = await server.ssrLoadModule('/src/core/electrical/sheetIssues.ts');

  await test('ошибки идут первыми, затем замечания; нумерация 1..N', () => {
    const issues = buildSheetIssues([
      finding('w1', 'warning', 'Замечание A'),
      finding('e1', 'error', 'Ошибка B'),
      finding('w2', 'warning', 'Замечание C'),
    ]);
    assert.deepEqual(
      issues.map((issue) => issue.id),
      ['e1', 'w1', 'w2']
    );
    assert.deepEqual(
      issues.map((issue) => issue.number),
      [1, 2, 3]
    );
    assert.equal(issues[0].severity, 'error');
  });

  await test('подсказки (info) на лист не попадают по умолчанию', () => {
    const source = [
      finding('e1', 'error', 'Ошибка'),
      finding('i1', 'info', 'Подсказка'),
      finding('w1', 'warning', 'Замечание'),
    ];
    const def = buildSheetIssues(source);
    assert.deepEqual(def.map((i) => i.id), ['e1', 'w1']);
    const withInfo = buildSheetIssues(source, { includeInfo: true });
    assert.deepEqual(withInfo.map((i) => i.id), ['e1', 'w1', 'i1']);
    assert.deepEqual(
      withInfo.map((i) => i.number),
      [1, 2, 3]
    );
  });

  await test('lineId и reference сохраняются для маркеров и ссылок', () => {
    const [issue] = buildSheetIssues([
      finding('x', 'warning', 'Текст', {
        reference: 'ПУЭ-7, гл. 1.3',
        lineId: 'line-2',
      }),
    ]);
    assert.equal(issue.reference, 'ПУЭ-7, гл. 1.3');
    assert.equal(issue.lineId, 'line-2');
  });

  await test('пустой вход даёт пустой список', () => {
    assert.deepEqual(buildSheetIssues([]), []);
  });

  await test('перенос текста уважает лимит и не теряет слова', () => {
    const text = 'Кабель сечением 1,5 мм² не проходит по нагреву для линии освещения';
    const lines = wrapIssueText(text, 20);
    assert.ok(lines.length > 1, 'текст должен переноситься на несколько строк');
    for (const line of lines) {
      assert.ok(line.length <= 20, `строка длиннее лимита: «${line}»`);
    }
    assert.equal(lines.join(' '), text, 'слова не потерялись и не переставлены');
  });

  await test('длина записи = строки сообщения + строка ссылки', () => {
    const noRef = buildSheetIssues([finding('a', 'error', 'коротко')])[0];
    assert.equal(issueLineCount(noRef, 100), 1);
    const withRef = buildSheetIssues([
      finding('b', 'error', 'коротко', { reference: 'ПУЭ-7' }),
    ])[0];
    assert.equal(issueLineCount(withRef, 100), 2);
  });

  await test('разбиение на страницы сохраняет порядок и не рвёт записи', () => {
    const issues = buildSheetIssues([
      finding('i1', 'error', 'one'),
      finding('i2', 'warning', 'two', { reference: 'r' }),
      finding('i3', 'warning', 'three'),
      finding('i4', 'warning', 'four', { reference: 'r' }),
    ]);
    const pages = paginateIssues(issues, 200, 3);
    assert.equal(pages.length, 2);
    assert.deepEqual(
      pages.map((page) => page.map((issue) => issue.id)),
      [
        ['i1', 'i2'],
        ['i3', 'i4'],
      ]
    );
    for (const page of pages) {
      const lines = page.reduce(
        (sum, issue) => sum + issueLineCount(issue, 200),
        0
      );
      assert.ok(lines <= 3, `страница переполнена: ${lines} строк`);
    }
  });

  await test('слишком длинная запись занимает отдельную страницу целиком', () => {
    const long = buildSheetIssues([
      finding('big', 'error', 'слово '.repeat(80).trim()),
    ]);
    const pages = paginateIssues(long, 10, 2);
    assert.equal(pages.length, 1);
    assert.equal(pages[0][0].id, 'big');
  });

  await test('пустой список даёт ноль страниц', () => {
    assert.deepEqual(paginateIssues([], 100, 10), []);
  });

  await test('сводка: статус и текст по ошибкам/замечаниям', () => {
    const err = summarizeIssues(
      buildSheetIssues([
        finding('e', 'error', 'Ошибка'),
        finding('w', 'warning', 'Замечание'),
      ])
    );
    assert.equal(err.status, 'errors');
    assert.equal(err.errors, 1);
    assert.equal(err.warnings, 1);
    assert.equal(err.text, 'Ошибок: 1');

    const warn = summarizeIssues(
      buildSheetIssues([finding('w', 'warning', 'Замечание')])
    );
    assert.equal(warn.status, 'warnings');
    assert.equal(warn.text, 'Замечаний: 1');

    const ok = summarizeIssues([]);
    assert.equal(ok.status, 'ok');
    assert.equal(ok.text, 'Нормы соблюдены');

    const custom = summarizeIssues([], { emptyLabel: 'Группы не заданы' });
    assert.equal(custom.text, 'Группы не заданы');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} finally {
  await server?.close();
}
