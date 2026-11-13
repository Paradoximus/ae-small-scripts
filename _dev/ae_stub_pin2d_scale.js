// Стаб AE DOM + 3D-модель сцены для Pin_2D_layer_to_3D_below_scale.jsx.
//
// Часть 1 — логика скрипта на DOM: на чём срабатывает, что пишет, тумблер,
//   перекрёстные клики с соседней кнопкой (Pin_2D_layer_to_3D_below.jsx).
// Часть 2 — математика: записанные выражения исполняются на модели
//   world = Parent·(pos + R·S·(pt − anchor)) и перспективной камере AE
//   (screen = center + zoom·(x/z, y/z) в осях камеры), Scale сверяется
//   с эталоном видимого размера = Scale источника · zoom / глубина.
//
// .value у свойства с живым выражением здесь, как в AE, — результат выражения:
// стаб его честно исполняет. Ошибка выражения → expressionError, и выражение
// выключается, как в AE.
//
// Чего стаб НЕ проверяет: что AE на самом деле отдаёт результат только что
// поставленного выражения через valueAtTime(t, false) (на этом стоит калибровка),
// и семантику toComp у света. Это — только в самом AE.
//
// Запуск: node _dev/ae_stub_pin2d_scale.js

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const DIR = path.join(__dirname, '..');
const NEW = fs.readFileSync(path.join(DIR, 'Pin_2D_layer_to_3D_below_scale.jsx'), 'utf8');
const OLD = fs.readFileSync(path.join(DIR, 'Pin_2D_layer_to_3D_below.jsx'), 'utf8');
const TR = 'ADBE Transform Group';
const BS = String.fromCharCode(92), QT = String.fromCharCode(34);
const MARK = '@pin-2d-to-3d', MARK_SCALE = MARK + '-scale';
const CW = 1920, CH = 1080, F50 = CW * 50 / 36;   // зум 50-мм камеры на ширине 1920

let PASS = 0, FAIL = 0;
function check(label, cond, extra) {
  if (cond) PASS++; else FAIL++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (extra ? '   (' + extra + ')' : ''));
}
function head(s) { console.log('\n=== ' + s + ' ==='); }

// ---------- векторы и повороты ----------
const V = {
  add: (a, b) => Array.from(a).map((x, i) => x + (b[i] || 0)),
  sub: (a, b) => Array.from(a).map((x, i) => x - (b[i] || 0)),
  mul: (a, k) => Array.from(a).map(x => x * k),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }
};
// R = Rz·Ry·Rx, градусы. Порядок осей тут не важен: проверяется инвариантность к повороту.
function rotMat(r) {
  const [x, y, z] = r.map(d => d * Math.PI / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx]
  ];
}
const mv = (M, v) => [V.dot(M[0], v), V.dot(M[1], v), V.dot(M[2], v)];
const col = (M, j) => [M[0][j], M[1][j], M[2][j]];

// ---------- 3D-модель: слой и камера ----------
// Поле — значение или функция времени (анимация).
const at = (v, t) => (typeof v === 'function' ? v(t) : v);

function M3(o) {
  return Object.assign({ pos: [CW / 2, CH / 2, 0], anchor: [0, 0, 0], rot: [0, 0, 0],
                         scale: [100, 100, 100], parent: null, light: false }, o);
}
// У света нет ни Anchor Point, ни Scale: начало его координат — его позиция.
function toWorld(m, pt, t) {
  const A = m.light ? [0, 0, 0] : at(m.anchor, t), S = m.light ? [100, 100, 100] : at(m.scale, t);
  const v = [0, 1, 2].map(i => (pt[i] - A[i]) * S[i] / 100);
  const w = V.add(at(m.pos, t), mv(rotMat(at(m.rot, t)), v));
  return m.parent ? toWorld(m.parent, w, t) : w;
}
function worldScale(m, t) {
  const s = m.light ? 1 : at(m.scale, t)[0] / 100;
  return m.parent ? s * worldScale(m.parent, t) : s;
}

// Камера AE: оси X вправо, Y вниз, Z — куда смотрит. Двухузловая — через POI.
// Без камеры в компе AE смотрит через дефолтную: она такая же, без поворота.
function Cam(o) { return Object.assign({ pos: [CW / 2, CH / 2, -F50], poi: null, rot: [0, 0, 0], zoom: F50 }, o); }
function camBasis(c, t) {
  if (c.poi) {
    const f = V.norm(V.sub(at(c.poi, t), at(c.pos, t)));
    const r = V.norm(V.cross([0, 1, 0], f));
    return [r, V.cross(f, r), f];
  }
  const R = rotMat(at(c.rot, t));
  return [col(R, 0), col(R, 1), col(R, 2)];
}
function camSpace(c, w, t) {
  const q = V.sub(w, at(c.pos, t)), B = camBasis(c, t);
  return [V.dot(q, B[0]), V.dot(q, B[1]), V.dot(q, B[2])];
}
function project(c, w, t) {
  const q = camSpace(c, w, t), z = at(c.zoom, t);
  return [CW / 2 + z * q[0] / q[2], CH / 2 + z * q[1] / q[2], q[2]];
}
// Эталон видимого размера источника (для равномерного Scale): Scale · zoom / глубина.
function seenTrue(comp, m, t) {
  const pt = m.light ? [0, 0, 0] : at(m.anchor, t);
  return worldScale(m, t) * at(comp.cam.zoom, t) / camSpace(comp.cam, toWorld(m, pt, t), t)[2];
}

// ---------- вычисление выражений ----------
// thisComp.layer(...) отдаёт фасад слоя модели. У света обращение к anchorPoint
// бросает, как в AE, — так ловится, если скрипт полезет к нему.
function facade(comp, x, t) {
  const L = typeof x === 'number' ? comp.layers[x - 1] : comp.layers.find(l => l.name === x);
  if (!L) throw new Error('нет слоя ' + x);
  if (!L.m) throw new Error('stub: у слоя ' + L.name + ' нет 3D-модели');
  const f = {
    toComp(pt, tt) {
      const T = tt === undefined ? t : tt;
      return project(comp.cam, toWorld(L.m, Array.from(pt), T), T);
    }
  };
  if (L.m.light) {
    Object.defineProperty(f, 'anchorPoint', { get() {
      comp.lightAnchorTouched = true;
      throw new Error("property or method named 'anchorPoint' in Class 'Layer' is missing or does not exist");
    } });
  } else {
    const ap = at(L.m.anchor, t).slice();
    ap.value = ap.slice();
    f.anchorPoint = ap;
  }
  return f;
}

function evalExpr(text, prop, t) {
  if (prop.failProbe && text.indexOf('проба') !== -1) throw new Error('stub: ошибка в выражении');
  const comp = prop.owner.comp;
  const own = at(prop.own, t);
  const ctx = vm.createContext({
    Math, time: t,
    value: Array.isArray(own) ? own.slice(0, 2) : own,   // у 2D-слоя Position/Scale в выражении двумерны
    hasParent: false, parent: null,
    add: V.add, sub: V.sub, mul: V.mul,
    thisComp: { layer: x => facade(comp, x, t) }
  });
  const r = new vm.Script(text).runInContext(ctx);
  const arr = Array.isArray(r) ? Array.from(r) : null;
  if (arr && arr.length !== 2) throw new Error('expression result must be of dimension 2, not ' + arr.length);
  if ((arr || [r]).some(x => typeof x !== 'number' || !isFinite(x))) throw new Error('результат не число: ' + r);
  return arr || r;
}

// ---------- DOM ----------
function CompItem() {}
function LightLayer() {}
let OPS = [];

class Prop {
  constructor(owner, mn, own, o) {
    o = o || {};
    this.owner = owner; this.mn = mn; this.own = own;   // own — значение без выражения (или функция времени)
    this.numKeys = o.keys || 0;
    this._expr = o.expr || '';
    this._on = o.on !== false;
    this.locked = !!o.locked;
    this.failProbe = !!o.failProbe;
    this.expressionError = '';
    this.dimensionsSeparated = false;
  }
  get expression() { return this._expr; }
  set expression(v) {
    if (this.locked) throw new Error('property is locked');
    this._expr = v; this.expressionError = '';
    OPS.push({ layer: this.owner.name, prop: this.mn, kind: v === '' ? 'clear' : 'expr', val: v });
  }
  get expressionEnabled() { return this._on; }
  set expressionEnabled(v) {
    if (this.locked) throw new Error('property is locked');
    if (v && this._expr) {
      try { evalExpr(this._expr, this, this.owner.comp.time); }
      catch (e) { throw new Error('expression is not valid: ' + e.message); }
    }
    this._on = !!v;
  }
  valueAtTime(t, pre) {
    const own = at(this.own, t);
    if (pre || !this._expr || !this._on) return own;
    try {
      const r = evalExpr(this._expr, this, t);
      this.expressionError = '';
      return Array.isArray(own) ? r.concat(own.slice(r.length)) : r;
    } catch (e) {
      this.expressionError = e.message; this._on = false;   // AE: ошибка → выражение выключается
      return own;
    }
  }
  get value() { return this.valueAtTime(this.owner.comp.time, false); }
  setValue(v) {
    if (this.locked) throw new Error('property is locked');
    if (this.numKeys > 0) throw new Error('cannot set value on animated property');
    this.own = v;
    OPS.push({ layer: this.owner.name, prop: this.mn, kind: 'setValue', val: v });
  }
}

function Layer2D(name, o) {
  o = o || {};
  const L = { name, threeDLayer: false };
  const lk = { locked: o.locked };
  const props = {
    'ADBE Position':   new Prop(L, 'ADBE Position', o.pos || [100, 100, 0], lk),
    'ADBE Position_0': new Prop(L, 'ADBE Position_0', 100, lk),
    'ADBE Position_1': new Prop(L, 'ADBE Position_1', 100, lk),
    'ADBE Scale':      new Prop(L, 'ADBE Scale', o.scale || [100, 100, 100],
                                { locked: o.locked, keys: o.scaleKeys, expr: o.scaleExpr,
                                  on: o.scaleExprOn, failProbe: o.failProbe })
  };
  props['ADBE Position'].dimensionsSeparated = !!o.separated;
  const tg = { property: mn => props[mn] || null };
  L.property = mn => (mn === TR ? tg : null);
  L.props = props;
  return L;
}
function Layer3D(name, m) { return { name, threeDLayer: true, m: M3(m), property: () => null }; }
function Light(name, m) {
  const L = Object.create(LightLayer.prototype);   // threeDLayer у света в API нет
  return Object.assign(L, { name, m: M3(Object.assign({ light: true }, m)), property: () => null });
}
function makeComp(layers, selected, o) {
  o = o || {};
  const comp = Object.create(CompItem.prototype);
  Object.assign(comp, { layers, numLayers: layers.length, layer: i => layers[i - 1],
                        selectedLayers: selected, time: o.time || 0, cam: o.cam || Cam() });
  layers.forEach((L, i) => { L.index = i + 1; L.comp = comp; });
  return comp;
}

function run(src, comp) {
  OPS = [];
  const alerts = [];
  const sandbox = {
    app: { project: { activeItem: comp }, beginUndoGroup: () => {}, endUndoGroup: () => {} },
    CompItem, LightLayer,
    alert: m => alerts.push(String(m)),
    $: { writeln: () => {} }
  };
  vm.createContext(sandbox);
  let thrown = null;
  try { vm.runInContext(src, sandbox, { filename: 'script' }); } catch (e) { thrown = e; }
  return { ops: OPS, alerts, thrown };
}

const fmt = v => (Array.isArray(v) ? '[' + v.map(x => +x.toFixed(4)).join(', ') + ']' : String(v));
function show(ops, full) {
  if (!ops.length) { console.log('  ничего не тронуто'); return; }
  ops.forEach(op => {
    const h = '  --- ' + op.layer + ' :: ' + op.prop + '  ';
    if (op.kind === 'expr') {
      let ok = 'OK';
      try { new vm.Script(op.val); } catch (e) { ok = 'СИНТАКСИС: ' + e.message; }
      const kind = op.val.indexOf(MARK_SCALE) !== -1 ? 'Scale' :
                   op.val.indexOf('проба') !== -1 ? 'проба' :
                   op.val.indexOf(MARK) !== -1 ? 'Position' : 'чужое';
      console.log(h + '[выражение: ' + kind + ', ' + ok + ']');
      if (full) console.log(op.val.split('\n').map(l => '      ' + l).join('\n'));
    } else if (op.kind === 'clear') {
      console.log(h + '[выражение снято]');
    } else {
      console.log(h + '[setValue ' + fmt(op.val) + ']');
    }
  });
}
function syntaxOk(ops) {
  return ops.filter(o => o.kind === 'expr').every(o => { try { new vm.Script(o.val); return true; } catch (e) { return false; } });
}

// Что видно от 2D-слоя на кадре t: Position и Scale после выражений.
function look(L, t) {
  const P = L.props;
  const pos = P['ADBE Position'].dimensionsSeparated
    ? [P['ADBE Position_0'].valueAtTime(t, false), P['ADBE Position_1'].valueAtTime(t, false)]
    : P['ADBE Position'].valueAtTime(t, false).slice(0, 2);
  return pos.concat(P['ADBE Scale'].valueAtTime(t, false).slice(0, 2));
}
const near = (a, b, eps) => a.every((x, i) => Math.abs(x - b[i]) <= (eps || 1e-9) * Math.max(1, Math.abs(x)));
const exprOf = (L, mn) => L.props[mn || 'ADBE Scale'].expression;
const pinnedScale = L => exprOf(L).indexOf(MARK_SCALE) !== -1;
const pinnedPos = L => exprOf(L, 'ADBE Position').indexOf('// ' + MARK + '\n') === 0;

// Камера с наездом: двухузловая, POI на (960, 540, 0), z от −3000 до −1000 за 5 с.
const dolly = () => Cam({ pos: t => [CW / 2, CH / 2, -3000 + 400 * t], poi: [CW / 2, CH / 2, 0] });

// ================= Часть 1: логика на DOM =================
console.log('########## Часть 1: логика на DOM ##########');

{
  head('1. 2D над 3D — Position + проба + рабочий Scale');
  const a = Layer2D('flat'), b = Layer3D('Null 1', { pos: [700, 400, 300] });
  const comp = makeComp([a, b], [a], { time: 2, cam: dolly() });
  const before = look(a, 2);
  const r = run(NEW, comp);
  show(r.ops, true);
  check('синтаксис всех выражений', syntaxOk(r.ops));
  check('alert\'ов нет, исключений нет', !r.alerts.length && !r.thrown);
  check('порядок записей: Position, проба, рабочий Scale',
        r.ops.map(o => o.prop).join() === 'ADBE Position,ADBE Scale,ADBE Scale' &&
        r.ops[1].val.indexOf('проба') !== -1 && r.ops[2].val.indexOf(MARK_SCALE) !== -1);
  check('проба не пережила вызов', exprOf(a).indexOf('проба') === -1);
  const k0 = +(/var K0 = ([0-9.e+-]+);/.exec(exprOf(a)) || [])[1];
  check('K0 записан числом', k0 > 0, 'K0 = ' + k0);
  check('на кадре привязки размер не прыгнул', near(look(a, 2).slice(2), before.slice(2)), fmt(look(a, 2).slice(2)));
  const scr = project(comp.cam, toWorld(b.m, [0, 0, 0], 2), 2);
  check('Position на экранной точке 3D-слоя', near(look(a, 2).slice(0, 2), scr.slice(0, 2)));
  // соседняя кнопка на такой же сцене пишет Position слово в слово
  const a2 = Layer2D('flat'), b2 = Layer3D('Null 1', { pos: [700, 400, 300] });
  run(OLD, makeComp([a2, b2], [a2], { time: 2, cam: dolly() }));
  check('Position — слово в слово как у соседней кнопки', exprOf(a, 'ADBE Position') === exprOf(a2, 'ADBE Position'));
}

{
  head('2–5. невалидные ситуации — тихий no-op');
  let a = Layer2D('flat'), b = Layer3D('Null');
  a.threeDLayer = true;
  let r = run(NEW, makeComp([a, b], [a]));
  check('выделен 3D-слой', !r.ops.length && !r.alerts.length && !r.thrown);
  a = Layer2D('flat'); b = Layer2D('other');
  r = run(NEW, makeComp([a, b], [a]));
  check('снизу 2D-слой', !r.ops.length && !r.alerts.length && !r.thrown);
  a = Layer3D('top'); b = Layer2D('flat');
  r = run(NEW, makeComp([a, b], [b]));
  check('выделен самый нижний слой', !r.ops.length && !r.alerts.length && !r.thrown);
  a = Layer2D('flat'); b = Layer3D('Null');
  r = run(NEW, makeComp([a, b], []));
  check('пустое выделение', !r.ops.length && !r.alerts.length && !r.thrown);
}

{
  head('6. имя-дубликат — ссылка по индексу в обоих выражениях');
  const a = Layer2D('flat'), b = Layer3D('Cube', { pos: [900, 500, 100] }), c = Layer3D('Cube');
  const r = run(NEW, makeComp([a, b, c], [a]));
  check('Position: thisComp.layer(2)', exprOf(a, 'ADBE Position').indexOf('thisComp.layer(2)') !== -1);
  check('Scale: thisComp.layer(2) и откалиброван', exprOf(a).indexOf('thisComp.layer(2)') !== -1 && pinnedScale(a));
}

{
  head('7. кавычки и бэкслеш в имени');
  const nm = 'he said ' + QT + 'hi' + QT + ' ' + BS + 'path';
  const a = Layer2D('flat'), b = Layer3D(nm, { pos: [800, 450, 200] });
  const r = run(NEW, makeComp([a, b], [a]));
  check('синтаксис', syntaxOk(r.ops));
  check('выражения находят слой по имени: Scale откалиброван, Position живой',
        pinnedScale(a) && !a.props['ADBE Scale'].expressionError && near(look(a, 0).slice(2), [100, 100]));
}

{
  head('8. Separate Dimensions — две оси + Scale');
  const a = Layer2D('flat', { separated: true }), b = Layer3D('Null', { pos: [800, 450, 200] });
  const comp = makeComp([a, b], [a], { time: 1, cam: dolly() });
  const r = run(NEW, comp);
  show(r.ops);
  check('Position_0 и Position_1, объединённая не тронута',
        exprOf(a, 'ADBE Position_0').indexOf(MARK) !== -1 && exprOf(a, 'ADBE Position_1').indexOf(MARK) !== -1 &&
        exprOf(a, 'ADBE Position') === '');
  check('Scale откалиброван', pinnedScale(a) && near(look(a, 1).slice(2), [100, 100]));
  const scr = project(comp.cam, toWorld(b.m, [0, 0, 0], 1), 1);
  check('оси отдают экранную точку', near(look(a, 1).slice(0, 2), scr.slice(0, 2)));
}

{
  head('9. свет снизу — [0, 0, 0] вместо anchorPoint');
  const a = Layer2D('flat'), b = Light('Light 1', { pos: [600, 300, 400] });
  const comp = makeComp([a, b], [a], { cam: dolly() });
  const r = run(NEW, comp);
  show(r.ops);
  check('в обоих выражениях [0, 0, 0], anchorPoint света не трогается',
        exprOf(a, 'ADBE Position').indexOf('src.toComp([0, 0, 0])') !== -1 &&
        exprOf(a).indexOf('var a = [0, 0, 0]') !== -1 && !comp.lightAnchorTouched);
  check('Scale откалиброван', pinnedScale(a) && near(look(a, 0).slice(2), [100, 100]));
}

{
  head('10. залоченный слой — молча мимо');
  const a = Layer2D('flat', { locked: true }), b = Layer3D('Null');
  const r = run(NEW, makeComp([a, b], [a]));
  check('ничего не записано, исключений нет', !r.ops.length && !r.thrown && !r.alerts.length);
}

{
  head('11. мультивыделение — только валидная пара');
  const a = Layer2D('flat A'), b = Layer3D('Null', { pos: [800, 450, 200] }), c = Layer2D('flat B'), d = Layer2D('flat C');
  run(NEW, makeComp([a, b, c, d], [a, c]));
  check('flat A привязан, flat B не тронут',
        pinnedPos(a) && pinnedScale(a) && exprOf(c, 'ADBE Position') === '' && exprOf(c) === '');
}

{
  head('12. тумблер: второй клик отвязывает и запекает — на другом кадре, без прыжка');
  const a = Layer2D('flat'), b = Layer3D('Null', { pos: [700, 400, 0] });
  const comp = makeComp([a, b], [a], { time: 1, cam: dolly() });
  run(NEW, comp);
  comp.time = 4;                                   // камера с тех пор подъехала
  const before = look(a, 4);
  const r = run(NEW, comp);
  show(r.ops);
  check('выражения сняты', exprOf(a, 'ADBE Position') === '' && exprOf(a) === '');
  check('Position и Scale запечены ровно в то, что было видно', near(look(a, 4), before), fmt(before));
  check('Scale действительно вырос за наезд', before[2] > 150, fmt(before.slice(2)));
}

{
  head('13. тумблер, Scale на ключах — Scale только снять, Position запечь');
  const a = Layer2D('flat', { scaleKeys: 2 }), b = Layer3D('Null', { pos: [700, 400, 0] });
  const comp = makeComp([a, b], [a], { time: 1, cam: dolly() });
  run(NEW, comp);
  comp.time = 4;
  const before = look(a, 4);
  const r = run(NEW, comp);
  show(r.ops);
  check('у Scale только снятие, без setValue',
        r.ops.filter(o => o.prop === 'ADBE Scale').map(o => o.kind).join() === 'clear');
  check('Position запечён', near(look(a, 4).slice(0, 2), before.slice(0, 2)));
}

{
  head('14. соседняя кнопка → эта: докручивает Scale, ничего не прыгает');
  const a = Layer2D('flat'), b = Layer3D('Null', { pos: [700, 400, 0] });
  const comp = makeComp([a, b], [a], { time: 1, cam: dolly() });
  run(OLD, comp);
  check('после соседней: только Position', pinnedPos(a) && exprOf(a) === '');
  comp.time = 3;
  const before = look(a, 3);
  const r = run(NEW, comp);
  show(r.ops);
  check('теперь Position + Scale', pinnedPos(a) && pinnedScale(a));
  check('на текущем кадре ни позиция, ни размер не прыгнули', near(look(a, 3), before), fmt(before));
}

{
  head('15. эта → соседняя: соседняя отвязывает целиком, без прыжка');
  const a = Layer2D('flat'), b = Layer3D('Null', { pos: [700, 400, 0] });
  const comp = makeComp([a, b], [a], { time: 1, cam: dolly() });
  run(NEW, comp);
  comp.time = 4;
  const before = look(a, 4);
  const r = run(OLD, comp);
  show(r.ops);
  check('сняты и Position, и Scale', exprOf(a, 'ADBE Position') === '' && exprOf(a) === '');
  check('запечено то, что было видно', near(look(a, 4), before), fmt(before));
}

{
  head('16. привязан с Scale, источник увели вниз — отвязка всё равно проходит');
  const a = Layer2D('flat'), b = Layer3D('Null', { pos: [700, 400, 0] }), c = Layer2D('other');
  const comp = makeComp([a, b, c], [a], { time: 1, cam: dolly() });
  run(NEW, comp);
  // переставили: теперь под flat лежит 2D-слой, а Null ушёл в самый низ
  comp.layers.splice(0, 3, a, c, b);
  comp.layers.forEach((L, i) => { L.index = i + 1; });
  const before = look(a, 1);
  run(NEW, comp);
  check('отвязан, запечён на месте', exprOf(a, 'ADBE Position') === '' && exprOf(a) === '' && near(look(a, 1), before));
}

{
  head('17. чужое выражение на Scale — затирается рабочим');
  const a = Layer2D('flat', { scaleExpr: '[50, 50]' }), b = Layer3D('Null', { pos: [700, 400, 200] });
  run(NEW, makeComp([a, b], [a]));
  check('на Scale наше выражение', pinnedScale(a) && exprOf(a).indexOf('[50, 50]') === -1);
}

{
  head('18. 3D-слой схлопнут Scale = 0 на кадре привязки — только Position');
  const a = Layer2D('flat'), b = Layer3D('Null', { pos: [700, 400, 200], scale: [0, 0, 0] });
  const r = run(NEW, makeComp([a, b], [a]));
  show(r.ops);
  check('Position привязан, Scale вернулся пустым', pinnedPos(a) && exprOf(a) === '' && !r.thrown);
}

{
  head('19. проба падает с ошибкой — только Position');
  const a = Layer2D('flat', { failProbe: true }), b = Layer3D('Null', { pos: [700, 400, 200] });
  const r = run(NEW, makeComp([a, b], [a]));
  show(r.ops);
  check('Position привязан, Scale вернулся пустым', pinnedPos(a) && exprOf(a) === '' && !r.thrown);
}

{
  head('20. на Scale выключенное чужое выражение — проба включает, калибровка проходит');
  const a = Layer2D('flat', { scaleExpr: '[50, 50]', scaleExprOn: false }), b = Layer3D('Null', { pos: [700, 400, 200] });
  run(NEW, makeComp([a, b], [a]));
  check('рабочее выражение, включено', pinnedScale(a) && a.props['ADBE Scale'].expressionEnabled === true);
}

{
  head('21. то же, но проба падает — чужое выражение возвращено и снова выключено');
  const a = Layer2D('flat', { scaleExpr: '[50, 50]', scaleExprOn: false, failProbe: true });
  const b = Layer3D('Null', { pos: [700, 400, 200] });
  run(NEW, makeComp([a, b], [a]));
  check('[50, 50] на месте, выключено',
        exprOf(a) === '[50, 50]' && a.props['ADBE Scale'].expressionEnabled === false);
}

// ================= Часть 2: математика =================
console.log('\n########## Часть 2: математика на 3D-модели ##########');

const TIMES = Array.from({ length: 26 }, (_, i) => i * 0.2);   // 0 … 5 с

// Привязать на кадре T0 и сверить Scale и Position на всём диапазоне с эталоном.
// expect — [[t, ожидаемое отношение размера к кадру привязки], ...] из аналитики сцены.
function mathCase(label, src, o) {
  head(label);
  const flat = Layer2D('flat', { scale: o.own2D });
  const comp = makeComp([flat, src], [flat], { time: o.T0 || 0, cam: o.cam });
  run(NEW, comp);
  if (!pinnedScale(flat)) { check('Scale привязан', false); return; }
  const sc = flat.props['ADBE Scale'], ps = flat.props['ADBE Position'];
  const k0 = seenTrue(comp, src.m, comp.time);
  let errS = 0, errP = 0, rmin = Infinity, rmax = -Infinity;
  for (const t of TIMES) {
    const r = seenTrue(comp, src.m, t) / k0, own = at(sc.own, t), got = sc.valueAtTime(t, false);
    for (let i = 0; i < 2; i++) errS = Math.max(errS, Math.abs(got[i] - own[i] * r) / Math.abs(own[i] * r));
    rmin = Math.min(rmin, r); rmax = Math.max(rmax, r);
    const scr = project(comp.cam, toWorld(src.m, src.m.light ? [0, 0, 0] : at(src.m.anchor, t), t), t);
    const gp = ps.valueAtTime(t, false);
    errP = Math.max(errP, Math.hypot(gp[0] - scr[0], gp[1] - scr[1]));
  }
  console.log('    размер относительно кадра привязки: ' + rmin.toFixed(4) + ' … ' + rmax.toFixed(4));
  check('Scale = своё значение × видимый размер / K0', errS < (o.tol || 1e-6), 'макс. отн. ошибка ' + errS.toExponential(1));
  check('Position — на экранной точке 3D-слоя', errP < 1e-6, 'макс. ' + errP.toExponential(1) + ' px');
  (o.expect || []).forEach(([t, want]) => {
    const own = at(sc.own, t), got = sc.valueAtTime(t, false)[0] / own[0];
    check('t = ' + t + ': размер ×' + want.toFixed(4), Math.abs(got - want) < 1e-5 * want, 'получено ×' + got.toFixed(6));
  });
  if (comp.lightAnchorTouched) check('anchorPoint света не трогался', false);
  return { comp, flat };
}

mathCase('M1. наезд камеры, привязка посреди наезда (T0 = 2 с)',
  Layer3D('Null', { pos: [CW / 2, CH / 2, 0] }), { cam: dolly(), T0: 2,
  expect: [[2, 1], [5, 2200 / 1000], [0, 2200 / 3000]] });

mathCase('M2. нуль уходит в глубину, камеры нет (дефолтная)',
  Layer3D('Null', { pos: t => [CW / 2, CH / 2, 800 * t] }), {
  expect: [[5, F50 / (F50 + 4000)]] });

mathCase('M3. нуль крутится по трём осям, камера стоит — размер не меняется',
  Layer3D('Null', { pos: [600, 300, 500], rot: t => [37 * t, 61 * t, 23 * t] }), {
  expect: [[1.3, 1], [2.7, 1], [5, 1]] });

mathCase('M3b. крутится и камера наезжает — размер ровно по наезду, поворот не примешивается',
  Layer3D('Null', { pos: [600, 300, 500], rot: t => [37 * t, 61 * t, 23 * t] }), { cam: dolly() });

mathCase('M4. нуль в углу кадра + наезд — вне оси без искажения',
  Layer3D('Null', { pos: [80, 60, 0] }), { cam: Cam({ pos: t => [CW / 2, CH / 2, -3000 + 440 * t] }),
  expect: [[5, 3000 / 800]] });

mathCase('M5. панорама камеры на 25° — слой уходит к краю, глубина падает как cos',
  Layer3D('Null', { pos: [CW / 2, CH / 2, 0] }), { cam: Cam({ rot: t => [0, 5 * t, 0] }),
  expect: [[5, 1 / Math.cos(25 * Math.PI / 180)]] });

mathCase('M6. облёт камеры вокруг нуля на постоянном расстоянии — размер не меняется',
  Layer3D('Null', { pos: [CW / 2, CH / 2, 0] }), {
  cam: Cam({ pos: t => [CW / 2 + 2000 * Math.sin(t * 30 * Math.PI / 180), CH / 2 - 300,
                        -2000 * Math.cos(t * 30 * Math.PI / 180)], poi: [CW / 2, CH / 2, 0] }),
  expect: [[5, 1]] });

mathCase('M7. зум камеры ×2',
  Layer3D('Null', { pos: [700, 400, 0] }), { cam: Cam({ zoom: t => F50 * (1 + t / 5) }),
  expect: [[5, 2]] });

mathCase('M8a. Scale самого нуля 100 → 50',
  Layer3D('Null', { pos: [700, 400, 0], scale: t => [100 - 10 * t, 100 - 10 * t, 100 - 10 * t] }), {
  expect: [[5, 0.5]] });

mathCase('M8b. Scale родителя нуля 100 → 200',
  Layer3D('Null', { pos: [0, 0, 0], parent: M3({ pos: [700, 400, 300], scale: t => [100 + 20 * t, 100 + 20 * t, 100 + 20 * t] }) }), {
  expect: [[5, 2]] });

mathCase('M9. свет уходит в глубину',
  Light('Light 1', { pos: t => [CW / 2, CH / 2, 600 * t] }), {
  expect: [[5, F50 / (F50 + 3000)]] });

mathCase('M10. у 2D-слоя свой анимированный Scale — умножается, а не затирается',
  Layer3D('Null', { pos: [CW / 2, CH / 2, 0] }), { cam: dolly(),
  own2D: t => [100 + 20 * t, 80 + 10 * t, 100], expect: [[5, 3]] });

// Погрешность центральной разности ~ (Scale·1px / глубина)², но только у осей,
// смотрящих в глубину: у нуля без поворота на оси камеры она ровно ноль. Поэтому
// нуль сдвинут с оси и повёрнут.
mathCase('M11. вплотную к камере (глубина 60 px), вне оси, повёрнут — погрешность центральной разности',
  Layer3D('Null', { pos: [CW / 2 + 25, CH / 2 + 15, 0], rot: [30, 40, 10] }), {
  cam: Cam({ pos: t => [CW / 2, CH / 2, -60 - 100 * t] }), tol: 1e-3 });

// Неравномерный Scale: видимый размер = малая ось эллипса, в который проецируется
// единичная сфера источника. По перемежаемости Коши он между наименьшим и средним
// Scale — от ракурса зависит, только если эти два различаются.
for (const sc of [[300, 100, 100], [300, 200, 100]]) {
  head('M12. неравномерный Scale нуля [' + sc + '] + вращение по Y — справочно');
  const src = Layer3D('Null', { pos: [CW / 2, CH / 2, 0], scale: sc, rot: t => [0, 36 * t, 0] });
  const flat = Layer2D('flat');
  const comp = makeComp([flat, src], [flat], { cam: dolly() });
  run(NEW, comp);
  let mn = Infinity, mx = -Infinity;
  for (const t of TIMES) {
    const r = flat.props['ADBE Scale'].valueAtTime(t, false)[0] / 100 / (seenTrue(comp, src.m, t) / seenTrue(comp, src.m, 0));
    mn = Math.min(mn, r); mx = Math.max(mx, r);
  }
  console.log('    размер ÷ перспектива по ходу поворота (1 … 1 = от ракурса не зависит): ' + mn.toFixed(4) + ' … ' + mx.toFixed(4));
}

console.log('\n' + (FAIL ? '✗ ' : '✓ ') + 'проверок: ' + (PASS + FAIL) + ', прошло ' + PASS + ', упало ' + FAIL);
process.exit(FAIL ? 1 : 0);
