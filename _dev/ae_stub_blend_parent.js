// Стаб AE DOM + 3D-модель трансформа для Blend_parent_2_layers.jsx.
//
// Часть 1 — сценарии кнопки на стабе DOM: создание нуля (место в стеке, 3D, эффекты,
//           Layer Control'ы после сдвига индексов, выражения, выделение, undo), ошибки
//           выделения (1 / 3 слоя, 2D, камера, не компа, нет проекта), уникальное имя.
//           Синтаксис всех сгенерированных выражений.
// Часть 2 — сгенерированные выражения исполняются на 3D-модели трансформа AE:
//           world = Parent · (pos + Ro·Rr·S·(pt − anchor)), Ro = Rx·Ry·Rz(Orientation),
//           Rr = Rx·Ry·Rz(X/Y/Z Rotation). Цели с родителями, анимацией во времени,
//           разными анкерами. Blend 0/1 — матрица нуля совпадает с матрицей цели;
//           середина — опора посередине, поворот по геодезической, масштаб lerp;
//           гимбал, зеркало, схлопнутый масштаб, антиподы, экстраполяция, пустой Layer
//           Control; 300 случайных пар.
//
// Чего стаб НЕ проверяет: что в самом AE Orientation собирается именно как Rx·Ry·Rz
// (на этом стоит обратное преобразование кватерниона в углы — проверять в AE руками),
// живой Layer Control, скорость в AE.
//
//   node _dev/ae_stub_blend_parent.js           # сценарии + математика, с ассертами
//   node _dev/ae_stub_blend_parent.js --dump    # плюс полный текст выражения Orientation

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'Blend_parent_2_layers.jsx');
const SCRIPT = fs.readFileSync(SRC, 'utf8');
const DUMP = process.argv.includes('--dump');

let fails = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log('  ok   ' + msg); }
  else { fails++; console.log('  FAIL ' + msg); }
}

// ================= Часть 1: DOM =================
let COMP, UNDO, NULL_DUR;

class Prop {
  constructor(name, matchName, value) {
    this.name = name; this.matchName = matchName; this._value = value;
    this._expr = ''; this._layerRef = null;
  }
  get value() {
    if (this.matchName === 'ADBE Layer Control-0001') return this._layerRef ? this._layerRef.index : 0;
    return this._value;
  }
  get expression() { return this._expr; }
  set expression(v) { this._expr = v; }
  setValue(v) {
    if (this.matchName === 'ADBE Layer Control-0001') { this._layerRef = COMP.layer(v); return; }
    this._value = v;
  }
}

class Group {
  constructor(name, matchName) { this.name = name; this.matchName = matchName; this._items = []; }
  get numProperties() { return this._items.length; }
  property(k) {
    if (typeof k === 'number') return this._items[k - 1] || null;
    return this._items.find(p => p.matchName === k || p.name === k) || null;
  }
  addProperty(mn) {
    const PARAM = { 'ADBE Slider Control': ['Slider', 0], 'ADBE Layer Control': ['Layer', 0] }[mn];
    if (!PARAM) throw new Error('stub: unknown matchName ' + mn);
    const g = new Group(mn.replace('ADBE ', ''), mn);
    g._items.push(new Prop(PARAM[0], mn + '-0001', PARAM[1]));
    this._items.push(g);
    return g;
  }
}

class Layer {
  // kind: av | camera
  constructor(name, opts = {}) {
    this.name = name;
    this.comment = '';
    this.selected = false;
    this.__kind = opts.kind || 'av';
    if (this.__kind !== 'camera') this.threeDLayer = !!opts.threeD;
    const t = new Group('Transform', 'ADBE Transform Group');
    [['Anchor Point', 'ADBE Anchor Point', [50, 50, 0]], ['Position', 'ADBE Position', [960, 540, 0]],
     ['Scale', 'ADBE Scale', [100, 100, 100]], ['Orientation', 'ADBE Orientation', [0, 0, 0]],
     ['X Rotation', 'ADBE Rotate X', 0], ['Y Rotation', 'ADBE Rotate Y', 0],
     ['Z Rotation', 'ADBE Rotate Z', 0], ['Opacity', 'ADBE Opacity', 100]]
      .forEach(([n, m, v]) => t._items.push(new Prop(n, m, v)));
    this._props = { 'ADBE Transform Group': t };
    if (this.__kind !== 'camera') this._props['ADBE Effect Parade'] = new Group('Effects', 'ADBE Effect Parade');
  }
  property(k) { return this._props[k] || null; }
  moveBefore(other) { COMP._move(this, other); }
}

function CompItem() {}

function makeComp(layers, selected) {
  const comp = Object.create(CompItem.prototype);
  comp._layers = layers.slice();
  const reindex = () => comp._layers.forEach((L, i) => { L.index = i + 1; });
  reindex();
  Object.defineProperty(comp, 'numLayers', { get: () => comp._layers.length });
  comp.layer = i => comp._layers[i - 1];
  comp.duration = 10;
  comp.selectedLayers = selected;
  selected.forEach(L => { L.selected = true; });
  comp.layers = {
    addNull(dur) {
      NULL_DUR = dur;
      const L = new Layer('Null 1');
      comp._layers.unshift(L); reindex();
      return L;
    }
  };
  comp._move = (L, other) => {
    comp._layers.splice(comp._layers.indexOf(L), 1);
    comp._layers.splice(comp._layers.indexOf(other), 0, L);
    reindex();
  };
  return comp;
}

function run(label, comp, opts = {}) {
  COMP = comp; UNDO = []; NULL_DUR = undefined;
  const alerts = [];
  const sandbox = {
    app: {
      project: opts.noProject ? null : { activeItem: comp },
      beginUndoGroup(n) { UNDO.push('begin ' + n); },
      endUndoGroup() { UNDO.push('end'); }
    },
    CompItem,
    alert: m => alerts.push(String(m))
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: SRC });
  console.log('\n=== ' + label + ' ===');
  alerts.forEach(a => console.log('  alert: ' + a.split('\n').join('\n         ')));
  return alerts;
}

const fxNames = L => L.property('ADBE Effect Parade')._items.map(f => f.name);
const fx = (L, n) => L.property('ADBE Effect Parade')._items.find(f => f.name === n);
const trExpr = (L, mn) => L.property('ADBE Transform Group').property(mn)._expr;
const blends = comp => comp._layers.filter(L => String(L.comment).indexOf('@blend-parent') !== -1);
const ALL_MN = ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Orientation',
                'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Rotate Z'];

let EXPR = null;   // matchName -> текст выражения из удачного прогона

// ---------- 1. два 3D-нуля, выделены снизу вверх ----------
{
  const bg = new Layer('BG'), n1 = new Layer('N1', { threeD: true }), n2 = new Layer('N2', { threeD: true });
  const comp = makeComp([bg, n1, n2], [n2, n1]);   // первым выделен N2 — он и есть A
  const al = run('1. два 3D-слоя — создать бленд-нуль', comp);
  const C = blends(comp)[0];
  check(al.length === 0, 'без алертов');
  check(!!C, 'нуль создан');
  check(C && C.threeDLayer === true, 'нуль 3D');
  check(NULL_DUR === 10, 'addNull на всю длину компы');
  check(C && C.index === 2 && comp.layer(3) === n1, 'встал прямо над верхней из целей');
  check(C && C.name === 'Blend N2 / N1', 'имя «Blend A / B» в порядке выделения');
  check(C && fxNames(C).join('|') === 'Blend|Parent A|Parent B', 'эффекты: Blend, Parent A, Parent B');
  check(C && fx(C, 'Blend')._items[0].value === 0, 'Blend = 0');
  check(C && fx(C, 'Parent A')._items[0]._layerRef === n2 && fx(C, 'Parent B')._items[0]._layerRef === n1,
    'Layer Control смотрят на N2 (A) и N1 (B) — индексы взяты после сдвига');
  check(C && ALL_MN.every(mn => trExpr(C, mn).indexOf('@blend-parent') !== -1), 'выражения на 7 свойствах трансформа');
  check(C && ['ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Rotate Z'].every(mn => /\n0$/.test(trExpr(C, mn))),
    'X/Y/Z Rotation держатся в 0');
  check(C && trExpr(C, 'ADBE Opacity') === '', 'Opacity не тронута');
  check(C && C.selected && !n1.selected && !n2.selected, 'выделен только новый нуль');
  check(UNDO.length === 2 && /^begin/.test(UNDO[0]) && UNDO[1] === 'end', 'одна undo-группа');
  check([n1, n2].every(L => ALL_MN.every(mn => trExpr(L, mn) === '')), 'цели не тронуты');
  if (C) { EXPR = {}; ALL_MN.forEach(mn => { EXPR[mn] = trExpr(C, mn); }); }
}

// ---------- 2. имя уже занято ----------
{
  const old = new Layer('Blend N1 / N2'), n1 = new Layer('N1', { threeD: true }), n2 = new Layer('N2', { threeD: true });
  const comp = makeComp([old, n1, n2], [n1, n2]);
  run('2. имя занято', comp);
  const C = blends(comp)[0];
  check(C && C.name === 'Blend N1 / N2 2', 'суффикс « 2»');
}

// ---------- 3–8. невалидный ввод ----------
function refused(label, comp, re, opts) {
  const before = comp ? comp._layers.length : 0;
  const al = run(label, comp, opts);
  check(al.length === 1 && re.test(al[0]), 'алерт: ' + re);
  check(!comp || comp._layers.length === before, 'слоёв не добавилось');
  check(UNDO.length === 0, 'undo-группа не открывалась');
}
{
  const a = new Layer('A', { threeD: true });
  refused('3. выделен один слой', makeComp([a], [a]), /ровно два/);
}
{
  const a = new Layer('A', { threeD: true }), b = new Layer('B', { threeD: true }), c = new Layer('C', { threeD: true });
  refused('4. выделено три слоя', makeComp([a, b, c], [a, b, c]), /ровно два/);
}
{
  const a = new Layer('flat'), b = new Layer('B', { threeD: true });
  refused('5. 2D + 3D', makeComp([a, b], [a, b]), /Не 3D-слой: «flat»$/m);
}
{
  const cam = new Layer('Camera 1', { kind: 'camera' }), b = new Layer('B', { threeD: true });
  refused('6. камера + 3D', makeComp([cam, b], [cam, b]), /«Camera 1»/);
}
{
  const comp = makeComp([], []);
  Object.setPrototypeOf(comp, {});            // не CompItem
  refused('7. активна не композиция', comp, /должен быть композицией/);
}
refused('8. нет проекта', null, /Нет открытого проекта/, { noProject: true });

// ---------- синтаксис ----------
console.log('\n=== синтаксис выражений ===');
if (EXPR) {
  ALL_MN.forEach(mn => {
    let ok = true;
    try { new vm.Script(EXPR[mn]); } catch (e) { ok = false; console.log('    ' + e.message); }
    check(ok, mn);
  });
  if (DUMP) console.log('\n----- Orientation -----\n' + EXPR['ADBE Orientation'] + '\n-----');
}

// ================= Часть 2: математика =================
console.log('\n=== математика выражений (3D-модель трансформа AE) ===');
if (!EXPR) { console.log('  нет выражений — сценарий 1 упал'); process.exit(1); }

const D2R = Math.PI / 180;
const Rx = a => { const c = Math.cos(a * D2R), s = Math.sin(a * D2R); return [[1, 0, 0], [0, c, -s], [0, s, c]]; };
const Ry = a => { const c = Math.cos(a * D2R), s = Math.sin(a * D2R); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const Rz = a => { const c = Math.cos(a * D2R), s = Math.sin(a * D2R); return [[c, -s, 0], [s, c, 0], [0, 0, 1]]; };
const mm = (A, B) => A.map(r => [0, 1, 2].map(j => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j]));
const mv = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const eul = e => mm(mm(Rx(e[0]), Ry(e[1])), Rz(e[2]));
const vsub = (a, b) => a.map((x, i) => x - b[i]);
const vlen = a => Math.hypot(a[0], a[1], a[2]);
const dist = (a, b) => vlen(vsub(a, b));
const lerp = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);
const cf = v => (typeof v === 'function' ? v : () => v);

let NOW = 0;

// 3D-слой AE. Все поля — значение или функция времени.
class L3 {
  constructor(o) {
    const d = { pos: [0, 0, 0], anchor: [50, 50, 0], scale: [100, 100, 100], orient: [0, 0, 0], rot: [0, 0, 0], parent: null };
    o = Object.assign(d, o);
    this.parent = o.parent;
    ['pos', 'anchor', 'scale', 'orient', 'rot'].forEach(k => { this[k] = cf(o[k]); });
  }
  lin(t) {   // линейная часть R·S
    const R = mm(eul(this.orient(t)), eul(this.rot(t))), s = this.scale(t);
    return R.map(r => [r[0] * s[0] / 100, r[1] * s[1] / 100, r[2] * s[2] / 100]);
  }
  toWorld(pt, t) {
    if (t === undefined) t = NOW;
    const q = vsub(pt, this.anchor(t));
    const r = mv(this.lin(t), q).map((x, i) => x + this.pos(t)[i]);
    return this.parent ? this.parent.toWorld(r, t) : r;
  }
  // то, что видит выражение через effect('Parent X')(1)
  get api() {
    const self = this;
    return { transform: { anchorPoint: { get value() { return self.anchor(NOW); } } }, toWorld: (p, t) => self.toWorld(p, t) };
  }
}

const STATIC = {
  'ADBE Anchor Point': [50, 50, 0], 'ADBE Position': [960, 540, 0], 'ADBE Scale': [100, 100, 100],
  'ADBE Orientation': [0, 0, 0], 'ADBE Rotate X': 0, 'ADBE Rotate Y': 0, 'ADBE Rotate Z': 0
};
const compiled = {};

function evalProp(mn, k, A, B, t) {
  const txt = EXPR[mn];
  const script = compiled[mn] || (compiled[mn] = new vm.Script(txt));
  NOW = t;
  const ctx = vm.createContext({
    Math, time: t, value: STATIC[mn],
    effect: nm => () => {
      if (nm === 'Blend') return { value: k };
      if (nm === 'Parent A') return A ? A.api : null;
      if (nm === 'Parent B') return B ? B.api : null;
      throw new Error('no effect ' + nm);
    }
  });
  return script.runInContext(ctx);
}

// бленд-нуль как слой модели: его свойства — результаты выражений
function blendAt(k, A, B, t) {
  const v = {};
  ALL_MN.forEach(mn => { v[mn] = evalProp(mn, k, A, B, t); });
  const C = new L3({
    pos: v['ADBE Position'], anchor: v['ADBE Anchor Point'], scale: v['ADBE Scale'],
    orient: v['ADBE Orientation'], rot: [v['ADBE Rotate X'], v['ADBE Rotate Y'], v['ADBE Rotate Z']]
  });
  C.__v = v;
  return C;
}

const PTS = [[0, 0, 0], [50, 50, 0], [100, -30, 70], [-200, 40, -90], [13, 300, 5]];
const TIMES = [0, 0.37, 1.2, 2.5];

function maxErr(C, T, t) { return Math.max(...PTS.map(p => dist(C.toWorld(p, t), T.toWorld(p, t)))); }

// мировой поворот слоя (оси нормированы, со знаком масштаба), для геодезических проверок
function worldRot(L, t) {
  const a = L.anchor(t), o = L.toWorld(a, t);
  const ax = [0, 1, 2].map(i => { const p = a.slice(); p[i] += 100; return vsub(L.toWorld(p, t), o).map(x => x / 100); });
  const n = ax.map(vlen);
  return { R: [0, 1, 2].map(r => [0, 1, 2].map(c => ax[c][r] / n[c])), n };
}
function angle(R1, R2) {
  let tr = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) tr += R1[j][i] * R2[j][i];
  return Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) / D2R;
}
const finite = a => a.every(x => typeof x === 'number' && isFinite(x));

// --- цели: у A родитель с поворотом и равномерным масштабом, свой неравномерный масштаб,
//     поворот сразу по трём осям; у B свой анкер, без родителя
const P = new L3({
  pos: t => [400 + 100 * t, 300, -200 * t], anchor: [0, 0, 0],
  scale: t => { const s = 120 + 30 * Math.sin(t); return [s, s, s]; },
  orient: [10, 20, 30], rot: t => [0, 15 * t, 40 * t]
});
const A = new L3({
  parent: P, pos: t => [100 * Math.cos(t), 50 * t, 80], anchor: [50, 50, 0],
  scale: t => [80 + 20 * Math.sin(t), 150, 60], orient: [30, 45, 60], rot: t => [40 * t, -25 * t, 70 * t]
});
const B = new L3({
  pos: t => [1200 - 90 * t, 600 + 40 * t, 300], anchor: [10, -20, 5],
  scale: t => [100 + 30 * t, 100 + 30 * t, 100 + 30 * t], orient: [-70, 10, 200], rot: t => [0, 90 * t, 0]
});

{
  let e0 = 0, e1 = 0;
  TIMES.forEach(t => {
    e0 = Math.max(e0, maxErr(blendAt(0, A, B, t), A, t));
    e1 = Math.max(e1, maxErr(blendAt(1, A, B, t), B, t));
  });
  check(e0 < 1e-6, 'Blend 0: нуль ≡ A (родитель, 3 оси, неравномерный масштаб), ошибка ' + e0.toExponential(1));
  check(e1 < 1e-6, 'Blend 1: нуль ≡ B (свой анкер), ошибка ' + e1.toExponential(1));
}
{
  let ePiv = 0, eRot = 0, eSc = 0;
  TIMES.forEach(t => {
    const ra = worldRot(A, t), rb = worldRot(B, t), th = angle(ra.R, rb.R);
    [0.25, 0.5, 0.75].forEach(k => {
      const C = blendAt(k, A, B, t);
      const piv = lerp(A.toWorld(A.anchor(t), t), B.toWorld(B.anchor(t), t), k);
      ePiv = Math.max(ePiv, dist(C.toWorld(C.anchor(t), t), piv));
      const rc = worldRot(C, t);
      eRot = Math.max(eRot, Math.abs(angle(ra.R, rc.R) - k * th), Math.abs(angle(rc.R, rb.R) - (1 - k) * th));
      eSc = Math.max(eSc, dist(rc.n, lerp(ra.n, rb.n, k)));
    });
  });
  check(ePiv < 1e-6, 'середина: опорная точка = lerp опор A и B');
  check(eRot < 1e-6, 'середина: поворот по геодезической, угол делится в пропорции k');
  check(eSc < 1e-9, 'середина: масштаб по осям = lerp');
}
{
  const G1 = new L3({ orient: [25, 90, 40], pos: [100, 200, 300] });
  const G2 = new L3({ orient: [0, -90, 0], rot: [0, 0, 33], pos: [0, 0, 0], anchor: [0, 0, 0] });
  check(maxErr(blendAt(0, G1, B, 0), G1, 0) < 1e-5, 'гимбал: Orientation Y = 90 — Blend 0 точен');
  check(maxErr(blendAt(0, G2, B, 0), G2, 0) < 1e-5, 'гимбал: Y = −90 плюс Z Rotation — Blend 0 точен');
}
{
  const M = new L3({ scale: [-100, 100, 100], orient: [10, 20, 30], pos: [500, 500, 0] });
  check(maxErr(blendAt(0, M, B, 0), M, 0) < 1e-6, 'зеркало (Scale X = −100): Blend 0 точен');
  check(finite(blendAt(0.5, M, B, 0).__v['ADBE Orientation']), 'зеркало: середина без NaN');
}
{
  const Z = new L3({ scale: [0, 0, 0], orient: [10, 20, 30], pos: [500, 500, 0] });
  const C = blendAt(0.5, Z, B, 1);
  const rc = worldRot(C, 1), rb = worldRot(B, 1);
  check(finite(C.__v['ADBE Orientation']) && finite(C.__v['ADBE Scale']), 'масштаб A = 0: без NaN');
  check(angle(rc.R, rb.R) < 1e-6, 'масштаб A = 0: поворот берётся у B');
  check(dist(rc.n, rb.n.map(x => x / 2)) < 1e-9, 'масштаб A = 0: масштаб = половина B');
}
{
  const Q1 = new L3({ orient: [0, 0, 0] }), Q2 = new L3({ orient: [0, 180, 0] });
  const C = blendAt(0.5, Q1, Q2, 0);
  check(finite(C.__v['ADBE Orientation']) && Math.abs(angle(worldRot(C, 0).R, worldRot(Q1, 0).R) - 90) < 1e-6,
    'антиподы (180° между целями): середина = 90°, без NaN');
}
{
  const C = blendAt(1.3, A, B, 0.5);
  check(ALL_MN.slice(0, 4).every(mn => finite(C.__v[mn])), 'экстраполяция Blend = 1.3: числа конечные');
}
{
  const C = blendAt(0.5, null, B, 0);
  check(JSON.stringify(C.__v['ADBE Position']) === JSON.stringify(STATIC['ADBE Position']) &&
        JSON.stringify(C.__v['ADBE Orientation']) === JSON.stringify(STATIC['ADBE Orientation']),
    'пустой Layer Control: свойства остаются на своих значениях');
}
{
  // случайные пары: родитель с равномерным масштабом (без шира), цели с поворотом по трём осям
  let seed = 12345;
  const rnd = (a, b) => { seed = (seed * 1103515245 + 12345) % 2147483648; return a + (b - a) * seed / 2147483648; };
  const r3 = (a, b) => [rnd(a, b), rnd(a, b), rnd(a, b)];
  const mk = () => {
    const s = rnd(30, 200);
    const par = new L3({ pos: r3(-500, 500), anchor: r3(-50, 50), scale: [s, s, s], orient: r3(-360, 360), rot: r3(-360, 360) });
    return new L3({ parent: rnd(0, 1) < 0.5 ? par : null, pos: r3(-500, 500), anchor: r3(-100, 100),
                    scale: r3(10, 300).map(x => (rnd(0, 1) < 0.15 ? -x : x)), orient: r3(-360, 360), rot: r3(-360, 360) });
  };
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const X = mk(), Y = mk();
    worst = Math.max(worst, maxErr(blendAt(0, X, Y, 0), X, 0), maxErr(blendAt(1, X, Y, 0), Y, 0));
  }
  check(worst < 1e-5, '300 случайных пар: Blend 0/1 точны, худшая ошибка ' + worst.toExponential(1) + ' px');
}

console.log('\n' + passes + ' ok, ' + fails + ' fail');
process.exit(fails ? 1 : 0);
