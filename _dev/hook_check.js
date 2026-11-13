// PostToolUse-хук: проверяет .jsx/.js в корне !!AE_SmallScripts сразу после записи.
// Читает JSON хука со stdin, берёт tool_input.file_path.
// Exit 2 => stderr уходит обратно в Claude как блокирующая ошибка.
//
// Ловит ровно те два класса проблем, на которые я уже напоролся:
//   1) битый синтаксис (в т.ч. съеденный бэкслеш в регекспе при записи через heredoc);
//   2) шапку @ae-script, которую лаунчер не разберёт (нет ключей / prep не открылся).
//
// Ручной прогон:  node _dev/hook_check.js --file Some_Script.jsx

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');   // корень папки со скриптами
const BS = String.fromCharCode(92);
const reBackslash = new RegExp(BS + BS, 'g');

function norm(p) { return String(p || '').replace(reBackslash, '/').toLowerCase(); }

function targetFrom(argv, stdin) {
  const i = argv.indexOf('--file');
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  try {
    const j = JSON.parse(stdin || '{}');
    return (j.tool_input && (j.tool_input.file_path || j.tool_input.notebook_path)) || '';
  } catch (e) { return ''; }
}

function relevant(file) {
  // относительный путь (ручной прогон) — от текущей папки; иначе он «не из корня» и молча пропускается
  const n = norm(path.resolve(file));
  if (!/\.(jsx|js)$/.test(n)) return false;
  const root = norm(ROOT);
  if (!n.startsWith(root + '/')) return false;
  const rel = n.slice(root.length + 1);
  if (rel === 'small_scripts_panel.jsx') return false;   // сам лаунчер — не кнопка, шапки у него нет
  return !rel.includes('/');            // только корень: _dev/ и _archive/ не трогаем
}

// повторяет parseAeScriptHeader из Small_Scripts_Panel.jsx
function parseHeader(text) {
  const m = text.slice(0, 8192).match(/\/\*\s*@ae-script\b([\s\S]*?)\*\//);
  if (!m) return null;
  const keyLineRe = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;
  const res = {};
  let key = null, buf = null;
  const flush = () => {
    if (key !== null) res[key] = buf.join('\n').replace(/\s+$/, '');
    key = null; buf = null;
  };
  for (const raw of m[1].split(/\r?\n/)) {
    const stripped = raw.replace(/^\s*\*\s?/, '');
    const top = raw.match(/^(\s*)/)[1].length === 0 || /^\s*\*/.test(raw);
    const km = top ? stripped.match(keyLineRe) : null;
    if (km) {
      flush();
      const k = km[1].toLowerCase(), v = km[2].replace(/\s+$/, '');
      if (v === '|') { key = k; buf = []; } else res[k] = v;
    } else if (key !== null) {
      buf.push(raw.replace(/^\s{0,2}/, '').replace(/^\*\s?/, ''));
    }
  }
  flush();
  return res;
}

function main(stdin) {
  const file = targetFrom(process.argv.slice(2), stdin);
  if (!file || !relevant(file)) return 0;
  if (!fs.existsSync(file)) return 0;

  const src = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  const problems = [];

  try { new vm.Script(src, { filename: file }); }
  catch (e) { problems.push('СИНТАКСИС: ' + e.message); }

  const h = parseHeader(src);
  if (!h) {
    problems.push('нет блока @ae-script — лаунчер покажет кнопку с именем файла (см. README_convention.md)');
  } else {
    for (const k of ['name', 'desc', 'prep', 'tags']) {
      if (!(k in h)) problems.push('в шапке нет ключа "' + k + '"');
    }
    if (h.prep === '|' || h.prep === '') {
      problems.push('prep пустой: многострочный блок "prep:  |" не открылся — ' +
                    'строки ниже должны идти с отступом >= 2 пробела');
    }
  }

  if (problems.length) {
    process.stderr.write('[ae-script check] ' + name + '\n' +
      problems.map(p => '  • ' + p).join('\n') + '\n');
    return 2;
  }
  return 0;
}

if (process.argv.includes('--file')) {
  process.exit(main(''));
} else {
  let stdin = '';
  process.stdin.on('data', d => (stdin += d));
  process.stdin.on('end', () => process.exit(main(stdin)));
}
