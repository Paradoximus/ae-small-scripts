// Мини-стаб AE DOM для Pin_2D_layer_to_3D_below.jsx.
// Проверяет: на каких парах слоёв скрипт срабатывает, что за выражение пишет,
// валиден ли его синтаксис — и что происходит при обратном ходе тумблера
// (снятие выражения + запекание позиции). Плюс Scale: привязку соседней кнопки
// «Position + Scale» эта отвязывает целиком (19–21). Перекрёстные клики двух
// кнопок с честным исполнением выражений — в ae_stub_pin2d_scale.js.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'Pin_2D_layer_to_3D_below.jsx');
const TR = 'ADBE Transform Group';
const BS = String.fromCharCode(92), QT = String.fromCharCode(34);
const MARK = '@pin-2d-to-3d';

// Как выглядит уже стоящее наше выражение (то, что скрипт написал в прошлый раз).
function pinnedExpr(tail) {
  return '// ' + MARK + '\n' +
         'var src = thisComp.layer(' + QT + 'Cube' + QT + ');\n' +
         'var p = src.toComp(src.anchorPoint);\n' +
         'if (hasParent) p = parent.fromComp(p);\n' + tail;
}

// Scale, привязанный соседней кнопкой «Position + Scale» (сокращённо).
function scalePinnedExpr() {
  return '// ' + MARK + '-scale\n' +
         'var K0 = 2.13;\n' +
         'var src = thisComp.layer(' + QT + 'Cube' + QT + ');\n' +
         'var k = 2.13;\n' +
         'mul(value, k / K0)';
}

function Prop(name, owner, ops, opts) {
  opts = opts || {};
  const self = this;
  this.name = name;
  this.dimensionsSeparated = false;
  this.numKeys = opts.numKeys || 0;
  this._static = opts.value;          // что лежит в свойстве без выражения
  this._evaluated = opts.evaluated;   // что отдаёт выражение на текущем времени
  this._expr = opts.expr || '';

  Object.defineProperty(this, 'expression', {
    get() { return self._expr; },
    set(v) {
      if (opts.locked) throw new Error('property is locked');
      self._expr = v;
      ops.push({ layer: owner, prop: name, kind: v === '' ? 'clear' : 'expr', val: v });
    }
  });

  // Ключевое поведение AE: .value при живом выражении — уже результат выражения.
  Object.defineProperty(this, 'value', {
    get() {
      if (self._expr && self._expr.indexOf(MARK) !== -1) return self._evaluated;
      return self._static;
    }
  });

  this.setValue = function (v) {
    if (opts.locked) throw new Error('property is locked');
    if (self.numKeys > 0) throw new Error('cannot set value on animated property');
    self._static = v;
    ops.push({ layer: owner, prop: name, kind: 'setValue', val: v });
  };
}

function Layer(name, index, threeD, opts) {
  opts = opts || {};
  this.name = name;
  this.index = index;
  if (threeD !== undefined) this.threeDLayer = threeD;   // undefined = камера/свет
  this._sep = !!opts.separated;
  this._noTransform = !!opts.noTransform;
  this._locked = !!opts.locked;
  this._pinned = !!opts.pinned;        // на слое уже стоит наше выражение
  this._foreign = opts.foreign || '';  // чужое выражение без метки
  this._keys = opts.keys || 0;
  this._scalePinned = !!opts.scalePinned;   // Scale привязан соседней кнопкой «+ Scale»
  this._scaleKeys = opts.scaleKeys || 0;
}

function buildComp(layers, selected) {
  const ops = [];
  layers.forEach(L => {
    const props = {};
    const cfg = {
      'ADBE Position':   { value: [100, 100], evaluated: [640, 360], tail: '[p[0], p[1]]' },
      'ADBE Position_0': { value: 100,        evaluated: 640,        tail: 'p[0]' },
      'ADBE Position_1': { value: 100,        evaluated: 360,        tail: 'p[1]' }
    };
    Object.keys(cfg).forEach(mn => {
      const c = cfg[mn];
      // привязка живёт там же, где её оставил бы скрипт: объединённая Position
      // либо пара разделённых осей
      const onThis = L._sep ? (mn !== 'ADBE Position') : (mn === 'ADBE Position');
      let expr = '';
      if (L._pinned && onThis) expr = pinnedExpr(c.tail);
      else if (L._foreign && mn === 'ADBE Position') expr = L._foreign;
      props[mn] = new Prop(mn, L.name, ops, {
        locked: L._locked,
        value: c.value,
        evaluated: c.evaluated,
        expr: expr,
        numKeys: onThis ? L._keys : 0
      });
    });
    props['ADBE Scale'] = new Prop('ADBE Scale', L.name, ops, {
      locked: L._locked,
      value: [100, 100, 100],
      evaluated: [150, 150, 100],
      expr: L._scalePinned ? scalePinnedExpr() : '',
      numKeys: L._scaleKeys
    });
    props['ADBE Position'].dimensionsSeparated = L._sep;
    const tg = { property: mn => props[mn] || null };
    L.property = mn => (mn === TR ? (L._noTransform ? null : tg) : null);
    L._props = props;
  });
  const comp = Object.create(CompItem.prototype);
  comp.numLayers = layers.length;
  comp.layer = i => layers[i - 1];
  comp.selectedLayers = selected;
  return { comp, ops };
}

function CompItem() {}
function LightLayer() {}

function run(label, layers, selected) {
  const { comp, ops } = buildComp(layers, selected);
  const alerts = [];
  const sandbox = {
    app: { project: {}, beginUndoGroup: () => {}, endUndoGroup: () => {} },
    CompItem, LightLayer,
    alert: m => alerts.push(String(m)),
    $: { writeln: () => {} }
  };
  sandbox.app.project.activeItem = comp;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: SRC });

  console.log('\n=== ' + label + ' ===');
  console.log('alerts: ' + (alerts.length ? JSON.stringify(alerts) : 'нет (ок, скрипт молчаливый)'));
  if (!ops.length) { console.log('ничего не тронуто'); return; }
  ops.forEach(op => {
    const head = '--- ' + op.layer + ' :: ' + op.prop + '  ';
    if (op.kind === 'expr') {
      let ok = 'OK';
      try { new vm.Script(op.val); } catch (err) { ok = 'СИНТАКСИС: ' + err.message; }
      console.log(head + '[выражение, ' + ok + ']');
      console.log(op.val.split('\n').map(l => '    ' + l).join('\n'));
    } else if (op.kind === 'clear') {
      console.log(head + '[выражение снято]');
    } else {
      console.log(head + '[setValue ' + JSON.stringify(op.val) + ']');
    }
  });
}

// ---------- привязка ----------

// 1. валидная пара: 2D сверху, 3D снизу
let a = new Layer('flat', 1, false), b = new Layer('Cube', 2, true);
run('2D над 3D — должно сработать', [a, b], [a]);

// 2. выделенный слой сам 3D
a = new Layer('flat', 1, true); b = new Layer('Cube', 2, true);
run('выделен 3D — no-op', [a, b], [a]);

// 3. снизу 2D
a = new Layer('flat', 1, false); b = new Layer('other', 2, false);
run('снизу 2D — no-op', [a, b], [a]);

// 4. выделенный — самый нижний
a = new Layer('top', 1, true); b = new Layer('flat', 2, false);
run('выделен нижний слой — no-op', [a, b], [b]);

// 5. ничего не выделено
a = new Layer('flat', 1, false); b = new Layer('Cube', 2, true);
run('пустое выделение — no-op', [a, b], []);

// 6. дубликаты имён внизу -> ссылка по индексу
a = new Layer('flat', 1, false);
b = new Layer('Cube', 2, true);
let c = new Layer('Cube', 3, true);
run('имя-дубликат — ссылка по индексу', [a, b, c], [a]);

// 7. имя с кавычкой и бэкслешем
a = new Layer('flat', 1, false);
b = new Layer('he said ' + QT + 'hi' + QT + ' ' + BS + 'path', 2, true);
run('кавычки и бэкслеш в имени', [a, b], [a]);

// 8. separate dimensions
a = new Layer('flat', 1, false, { separated: true });
b = new Layer('Cube', 2, true);
run('Separate Dimensions — два выражения', [a, b], [a]);

// 9. свет снизу (threeDLayer отсутствует)
a = new Layer('flat', 1, false);
b = new Layer('Light 1', 2, undefined);
b.__proto__ = LightLayer.prototype; b.name = 'Light 1'; b.index = 2;
run('свет снизу — считается 3D', [a, b], [a]);

// 10. залоченное свойство — молча мимо, без исключения
a = new Layer('flat', 1, false, { locked: true });
b = new Layer('Cube', 2, true);
run('свойство не пишется — молча мимо', [a, b], [a]);

// 11. мультивыделение: валидный + невалидный
a = new Layer('flat A', 1, false);
b = new Layer('Cube', 2, true);
c = new Layer('flat B', 3, false);
let d = new Layer('flat C', 4, false);
run('мультивыделение — только валидная пара', [a, b, c, d], [a, c]);

// ---------- отвязка (обратный ход тумблера) ----------

// 12. привязанный слой — выражение снято, позиция запечена
a = new Layer('flat', 1, false, { pinned: true });
b = new Layer('Cube', 2, true);
run('ОТВЯЗКА: привязанный — снять и запечь [640,360]', [a, b], [a]);

// 13. привязанный с Separate Dimensions — обе оси
a = new Layer('flat', 1, false, { pinned: true, separated: true });
b = new Layer('Cube', 2, true);
run('ОТВЯЗКА: Separate Dimensions — обе оси', [a, b], [a]);

// 14. привязанный, но Position анимирована ключами: setValue бросил бы —
//     выражение снимаем, значение не пишем, слой уходит на свои ключи
a = new Layer('flat', 1, false, { pinned: true, keys: 3 });
b = new Layer('Cube', 2, true);
run('ОТВЯЗКА: с ключами — только снять выражение', [a, b], [a]);

// 15. привязанный, а 3D-слоя снизу уже нет — отвязка всё равно проходит
a = new Layer('flat', 1, false, { pinned: true });
b = new Layer('another flat', 2, false);
run('ОТВЯЗКА: источник снизу пропал — всё равно отвязывается', [a, b], [a]);

// 16. привязанный слой — самый нижний в компе (источник увели)
a = new Layer('top', 1, true);
b = new Layer('flat', 2, false, { pinned: true });
run('ОТВЯЗКА: привязанный внизу компа — отвязывается', [a, b], [b]);

// 17. чужое выражение без метки — не наш слой, скрипт его привязывает поверх
a = new Layer('flat', 1, false, { foreign: 'wiggle(2, 30)' });
b = new Layer('Cube', 2, true);
run('чужое выражение — считается непривязанным, пишем поверх', [a, b], [a]);

// 18. мультивыделение: один привязан, другой нет — разъезжаются в разные стороны
a = new Layer('pinned one', 1, false, { pinned: true });
b = new Layer('Cube', 2, true);
c = new Layer('free one', 3, false);
d = new Layer('Cube 2', 4, true);
run('мультивыделение: один отвязать, другой привязать', [a, b, c, d], [a, c]);

// 19. привязанный + залоченное свойство — молча мимо, без исключения
a = new Layer('flat', 1, false, { pinned: true, locked: true });
b = new Layer('Cube', 2, true);
run('ОТВЯЗКА: залоченное свойство — молча мимо', [a, b], [a]);

// ---------- привязка соседней кнопки «Position + Scale» ----------

// 20. привязан соседней кнопкой — снять и запечь и Position [640,360], и Scale [150,150]
a = new Layer('flat', 1, false, { pinned: true, scalePinned: true });
b = new Layer('Cube', 2, true);
run('ОТВЯЗКА «+ Scale»: снять и запечь Position и Scale', [a, b], [a]);

// 21. то же, Scale на ключах — Scale только снять, Position запечь
a = new Layer('flat', 1, false, { pinned: true, scalePinned: true, scaleKeys: 2 });
b = new Layer('Cube', 2, true);
run('ОТВЯЗКА «+ Scale»: Scale с ключами — только снять', [a, b], [a]);
