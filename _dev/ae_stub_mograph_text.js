// Стаб AE DOM + мини-рантайм выражений для MoGraph_text_effector.jsx.
//
// Часть 1 — сценарии кнопки на стабе DOM: создать / стекинг второго эффектора / эффектор +
//           текст (перемер) / только эффектор (перемер + добить контролы) / Alt по тексту и
//           по эффектору / ошибки выделения / Per-character 3D / AE сам кладёт Range Selector /
//           старый AE без dropdown и без composedLineRange / пустой текст / текст на пути.
//           Точность замера раскладки: point text left/center/right в несколько строк, абзацный
//           текст с переносами и полной выключкой — запечённые центры букв против «правды» стаба.
//           Синтаксис всех сгенерированных выражений.
// Часть 2 — математика: сгенерированные выражения селекторов и свойств исполняются для
//           каждой буквы, а стаб применяет их так, как это делает движок текста AE (Amount
//           режется на ±100%, поворот/масштаб — вокруг опоры Anchor Point Grouping, сдвиг —
//           после). Проверяется: вес всех букв клона одинаковый и равен falloff'у в его центре;
//           слово/строка крутятся и масштабируются жёстко вокруг своего центра при любой
//           Anchor Point Grouping; сдвиг эффектора ровно D·w в мире при повёрнутом слое;
//           запас амплитуды (Strength 150, перелёт Spring); Delay движения слоя и реакции на
//           эффектор; маппинг textIndex без переводов строки; ленивость в покое.
//
// Модель стаба — не AE: шрифт выдуманный (ширины из таблицы, чернила 8% от краёв), опора
// группы Word/Line в «правде» стаба — середина пера слова/строки на базовой линии, порядок
// поворотов per-character 3D — X, Y, Z. Это всё надо подтвердить в самом AE.
//
//   node _dev/ae_stub_mograph_text.js           # сценарии + математика, с ассертами
//   node _dev/ae_stub_mograph_text.js --dump    # плюс полные тексты выражений

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'MoGraph_text_effector.jsx');
const SCRIPT = fs.readFileSync(SRC, 'utf8');
const DUMP = process.argv.includes('--dump');

let fails = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log('  ok   ' + msg); }
  else { fails++; console.log('  FAIL ' + msg); }
}

// ================= шрифт и раскладка текста (правда стаба) =================
const MAXF = 3.402823466e38;
const PJ = {
  LEFT_JUSTIFY: 'L', RIGHT_JUSTIFY: 'R', CENTER_JUSTIFY: 'C',
  FULL_JUSTIFY_LASTLINE_LEFT: 'FL', FULL_JUSTIFY_LASTLINE_RIGHT: 'FR',
  FULL_JUSTIFY_LASTLINE_CENTER: 'FC', FULL_JUSTIFY_LASTLINE_FULL: 'FF'
};
const ADV = { ' ': 0.28, i: 0.25, l: 0.25, m: 0.85, W: 0.95, H: 0.72, '.': 0.3, o: 0.6 };
const INK = 0.08;                                        // боковые поля глифа, доля ширины
const isBrk = c => c === '\r' || c === '\n' || c === '\u0003';
const isSp = c => c === ' ' || c === '\t' || isBrk(c);
const advOf = (c, d) => (ADV[c] !== undefined ? ADV[c] : 0.55) * d.fontSize;
const stepOf = (c, d) => advOf(c, d) + d.tracking * d.fontSize / 1000;
let NO_LINE_API = false;

function layout(d) {
  const s = d.text, fsz = d.fontSize, lead = d.autoLeading ? fsz * 1.2 : d.leading;
  const bw = d.boxText ? d.boxTextSize[0] : 0;
  const paras = []; let a0 = 0;
  for (let i = 0; i < s.length; i++) if (isBrk(s[i])) { paras.push([a0, i + 1]); a0 = i + 1; }
  paras.push([a0, s.length]);

  const lines = [];
  for (const [pa, pb] of paras) {
    if (!d.boxText) { lines.push({ a: pa, b: pb, last: true }); continue; }
    let ls = pa;
    for (;;) {
      let pen = 0, wordStart = ls, broke = false;
      for (let j = ls; j < pb; j++) {
        const c = s[j];
        if (isBrk(c)) continue;
        if (!isSp(c) && (j === ls || isSp(s[j - 1]))) wordStart = j;
        pen += stepOf(c, d);
        if (!isSp(c) && pen > bw && wordStart > ls) {
          lines.push({ a: ls, b: wordStart, last: false });
          ls = wordStart; broke = true; break;
        }
      }
      if (!broke) { lines.push({ a: ls, b: pb, last: true }); break; }
    }
  }

  const chars = [], locs = [];
  let rect = null;
  const full = /^F/.test(d.justification);
  lines.forEach((L, j) => {
    const str = s.substring(L.a, L.b);
    const pens = [0];
    let last = -1, first = -1;
    for (let m = 0; m < str.length; m++) {
      const c = str[m];
      pens.push(pens[m] + (isBrk(c) ? 0 : stepOf(c, d)));
      if (!isSp(c)) { last = m; if (first < 0) first = m; }
    }
    const W = last >= 0 ? pens[last + 1] : 0;
    const justified = d.boxText && full && !L.last;
    if (justified && last >= 0) {
      let cnt = 0;
      for (let m = first + 1; m < last; m++) if (isSp(str[m]) && !isBrk(str[m])) cnt++;
      if (cnt) {
        const per = (bw - W) / cnt;
        let add = 0;
        for (let m = 0; m < str.length; m++) {
          if (m > first && m < last && isSp(str[m]) && !isBrk(str[m])) add += per;
          pens[m + 1] += add;
        }
      }
    }
    const j0 = d.justification;
    let sx, sy;
    if (d.boxText) {
      const off = justified ? 0 : j0 === 'C' ? (bw - W) / 2 : j0 === 'R' ? bw - W : 0;
      sx = d.boxTextPos[0] + off;
      sy = d.boxTextPos[1] + fsz * 0.8 + lead * j;
    } else {
      sx = j0 === 'C' ? -W / 2 : j0 === 'R' ? -W : 0;
      sy = lead * j;
    }
    const empty = !str.split('').some(c => !isBrk(c));
    if (empty) locs.push(MAXF, MAXF, MAXF, MAXF);
    else locs.push(sx, sy, sx + (justified ? bw : W), sy);
    for (let m = 0; m < str.length; m++) {
      const c = str[m], x0 = sx + pens[m], x1 = sx + pens[m + 1];
      chars.push({ c, x0, x1, line: j, y: sy });
      if (!isSp(c)) {
        const A = advOf(c, d);
        const r = { l: x0 + INK * A, r: x0 + (1 - INK) * A, t: sy - 0.7 * fsz, b: sy };
        rect = rect ? { l: Math.min(rect.l, r.l), r: Math.max(rect.r, r.r), t: Math.min(rect.t, r.t), b: Math.max(rect.b, r.b) } : r;
      }
    }
  });
  // слова: непробельные серии внутри строки
  let wi = -1, prev = null;
  const words = [];
  chars.forEach((ch, k) => {
    if (isSp(ch.c)) { ch.word = -1; prev = null; return; }
    if (!prev || prev.line !== ch.line) { words.push({ x0: ch.x0, x1: ch.x1, line: ch.line }); wi = words.length - 1; }
    words[wi].x1 = ch.x1;
    ch.word = wi; prev = ch;
  });
  const R = rect || { l: 0, r: 0, t: 0, b: 0 };
  return { lines, chars, words, locs, rect: { left: R.l, top: R.t, width: R.r - R.l, height: R.b - R.t } };
}

class TextDocument {
  constructor(text) {
    Object.assign(this, {
      text: text || '', font: 'Stub-Regular', fontSize: 100, tracking: 0, horizontalScale: 100,
      fauxBold: false, fauxItalic: false, allCaps: false, smallCaps: false, ligature: true,
      autoKernType: 'M', fontCapsOption: 0, digitSet: 0, tsume: 0,
      justification: PJ.LEFT_JUSTIFY, boxText: false, boxTextPos: [0, 0], boxTextSize: [0, 0],
      autoLeading: true, leading: 0
    });
  }
  copy() {
    const d = new TextDocument();
    Object.assign(d, this);
    d.boxTextPos = this.boxTextPos.slice(); d.boxTextSize = this.boxTextSize.slice();
    return d;
  }
  get pointText() { return !this.boxText; }
  get baselineLocs() { return layout(this).locs; }
  get composedLineCount() { return NO_LINE_API ? undefined : layout(this).lines.length; }
  composedLineRange(j, e) {
    if (NO_LINE_API) throw new Error('composedLineRange is not a function');
    const L = layout(this).lines, end = e === undefined ? j + 1 : e;
    return { characterStart: L[j].a, characterEnd: L[end - 1].b };
  }
}

// ================= Часть 1: DOM =================
let LOG, COMP, NO_DROPDOWN = false, AUTO_RANGE = false;
const EXPRS = {};

function layerOf(p) { let g = p; while (g && !g.__layer) g = g._group; return g ? g.__layer : null; }
function pathOf(p) {
  const names = [];
  for (let g = p; g && !g.__layer; g = g._group) names.unshift(g.name);
  return names.join(' > ');
}

class Prop {
  constructor(name, matchName, value) {
    this.name = name; this.matchName = matchName; this._value = value;
    this._expr = ''; this.numKeys = 0; this.canSetExpression = true;
    this._group = null; this._layerRef = null;
  }
  get value() {
    if (this.matchName === 'ADBE Layer Control-0001') {
      const L = this._layerRef; return (L && !L.__removed) ? L.index : 0;
    }
    return this._value instanceof TextDocument ? this._value.copy() : this._value;
  }
  valueAtTime() { return this.value; }
  get expression() { return this._expr; }
  set expression(v) {
    const L = layerOf(this);
    if (L.__locked) throw new Error('layer is locked');
    this._expr = v;
    const who = L.name + ' :: ' + pathOf(this);
    LOG.push({ kind: v === '' ? 'clear' : 'expr', who });
    if (v !== '') (EXPRS[v] = EXPRS[v] || []).push(who);
  }
  setValue(v) {
    if (layerOf(this).__locked) throw new Error('layer is locked');
    if (this.matchName === 'ADBE Layer Control-0001') { this._layerRef = COMP.layer(v); return; }
    this._value = v instanceof TextDocument ? v.copy() : v;
  }
  propertyGroup(n) { let g = this; for (let i = 0; i < (n || 1); i++) g = g._group; return g; }
  get propertyIndex() { return this._group._items.indexOf(this) + 1; }
}

class Group {
  constructor(name, matchName) { this.name = name; this.matchName = matchName; this._items = []; this._group = null; }
  get numProperties() { return this._items.length; }
  property(k) {
    if (typeof k === 'number') return this._items[k - 1] || null;
    return this._items.find(p => p.matchName === k || p.name === k) || null;
  }
  addProperty(mn) {
    const L = layerOf(this);
    if (L.__locked) throw new Error('layer is locked');
    const p = make(mn, L);
    if (!p) throw new Error('stub: unknown matchName ' + mn);
    add(this, p);
    LOG.push({ kind: 'add', who: L.name + ' :: ' + pathOf(p) });
    return p;
  }
  get propertyIndex() { return this._group._items.indexOf(this) + 1; }
  propertyGroup(n) { let g = this; for (let i = 0; i < (n || 1); i++) g = g._group; return g; }
  remove() {
    const L = layerOf(this);
    const a = this._group._items; a.splice(a.indexOf(this), 1);
    LOG.push({ kind: 'remove', who: L.name + ' :: ' + this.name });
  }
}

function add(g, p) { p._group = g; g._items.push(p); return p; }
function group(name, mn, props) {
  const g = new Group(name, mn);
  props.forEach(([n, m, v]) => add(g, new Prop(n, m, v)));
  return g;
}

const EFFECT_PARAM = {
  'ADBE Slider Control':   ['Slider', 0],
  'ADBE Angle Control':    ['Angle', 0],
  'ADBE Checkbox Control': ['Checkbox', 0],
  'ADBE Layer Control':    ['Layer', 0],
  'ADBE Dropdown Control': ['Menu', 1]
};
const TEXT_PROP = {
  'ADBE Text Position 3D': ['Position', [0, 0, 0]],
  'ADBE Text Scale 3D':    ['Scale', [100, 100, 100]],
  'ADBE Text Rotation':    ['Rotation', 0],
  'ADBE Text Rotation X':  ['X Rotation', 0, true],
  'ADBE Text Rotation Y':  ['Y Rotation', 0, true],
  'ADBE Text Opacity':     ['Opacity', 100]
};

function make(mn, L) {
  if (EFFECT_PARAM[mn]) {
    const [nm, v] = EFFECT_PARAM[mn];
    const g = group(mn.replace('ADBE ', ''), mn, [[nm, mn + '-0001', v]]);
    if (mn === 'ADBE Dropdown Control' && !NO_DROPDOWN) {
      g._items[0].setPropertyParameters = function (items) { this._menu = items; return this; };
    }
    return g;
  }
  if (TEXT_PROP[mn]) {
    const [nm, v, only3D] = TEXT_PROP[mn];
    if (only3D && !L.threeDPerChar) throw new Error('stub: ' + nm + ' — только с Per-character 3D');
    return new Prop(nm, mn, v);
  }
  switch (mn) {
    case 'ADBE Text Animator': {
      const g = new Group('Animator 1', mn);
      const sels = add(g, new Group('Selectors', 'ADBE Text Selectors'));
      if (AUTO_RANGE) add(sels, group('Range Selector 1', 'ADBE Text Selector', [['Start', 'ADBE Text Percent Start', 0]]));
      add(g, new Group('Properties', 'ADBE Text Animator Properties'));
      return g;
    }
    case 'ADBE Text Expressible Selector':
      return group('Expression Selector 1', mn, [
        ['Based On', 'ADBE Text Range Type2', 3],                 // нарочно не Characters — скрипт обязан поставить
        ['Amount', 'ADBE Text Expressible Amount', [100, 100, 100]]
      ]);
    case 'ADBE Vector Group': {
      const g = new Group('Group 1', mn);
      add(g, new Group('Contents', 'ADBE Vectors Group'));
      add(g, group('Transform', 'ADBE Vector Transform Group', [['Opacity', 'ADBE Vector Group Opacity', 100]]));
      return g;
    }
    case 'ADBE Vector Shape - Ellipse': return group('Ellipse Path 1', mn, [['Size', 'ADBE Vector Ellipse Size', [100, 100]]]);
    case 'ADBE Vector Shape - Rect':    return group('Rectangle Path 1', mn, [['Size', 'ADBE Vector Rect Size', [100, 100]]]);
    case 'ADBE Vector Shape - Group':   return group('Path 1', mn, [['Path', 'ADBE Vector Shape', null]]);
    case 'ADBE Vector Graphic - Stroke':
      return group('Stroke 1', mn, [
        ['Color', 'ADBE Vector Stroke Color', [1, 1, 1]],
        ['Opacity', 'ADBE Vector Stroke Opacity', 100],
        ['Stroke Width', 'ADBE Vector Stroke Width', 1]
      ]);
  }
  return null;
}

class Layer {
  constructor(name, opts = {}) {
    this.name = name;
    this.comment = '';
    this.guideLayer = false;
    this.__kind = opts.kind || 'av';
    this.__locked = !!opts.locked;
    if (this.__kind !== 'camera') this.threeDLayer = !!opts.threeD;
    this._root = new Group(name, 'root');
    this._root.__layer = this;
    add(this._root, group('Transform', 'ADBE Transform Group', [
      ['Anchor Point', 'ADBE Anchor Point', [0, 0]],
      ['Position', 'ADBE Position', [960, 540]],
      ['Scale', 'ADBE Scale', [100, 100]],
      ['Rotation', 'ADBE Rotate Z', 0],
      ['Opacity', 'ADBE Opacity', 100]
    ]));
    if (this.__kind !== 'camera') add(this._root, new Group('Effects', 'ADBE Effect Parade'));
    if (this.__kind === 'shape') add(this._root, new Group('Contents', 'ADBE Root Vectors Group'));
  }
  property(k) { return this._root.property(k); }
  moveBefore(other) { COMP._move(this, other); }
  remove() { COMP._remove(this); }
}

class TextLayer extends Layer {
  constructor(name, doc, opts = {}) {
    super(name, opts);
    this.threeDPerChar = !!opts.p3d;
    const tp = add(this._root, new Group('Text', 'ADBE Text Properties'));
    const src = add(tp, new Prop('Source Text', 'ADBE Text Document', doc.copy()));
    src.numKeys = opts.srcKeys || 0;
    add(tp, group('Path Options', 'ADBE Text Path Options', [['Path', 'ADBE Text Path', opts.onPath ? 1 : 0]]));
    add(tp, group('More Options', 'ADBE Text More Options', [['Anchor Point Grouping', 'ADBE Text Anchor Point Option', opts.apg || 1]]));
    add(tp, new Group('Animators', 'ADBE Text Animators'));
  }
  get doc() { return this.property('ADBE Text Properties').property('ADBE Text Document')._value; }
  set doc(d) { this.property('ADBE Text Properties').property('ADBE Text Document')._value = d.copy(); }
  sourceRectAtTime() { MEASURES++; return layout(this.doc).rect; }
}
let MEASURES = 0;

function CompItem() {}
function Shape() { this.vertices = []; this.closed = true; }

function makeComp(layers, selected) {
  const comp = Object.create(CompItem.prototype);
  comp._layers = layers.slice();
  const reindex = () => comp._layers.forEach((L, i) => { L.index = i + 1; });
  reindex();
  Object.defineProperty(comp, 'numLayers', { get: () => comp._layers.length });
  comp.layer = i => comp._layers[i - 1];
  comp.width = 1920; comp.height = 1080; comp.time = 0;
  comp.selectedLayers = selected;
  comp.layers = {
    addShape() {
      const L = new Layer('Shape Layer 1', { kind: 'shape' });
      comp._layers.unshift(L); reindex();
      LOG.push({ kind: 'newLayer', who: L.name });
      return L;
    },
    addText(str) {
      const L = new TextLayer('Text 1', new TextDocument(str));
      comp._layers.unshift(L); reindex();
      LOG.push({ kind: 'newText', who: L.name });
      return L;
    }
  };
  comp._move = (L, other) => {
    comp._layers.splice(comp._layers.indexOf(L), 1);
    comp._layers.splice(comp._layers.indexOf(other), 0, L);
    reindex();
  };
  comp._remove = L => {
    comp._layers.splice(comp._layers.indexOf(L), 1);
    L.__removed = true; reindex();
    LOG.push({ kind: 'removeLayer', who: L.name });
  };
  return comp;
}

function run(label, comp, opts = {}) {
  LOG = []; COMP = comp;
  const alerts = [];
  const sandbox = {
    app: { project: { activeItem: comp }, beginUndoGroup() {}, endUndoGroup() {} },
    CompItem, Shape, TextLayer, ParagraphJustification: PJ,
    alert: m => alerts.push(String(m)),
    ScriptUI: { environment: { keyboardState: { altKey: !!opts.alt } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox, { filename: SRC });
  console.log('\n=== ' + label + ' ===');
  alerts.forEach(a => console.log('  alert: ' + a.split('\n').join('\n         ')));
  return alerts;
}

// --- хелперы осмотра ---
const fxOf = L => { const g = L.property('ADBE Effect Parade'); return g ? g._items : []; };
const fxNames = L => fxOf(L).map(f => f.name);
const fx = (L, n) => fxOf(L).find(f => f.name === n);
const linkIdx = (L, n) => { const f = fx(L, n); return f ? f._items[0].value : null; };
const isEff = L => String(L.comment).indexOf('@mgtext-effector') !== -1;
const effectorsIn = comp => comp._layers.filter(isEff);
const anims = T => T.property('ADBE Text Properties').property('ADBE Text Animators')._items;
const animNames = T => anims(T).map(a => a.name);
const anim = (T, n) => anims(T).find(a => a.name === n);
const selOf = a => a.property('ADBE Text Selectors')._items;
const propsOf = a => a.property('ADBE Text Animator Properties')._items;
const amountExpr = a => selOf(a)[0].property('ADBE Text Expressible Amount')._expr;
const baked = (a, nm) => {
  const m = amountExpr(a).match(new RegExp('var ' + nm + ' = \\[([^\\]]*)\\]'));
  return m && m[1] !== '' ? m[1].split(',').map(Number) : [];
};
const doc = (text, o) => Object.assign(new TextDocument(text), o || {});
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);

// ---------- 1. один текстовый слой — создать эффектор ----------
{
  const bg = new Layer('BG'), T = new TextLayer('Title', doc('Hello big world'));
  const comp = makeComp([bg, T], [T]);
  const al = run('1. один текстовый слой — создать', comp);
  const E = effectorsIn(comp)[0];
  check(!!E && E.name === 'MG Text Effector', 'эффектор MG Text Effector создан');
  check(comp.numLayers === 3 && !comp._layers.some(L => /замер/.test(L.name)), 'временный слой замера убран');
  check(E && E.guideLayer === true && E.index === 2 && T.index === 3, 'гайд, стоит прямо над текстом');
  check(E && fxNames(E).join('|') ===
    'Clone|Strength|Position X|Position Y|Position Z|Scale %|Rotation X|Rotation Y|Rotation Z|Opacity %|Falloff shape|Falloff size|Falloff %|Falloff ease|Invert|Delay mode|Delay (frames)|Spring bounce %',
    'полный набор контролов, Clone первым');
  const cl = E && fx(E, 'Clone');
  check(cl && cl.matchName === 'ADBE Dropdown Control' && cl._items[0].value === 1 &&
        cl._items[0]._menu.join(',') === 'Letter,Word,Line', 'Clone — меню Letter / Word / Line, стоит Letter');
  check(E && fx(E, 'Falloff shape')._items[0].value === 4 && fx(E, 'Falloff ease')._items[0].value === 5,
    'по умолчанию Falloff shape = Linear, Falloff ease = Soft (edge)');
  check(E && E.property('ADBE Transform Group').property('ADBE Rotate Z')._value === -90, 'эффектор повёрнут на −90°');
  check(E && E.property('ADBE Root Vectors Group')._items.length === 7, 'гизмо: 7 групп');
  check(fxNames(T).join('|') === 'MG Text' && linkIdx(T, 'MG Text') === E.index, 'на тексте Layer Control «MG Text» → эффектор');
  check(animNames(T).join('|') === 'MG Text · Position|MG Text · Transform|MG Text · Opacity', 'три аниматора');
  const pa = anim(T, 'MG Text · Position'), xa = anim(T, 'MG Text · Transform'), oa = anim(T, 'MG Text · Opacity');
  check(propsOf(pa).map(p => p.matchName).join() === 'ADBE Text Position 3D', 'Position-аниматор: только Position');
  check(propsOf(xa).map(p => p.matchName).join() === 'ADBE Text Scale 3D,ADBE Text Rotation', 'Transform: Scale + Rotation (без X/Y — нет Per-character 3D)');
  check(propsOf(oa).map(p => p.matchName).join() === 'ADBE Text Opacity', 'Opacity-аниматор: только Opacity');
  check([pa, xa, oa].every(a => selOf(a).length === 1 && selOf(a)[0].matchName === 'ADBE Text Expressible Selector' &&
        selOf(a)[0].property('ADBE Text Range Type2')._value === 1), 'у каждого один Expression Selector, Based On = Characters');
  check([pa, xa, oa].every(a => amountExpr(a).indexOf('effect("MG Text")') !== -1 && amountExpr(a).indexOf('@mgtext') !== -1),
    'селекторы смотрят на свой Layer Control и помечены');
  check(propsOf(xa).every(p => p._expr.indexOf('@mgtext') !== -1) && propsOf(pa)[0]._expr.indexOf('10000') !== -1,
    'свойства аниматоров — с выражениями (Position — базис 10000)');
  check(baked(pa, 'CH').length === 15 * 4 && baked(pa, 'WD').length === 3 * 2 && baked(pa, 'LN').length === 3,
    'запечено: 15 символов, 3 слова, 1 строка');
  check(al.length === 1 && /Текстовых слоёв: 1 из 1/.test(al[0]) && !/предупреждения/.test(al[0]), 'отчёт без предупреждений');
}

// ---------- 2. точность замера раскладки ----------
function centersOk(T, label) {
  const truth = layout(T.doc);
  const a = anim(T, 'MG Text · Position');
  const CH = baked(a, 'CH'), LN = baked(a, 'LN');
  let worst = 0, lineOk = true;
  truth.chars.forEach((ch, k) => {
    const cx = (CH[4 * k] + CH[4 * k + 1]) / 2;
    worst = Math.max(worst, Math.abs(cx - (ch.x0 + ch.x1) / 2));
    if (CH[4 * k + 2] !== ch.line || !near(LN[3 * ch.line], ch.y, 0.01)) lineOk = false;
  });
  check(worst < 0.02 && lineOk && CH.length === truth.chars.length * 4,
    label + ': центры букв и базовые линии совпали (худшее ' + worst.toFixed(4) + ' px)');
  return truth;
}
{
  const cases = [
    ['point, left, 2 строки',   doc('Hello big\rworld of text', { tracking: 40 })],
    ['point, center, 3 строки', doc('Mmm iii\rWWW .\r  lead space', { justification: PJ.CENTER_JUSTIFY, fontSize: 64 })],
    ['point, right',            doc('Right aligned text', { justification: PJ.RIGHT_JUSTIFY })],
    ['box, перенос + полная выключка', doc('the quick brown fox jumps over the lazy dog again and again',
        { boxText: true, boxTextPos: [-400, -200], boxTextSize: [800, 400], justification: PJ.FULL_JUSTIFY_LASTLINE_LEFT, fontSize: 60 })],
    ['box, center, перенос',    doc('centered paragraph text wraps here\rsecond para',
        { boxText: true, boxTextPos: [-300, -100], boxTextSize: [600, 300], justification: PJ.CENTER_JUSTIFY, fontSize: 50 })]
  ];
  cases.forEach(([label, d]) => {
    const T = new TextLayer('T', d);
    const comp = makeComp([T], [T]);
    const al = run('2. замер: ' + label, comp);
    const truth = centersOk(T, label);
    if (/box/.test(label)) check(truth.lines.length > 2 && !/предупреждения/.test(al[0]), label + ': строк ' + truth.lines.length + ', переносы взяты из composedLineRange');
  });

  // без composedLineRange (AE до 24.3): абзацный текст — предупреждение
  NO_LINE_API = true;
  const Tb = new TextLayer('Box', doc('one two three four five six seven', { boxText: true, boxTextSize: [300, 400], fontSize: 50 }));
  const al = run('2b. абзацный текст, AE без composedLineRange', makeComp([Tb], [Tb]));
  check(/не отдал переносы/.test(al[0]) && /строки не сошлись/.test(al[0]), 'предупреждения: нет переносов, строки не сошлись');
  check(animNames(Tb).length === 3, 'всё равно подключён');
  const Tp = new TextLayer('Point', doc('two\rlines', { justification: PJ.CENTER_JUSTIFY }));
  const alp = run('2c. point text, AE без composedLineRange', makeComp([Tp], [Tp]));
  NO_LINE_API = false;
  check(!/предупреждения/.test(alp[0]), 'point text без API — строки по переводам, без предупреждений');
  centersOk(Tp, 'point без API');

  // пустая строка посреди текста и перевод строки в конце
  const Te = new TextLayer('Gaps', doc('top\r\rbottom\r', { justification: PJ.CENTER_JUSTIFY }));
  const ale = run('2d. пустая строка и перевод в конце', makeComp([Te], [Te]));
  check(!/предупреждения/.test(ale[0]), 'пустые строки не мешают');
  centersOk(Te, 'пустые строки');
}

// ---------- 3. Per-character 3D, AE сам кладёт Range Selector ----------
{
  AUTO_RANGE = true;
  const T = new TextLayer('3D title', doc('Flip me'), { p3d: true, threeD: true });
  const comp = makeComp([T], [T]);
  run('3. per-character 3D + автоматический Range Selector', comp);
  AUTO_RANGE = false;
  const E = effectorsIn(comp)[0];
  check(E.threeDLayer === true, 'эффектор 3D, раз текст 3D');
  check(propsOf(anim(T, 'MG Text · Transform')).map(p => p.matchName).join() ===
    'ADBE Text Scale 3D,ADBE Text Rotation,ADBE Text Rotation X,ADBE Text Rotation Y', 'Transform: + X/Y Rotation');
  check(anims(T).every(a => selOf(a).length === 1 && selOf(a)[0].matchName === 'ADBE Text Expressible Selector'),
    'Range Selector, положенный AE, убран');
  check(amountExpr(anim(T, 'MG Text · Position')).indexOf('P3D = true') !== -1, 'P3D запечён');
}

// ---------- 4. стекинг, перемер, обновление, Alt ----------
{
  const T = new TextLayer('Title', doc('Stack two effectors'));
  const other = new TextLayer('Other', doc('Other text'));
  const comp = makeComp([T, other], [T]);
  run('4a. первый эффектор', comp);
  const E1 = effectorsIn(comp)[0];

  comp.selectedLayers = [T];
  const al = run('4b. текст с эффектором, без эффектора в выделении — второй поверх', comp);
  const E2 = effectorsIn(comp).find(L => L !== E1);
  check(E2 && E2.name === 'MG Text Effector 2', 'второй эффектор — MG Text Effector 2');
  check(fxNames(T).join('|') === 'MG Text|MG Text 2' && linkIdx(T, 'MG Text') === E1.index && linkIdx(T, 'MG Text 2') === E2.index,
    'две связи: MG Text → первый, MG Text 2 → второй');
  check(animNames(T).length === 6 && anims(T).slice(3).every(a => /^MG Text 2 · /.test(a.name) && amountExpr(a).indexOf('effect("MG Text 2")') !== -1),
    'шесть аниматоров, у второго набора своя ссылка');
  check(/уже есть эффектор «MG Text Effector» — эффекторы складываются/.test(al[0]), 'предупреждение о стекинге');

  // правка текста, затем эффектор 1 + текст — перемер той же связи
  T.doc = doc('Stack two effectors NOW');
  comp.selectedLayers = [E1, T];
  const al2 = run('4c. эффектор 1 + текст — перемер', comp);
  check(fxNames(T).length === 2 && animNames(T).length === 6, 'новых связей и аниматоров нет');
  check(baked(anim(T, 'MG Text · Opacity'), 'CH').length === 23 * 4, 'MG Text перемерен (23 символа)');
  check(baked(anim(T, 'MG Text 2 · Opacity'), 'CH').length === 19 * 4, 'MG Text 2 не тронут (старые 19)');
  check(/Текстовых слоёв: 1 из 1/.test(al2[0]) && !/складываются/.test(al2[0]),
    'отчёт: 1 из 1 (слой не перемерен дважды из-за сдвига индексов), без ложного «складываются»');

  // эффектор 1 + другой текст — добавить; старый текст перемеряется заодно
  T.doc = doc('Stack two effectors NOW!');
  comp.selectedLayers = [E1, other];
  const al3 = run('4d. эффектор 1 + другой текст — добавить', comp);
  check(linkIdx(other, 'MG Text') === E1.index, 'Other подключён к первому');
  check(/Старых текстов перемерено: 1/.test(al3[0]) && baked(anim(T, 'MG Text · Opacity'), 'CH').length === 24 * 4,
    'Title перемерен заодно (Other стоял ниже — после вставки временного слоя его index совпадал со старым index Title)');

  // только эффектор 2, у него нет Clone и Falloff ease (старая версия) — добить и перемерить
  const g = E2.property('ADBE Effect Parade');
  g._items = g._items.filter(f => f.name !== 'Clone' && f.name !== 'Falloff ease');
  comp.selectedLayers = [E2];
  const al4 = run('4e. только эффектор 2 — перемер + добить контролы', comp);
  check(/Контролов добавлено: 2/.test(al4[0]) && /переписано: 1 из 1/.test(al4[0]), 'Clone и Falloff ease добиты, текст переписан');
  check(fxNames(E2).slice(-2).join('|') === 'Clone|Falloff ease', 'встали в конец');
  check(fx(E2, 'Falloff ease')._items[0].value === 2, 'старому эффектору Falloff ease досыпан как Smooth — вид сцены не меняется');
  check(baked(anim(T, 'MG Text 2 · Opacity'), 'CH').length === 24 * 4, 'MG Text 2 перемерен');
  check(anims(T).map(a => a.name).filter(n => /^MG Text 2/.test(n)).length === 3, 'аниматоры не задублировались');

  // Alt по эффектору 2 — снять его связи и удалить его
  comp.selectedLayers = [E2];
  const al5 = run('4f. Alt, эффектор 2', comp, { alt: true });
  check(E2.__removed === true, 'эффектор 2 удалён');
  check(fxNames(T).join('|') === 'MG Text' && animNames(T).every(n => /^MG Text · /.test(n)) && animNames(T).length === 3,
    'у Title остался только первый набор');
  check(/Аниматоров удалено: 3/.test(al5[0]) && /Эффекторов удалено: 1/.test(al5[0]), 'отчёт снятия');

  // Alt по тексту — снять всё с него, эффектор жив
  comp.selectedLayers = [T];
  run('4g. Alt, текстовый слой', comp, { alt: true });
  check(fxNames(T).length === 0 && animNames(T).length === 0, 'Title чистый');
  check(!E1.__removed && linkIdx(other, 'MG Text') === E1.index, 'эффектор и Other не тронуты');
}

// ---------- 5. ошибки выделения и края ----------
{
  const sh = new Layer('Solid');
  const comp = makeComp([sh], [sh]);
  const al = run('5a. выделен не текст', comp);
  check(/нет текстовых слоёв/.test(al[0]) && /не текст, пропущены: Solid/.test(al[0]) && effectorsIn(comp).length === 0,
    'не текст — отказ с объяснением');

  const T = new TextLayer('T', doc('abc'));
  const comp2 = makeComp([T], [T]);
  run('5b. подготовка', comp2);
  comp2.selectedLayers = [T];
  run('5b. второй', comp2);
  const effs = effectorsIn(comp2);
  comp2.selectedLayers = [effs[0], effs[1], T];
  const al2 = run('5c. два эффектора в выделении', comp2);
  check(/несколько эффекторов/.test(al2[0]), 'отказ: несколько эффекторов');

  const Te = new TextLayer('Empty', doc(''));
  const al3 = run('5d. пустой текст', makeComp([Te], [Te]));
  check(/пустой текст/.test(al3[0]) && /Ни один текст/.test(al3[0]), 'пустой текст — отказ, без эффектора');

  const Tp = new TextLayer('Path', doc('on a path'), { onPath: true, apg: 4, srcKeys: 2 });
  const al4 = run('5e. текст на пути, All, анимированный Source Text', makeComp([Tp], [Tp]));
  check(/текст на пути/.test(al4[0]) && /Anchor Point Grouping = All/.test(al4[0]) && /Source Text анимирован/.test(al4[0]),
    'три предупреждения');

  const x = new TextLayer('x', doc('x'));
  const al5 = run('5f. Alt по чистому тексту', makeComp([x], [x]), { alt: true });
  check(/снимать нечего/.test(al5[0]), 'нечего снимать');

  NO_DROPDOWN = true;
  const To = new TextLayer('Old AE', doc('old'));
  const compO = makeComp([To], [To]);
  const al6 = run('5g. старый AE — меню не настраиваются', compO);
  NO_DROPDOWN = false;
  const Eo = effectorsIn(compO)[0];
  check(fx(Eo, 'Clone').matchName === 'ADBE Slider Control' && fx(Eo, 'Clone')._items[0].value === 1 &&
        /«Clone» — слайдер вместо меню: 1 Letter, 2 Word, 3 Line/.test(al6[0]), 'Clone — слайдер 1..3 с легендой');
}

// ---------- синтаксис всех выражений ----------
console.log('\n=== синтаксис сгенерированных выражений ===');
const texts = Object.keys(EXPRS);
texts.forEach(t => {
  let ok = true;
  try { new vm.Script(t); } catch (e) { ok = false; console.log('  СИНТАКСИС: ' + e.message + '\n' + t.slice(0, 400)); }
  if (!ok) fails++; else passes++;
});
console.log('  уникальных выражений: ' + texts.length + ', все проверены new vm.Script');
if (DUMP) texts.slice(0, 12).forEach(t => console.log('\n--- ' + EXPRS[t][0] + ' (x' + EXPRS[t].length + ')\n' + t));

// ================= Часть 2: математика =================
console.log('\n=== математика: выражения + модель движка текста AE ===');

const FD = 1 / 30;
let NOW = 0;
const compiled = {};
function evalIn(text, sb, t) {
  const script = compiled[text] || (compiled[text] = new vm.Script(text));
  const prev = NOW;
  NOW = t || 0;
  sb.time = NOW;
  try { return script.runInContext(sb); } finally { NOW = prev; }
}

// 2D-слой AE: world = Parent·(pos + R(rot)·S·(pt − anchor)), Y вниз, rot по часовой
class L2 {
  constructor(o) { Object.assign(this, { pos: [0, 0], anchor: [0, 0], rot: 0, scale: [100, 100], parent: null, posAt: null }, o); }
  posAtT(t) { return this.posAt ? this.posAt(t) : this.pos; }
  _cs() { const a = this.rot * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; }
  _fwd(v) { const [c, s] = this._cs(); const x = v[0] * this.scale[0] / 100, y = v[1] * this.scale[1] / 100; return [c * x - s * y, s * x + c * y]; }
  _inv(v) { const [c, s] = this._cs(); const x = c * v[0] + s * v[1], y = -s * v[0] + c * v[1]; return [x / (this.scale[0] / 100), y / (this.scale[1] / 100)]; }
  toWorld(pt, t) {
    if (t === undefined) t = NOW;
    const P = this.posAtT(t), r = this._fwd([pt[0] - this.anchor[0], pt[1] - this.anchor[1]]);
    const q = [P[0] + r[0], P[1] + r[1], 0];
    return this.parent ? this.parent.toWorld(q, t) : q;
  }
  fromWorld(W, t) {
    if (t === undefined) t = NOW;
    const q = this.parent ? this.parent.fromWorld(W, t) : W;
    const P = this.posAtT(t), r = this._inv([q[0] - P[0], q[1] - P[1]]);
    return [r[0] + this.anchor[0], r[1] + this.anchor[1], 0];
  }
  toWorldVec(v) { const r = this._fwd(v); const q = [r[0], r[1], 0]; return this.parent ? this.parent.toWorldVec(q) : q; }
  fromWorldVec(v) { const q = this.parent ? this.parent.fromWorldVec(v) : v; const r = this._inv(q); return [r[0], r[1], 0]; }
}

let FROM_WORLD = 0;
function effector(o, params) {
  const E = new L2(o);
  const P = Object.assign({
    'Clone': 1, 'Strength': 100, 'Position X': 0, 'Position Y': 0, 'Position Z': 0, 'Scale %': 100,
    'Rotation X': 0, 'Rotation Y': 0, 'Rotation Z': 0, 'Opacity %': 100,
    'Falloff shape': 2, 'Falloff size': 200, 'Falloff %': 100, 'Falloff ease': 2, 'Invert': 0,
    'Delay mode': 1, 'Delay (frames)': 6, 'Spring bounce %': 50
  }, params);
  const val = (n, t) => (typeof P[n] === 'function' ? P[n](t) : P[n]);
  E.effect = n => {
    if (!(n in P)) throw new Error('effect not found: ' + n);
    return () => ({ get value() { return val(n, NOW); }, valueAtTime: t => val(n, t) });
  };
  E.transform = { position: { get value() { return E.posAtT(NOW).slice(0, 2); } } };
  const fw = L2.prototype.fromWorld;
  E.fromWorld = (W, t) => { FROM_WORLD++; return fw.call(E, W, t); };
  return E;
}

// Риг с текстового слоя стаба: выражения селекторов и свойств + правда раскладки.
function rigOf(T, link) {
  const A = kind => anim(T, link + ' · ' + kind);
  const pe = (a, mn) => { const p = a.property('ADBE Text Animator Properties').property(mn); return p ? p._expr : null; };
  return {
    link, T,
    selPos: amountExpr(A('Position')), selXf: amountExpr(A('Transform')), selOp: amountExpr(A('Opacity')),
    vPos: pe(A('Position'), 'ADBE Text Position 3D'), vScale: pe(A('Transform'), 'ADBE Text Scale 3D'),
    vRot: pe(A('Transform'), 'ADBE Text Rotation'), vRotX: pe(A('Transform'), 'ADBE Text Rotation X'),
    vRotY: pe(A('Transform'), 'ADBE Text Rotation Y'), vOp: pe(A('Opacity'), 'ADBE Text Opacity'),
    truth: layout(T.doc),
    apg: T.property('ADBE Text Properties').property('ADBE Text More Options').property('ADBE Text Anchor Point Option')._value
  };
}

function rigged(text, o, lo) {        // текстовый слой с одним эффектором, прогнанный через кнопку
  const T = new TextLayer('T', doc(text, o), lo);
  const comp = makeComp([T], [T]);
  LOG = []; COMP = comp;
  const sandbox = {
    app: { project: { activeItem: comp }, beginUndoGroup() {}, endUndoGroup() {} },
    CompItem, Shape, TextLayer, ParagraphJustification: PJ, alert() {},
    ScriptUI: { environment: { keyboardState: { altKey: false } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  return rigOf(T, 'MG Text');
}

// Движок текста AE для одной буквы (textIndex i, 1-based) в момент t.
// TL — трансформ текстового слоя (L2), E — эффектор.
function engine(rig, TL, E, opts = {}) {
  const effect = n => { if (n === rig.link) return () => E; throw new Error('effect not found: ' + n); };
  const thisLayer = {
    toWorld: (p, t) => TL.toWorld(p, t), fromWorldVec: v => TL.fromWorldVec(v), hasParent: !!TL.parent,
    transform: { position: { get numKeys() { return TL.posAt ? 2 : 0; } }, anchorPoint: { numKeys: 0 }, scale: { numKeys: 0 }, rotation: { numKeys: 0 } }
  };
  const base = { thisComp: { frameDuration: FD }, clamp: (v, a, b) => Math.min(Math.max(v, a), b), degreesToRadians: d => d * Math.PI / 180, effect, thisLayer };
  const sSel = vm.createContext(Object.assign({}, base)), sProp = vm.createContext(Object.assign({}, base));
  const N = rig.truth.chars.length;
  const total = opts.noBreaks ? rig.truth.chars.filter(c => !isBrk(c.c)).length : N;
  const map = [];                                      // textIndex -> номер символа в строке
  rig.truth.chars.forEach((c, k) => { if (!opts.noBreaks || !isBrk(c.c)) map.push(k); });
  const amt = (text, i, t) => {
    sSel.textIndex = i; sSel.textTotal = total;
    const r = evalIn(text, sSel, t);
    const a = Array.isArray(r) ? r : [r, r, r];
    return a.map(x => Math.max(-100, Math.min(100, x)) / 100);   // AE режет Amount на ±100%
  };
  const pv = (text, dflt, t) => { if (!text) return dflt; sProp.value = dflt; return evalIn(text, sProp, t); };
  return {
    total, map,
    at(i, t) {
      const aP = amt(rig.selPos, i, t), aT = amt(rig.selXf, i, t), aO = amt(rig.selOp, i, t);
      const P = pv(rig.vPos, [0, 0, 0], t), S = pv(rig.vScale, [100, 100, 100], t);
      const rz = pv(rig.vRot, 0, t), rx = pv(rig.vRotX, 0, t), ry = pv(rig.vRotY, 0, t), op = pv(rig.vOp, 100, t);
      return {
        s: 1 + (S[0] / 100 - 1) * aT[0], rz: rz * aT[0], rx: rx * aT[0], ry: ry * aT[0],
        pos: [P[0] * aP[0], P[1] * aP[1], P[2] * aP[2]],
        op: Math.max(0, Math.min(100, 100 + (op - 100) * aO[0])), aT, aP, aO
      };
    }
  };
}

// Поворот·масштаб вокруг опоры a, потом сдвиг — как AE применяет аниматоры к букве
function xform(X, a, v) {
  let x = (v[0] - a[0]) * X.s, y = (v[1] - a[1]) * X.s, z = ((v[2] || 0) - (a[2] || 0)) * X.s, t1;
  const r = d => d * Math.PI / 180, ax = r(X.rx), by = r(X.ry), gz = r(X.rz);
  t1 = y * Math.cos(ax) - z * Math.sin(ax); z = y * Math.sin(ax) + z * Math.cos(ax); y = t1;
  t1 = x * Math.cos(by) + z * Math.sin(by); z = -x * Math.sin(by) + z * Math.cos(by); x = t1;
  t1 = x * Math.cos(gz) - y * Math.sin(gz); y = x * Math.sin(gz) + y * Math.cos(gz); x = t1;
  const p = X.pos || [0, 0, 0];
  return [x + a[0] + p[0], y + a[1] + p[1], z + (a[2] || 0) + p[2]];
}

// Опора группы в правде стаба: 1 буква, 2 слово, 3 строка
function pivot(rig, k, m) {
  const ch = rig.truth.chars[k];
  if (m === 2 && ch.word >= 0) { const w = rig.truth.words[ch.word]; return [(w.x0 + w.x1) / 2, ch.y, 0]; }
  if (m === 3) {
    const cs = rig.truth.chars.filter(c => c.line === ch.line && !isSp(c.c));
    return [(Math.min(...cs.map(c => c.x0)) + Math.max(...cs.map(c => c.x1))) / 2, ch.y, 0];
  }
  return [(ch.x0 + ch.x1) / 2, ch.y, 0];
}

const YC = -35;   // середина заглавной H в стабе: чернила от −0.7·size до 0, size 100
const ramp = (d, a, b) => d <= a ? 1 : d >= b ? 0 : 1 - Math.pow((d - a) / (b - a), 2) * (3 - 2 * (d - a) / (b - a));

// Жёсткость клона: каждая точка буквы уходит как M(v − p) + p + D·w у всей группы
function rigidCheck(label, rig, TL, E, mode, par, opts = {}) {
  const eng = engine(rig, TL, E, opts);
  let worst = 0, sameW = true, wOf = {};
  for (let i = 1; i <= eng.total; i++) {
    const k = eng.map[i - 1], ch = rig.truth.chars[k];
    if (isSp(ch.c)) continue;
    const X = eng.at(i, opts.t || 0);
    const w = (X.s - 1) / (par.S / 100 - 1);           // вес из масштаба
    const g = mode === 1 ? 'c' + k : mode === 2 ? 'w' + ch.word : 'l' + ch.line;
    if (g in wOf) { if (!near(wOf[g], w, 1e-9)) sameW = false; } else wOf[g] = w;
    const a = pivot(rig, k, rig.apg), p = pivot(rig, k, mode);
    const M = { s: X.s, rz: par.RZ * w, rx: (par.RX || 0) * w, ry: (par.RY || 0) * w };
    const D = [par.PX * w, par.PY * w, 0];
    [a, [a[0] + 7, a[1] - 60, 0], [a[0] - 20, a[1] + 15, 0]].forEach(v => {
      const got = opts.local ? xform(X, a, v) : TL.toWorld(xform(X, a, v));
      const ideal0 = xform(Object.assign({ pos: [0, 0, 0] }, M), p, v);
      const ideal = opts.local ? [ideal0[0] + D[0], ideal0[1] + D[1], ideal0[2]] : (() => { const q = TL.toWorld(ideal0); return [q[0] + D[0], q[1] + D[1]]; })();
      for (let c = 0; c < ideal.length; c++) worst = Math.max(worst, Math.abs(got[c] - ideal[c]));
    });
  }
  check(sameW && worst < 1e-6, label + ' (худшее ' + worst.toExponential(1) + ')');
  return wOf;
}

const TEXT = 'Hello big world';
// --- вес: буква / слово / строка ---
{
  const rig = rigged(TEXT);
  const TL = new L2({ pos: [600, 500] });
  // эффектор над «b»: Sphere, falloff 50%, Scale % 0 -> масштаб буквы = 1 − w
  const kb = TEXT.indexOf('b'), cb = rig.truth.chars[kb];
  const at = TL.toWorld([(cb.x0 + cb.x1) / 2, YC]);
  const E = effector({ pos: [at[0], at[1]] }, { 'Falloff size': 150, 'Falloff %': 50, 'Scale %': 0 });
  const sph = pt => { const d = Math.hypot(pt[0] - at[0], pt[1] - at[1]); return ramp(d, 75, 150); };

  const eng = engine(rig, TL, E);
  let ok = true;
  for (let i = 1; i <= eng.total; i++) {
    const ch = rig.truth.chars[i - 1];
    const want = sph(TL.toWorld([(ch.x0 + ch.x1) / 2, YC]));
    if (!near(1 - eng.at(i, 0).s, want, 1e-9)) ok = false;
  }
  check(ok, 'Letter: вес каждой буквы = Sphere в её центре (середина высоты H)');

  const Ew = effector({ pos: [at[0], at[1]] }, { 'Falloff size': 150, 'Falloff %': 50, 'Scale %': 0, 'Clone': 2 });
  const engw = engine(rig, TL, Ew);
  let okw = true;
  for (let i = 1; i <= engw.total; i++) {
    const ch = rig.truth.chars[i - 1];
    if (isSp(ch.c)) continue;
    const w = rig.truth.words[ch.word];
    const want = sph(TL.toWorld([(w.x0 + w.x1) / 2, YC]));
    if (!near(1 - engw.at(i, 0).s, want, 1e-9)) okw = false;
  }
  check(okw, 'Word: все буквы слова берут вес из центра слова');

  const El = effector({ pos: [at[0], at[1]] }, { 'Falloff size': 150, 'Falloff %': 50, 'Scale %': 0, 'Clone': 3 });
  const engl = engine(rig, TL, El);
  const ws = []; for (let i = 1; i <= engl.total; i++) ws.push(1 - engl.at(i, 0).s);
  const cs = rig.truth.chars.filter(c => !isSp(c.c));
  const lc = [(Math.min(...cs.map(c => c.x0)) + Math.max(...cs.map(c => c.x1))) / 2, YC];
  check(ws.every(w => near(w, sph(TL.toWorld(lc)), 1e-9)), 'Line: одна строка — один вес у всех букв');

  // Falloff ease: рампа та же, что у эффектора слоёв (там проверены все 8 кривых) — здесь
  // только что она та же и что меню доезжает до веса
  const rampSrc = f => {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const m = src.match(/var RAMP =[\s\S]*?"\}\\n";/);
    return m ? m[0].replace(/\/\/[^"]*/g, '').replace(/\s+/g, ' ') : null;
  };
  check(rampSrc('MoGraph_text_effector.jsx') !== null && rampSrc('MoGraph_text_effector.jsx') === rampSrc('MoGraph_effector.jsx'),
    'рампа с изингом — та же, что у эффектора слоёв');
  const hardRef = u => u < 0.5 ? 0.5 * u / (u + 14 * (0.5 - u)) : 0.5 * (u - 1) / (1 - u - 14 * (0.5 - u)) + 1;
  const easeW = e => {
    const Ee = effector({ pos: [at[0], at[1]] }, { 'Falloff size': 150, 'Falloff %': 50, 'Scale %': 0, 'Falloff ease': e });
    const en = engine(rig, TL, Ee);
    let ok = true, moved = false;
    for (let i = 1; i <= en.total; i++) {
      const ch = rig.truth.chars[i - 1], W = TL.toWorld([(ch.x0 + ch.x1) / 2, YC]);
      const d = Math.hypot(W[0] - at[0], W[1] - at[1]), u = d <= 75 ? 1 : d >= 150 ? 0 : (150 - d) / 75;
      const want = e === 1 ? u : hardRef(u), got = 1 - en.at(i, 0).s;
      if (!near(got, want, 1e-9)) ok = false;
      if (u > 0.05 && u < 0.95) moved = true;
    }
    return ok && moved;
  };
  check(easeW(1) && easeW(4), 'Falloff ease доезжает до букв: Linear и Hard по формуле');
}

// --- жёсткость клона при любой Anchor Point Grouping ---
{
  const par = { S: 60, RZ: 35, PX: 80, PY: -40 };
  const P = { 'Falloff shape': 1, 'Scale %': par.S, 'Rotation Z': par.RZ, 'Position X': par.PX, 'Position Y': par.PY };
  const rig = rigged(TEXT);
  const TL = new L2({ pos: [600, 500], anchor: [30, -10], rot: 20, scale: [120, 80] });
  rigidCheck('Letter, APG Character: буква вокруг своего центра, сдвиг D в мире', rig, TL, effector({}, Object.assign({ 'Clone': 1 }, P)), 1, par);
  rigidCheck('Word, APG Character: слово жёстко вокруг своего центра', rig, TL, effector({}, Object.assign({ 'Clone': 2 }, P)), 2, par);
  rigidCheck('Line, APG Character: строка жёстко вокруг своего центра', rig, TL, effector({}, Object.assign({ 'Clone': 3 }, P)), 3, par);

  const rigW = rigged(TEXT, {}, { apg: 2 });
  rigidCheck('Letter, APG Word: буква всё равно вокруг себя', rigW, TL, effector({}, Object.assign({ 'Clone': 1 }, P)), 1, par);
  const rigL = rigged(TEXT, {}, { apg: 3 });
  rigidCheck('Word, APG Line: слово вокруг своего центра', rigL, TL, effector({}, Object.assign({ 'Clone': 2 }, P)), 2, par);

  // вес частичный (Sphere), под родителем
  const Par = new L2({ pos: [100, 50], rot: -30, scale: [150, 150] });
  const TLp = new L2({ pos: [300, 250], rot: 10, parent: Par });
  const mid = TLp.toWorld([400, YC]);
  rigidCheck('Word, Sphere (частичный вес), слой под повёрнутым родителем', rig, TLp,
    effector({ pos: [mid[0], mid[1]] }, Object.assign({ 'Clone': 2 }, P, { 'Falloff shape': 2, 'Falloff size': 600, 'Falloff %': 80 })), 2, par);

  // запас амплитуды: Strength 150 -> вес 1.5, Amount Transform = 75% — не режется
  const w15 = rigidCheck('Strength 150: вес 1.5 проходит через Amount без обрезки', rig, TL,
    effector({}, Object.assign({ 'Clone': 2, 'Strength': 150 }, P)), 2, par);
  check(Object.values(w15).every(w => near(w, 1.5, 1e-9)), 'вес ровно 1.5 у всех слов');

  // многострочный текст, textTotal без переводов строки
  const rigM = rigged('ab cd\ref gh\rij', { justification: PJ.CENTER_JUSTIFY });
  rigidCheck('3 строки, textTotal С переводами строки', rigM, TL, effector({}, Object.assign({ 'Clone': 3 }, P)), 3, par);
  rigidCheck('3 строки, textTotal БЕЗ переводов строки (маппинг NR)', rigM, TL, effector({}, Object.assign({ 'Clone': 3 }, P)), 3, par, { noBreaks: true });

  // per-character 3D: X/Y/Z-повороты, порядок X→Y→Z (модель, в AE не проверено)
  const rig3 = rigged(TEXT, {}, { p3d: true });
  const par3 = { S: 80, RZ: 25, RX: 40, RY: -30, PX: 0, PY: 0 };
  rigidCheck('per-char 3D, Word: X/Y/Z-повороты — жёстко (в системе слоя)', rig3, new L2({}),
    effector({}, { 'Clone': 2, 'Falloff shape': 1, 'Scale %': 80, 'Rotation Z': 25, 'Rotation X': 40, 'Rotation Y': -30 }), 2, par3, { local: true });
}

// --- Opacity, покой, лень ---
{
  const rig = rigged(TEXT);
  const TL = new L2({ pos: [600, 500] });
  const E = effector({}, { 'Falloff shape': 1, 'Strength': 50, 'Opacity %': 0 });
  const X = engine(rig, TL, E).at(1, 0);
  check(near(X.op, 50) && near(X.s, 1) && X.aP.every(a => a === 0), 'Opacity 0% при весе 0.5 — 50%, остальное не тронуто');

  FROM_WORLD = 0;
  const idle = effector({}, { 'Falloff shape': 1 });
  const eng = engine(rig, TL, idle);
  let zero = true;
  for (let i = 1; i <= eng.total; i++) { const Y = eng.at(i, 0); if (Y.aT.concat(Y.aP, Y.aO).some(a => a !== 0)) zero = false; }
  check(zero && FROM_WORLD === 0, 'эффектор в покое: все Amount = 0, вес ни разу не считался');

  FROM_WORLD = 0;
  const idleD = effector({}, { 'Falloff shape': 1, 'Delay mode': 3 });
  const engD = engine(rig, TL, idleD);
  for (let i = 1; i <= engD.total; i++) engD.at(i, 0);
  check(FROM_WORLD === 0, 'Spring включён, но слой неподвижен и параметры нейтральны — истории нет');

  const Eoff = effector({}, { 'Falloff shape': 1, 'Scale %': 50 });
  const r0 = engine(rig, TL, Eoff).at(3, 0);
  const TLnone = new L2({ pos: [600, 500] });
  const eNone = engine(rig, TLnone, null);
  const Xn = eNone.at(3, 0);
  check(near(r0.s, 0.5) && Xn.s === 1 && Xn.aP.every(a => a === 0), 'Layer Control пуст (эффектор удалён) — без эффекта, без ошибки');
}

// --- Delay / Spring ---
{
  const A6 = Math.exp(-1 / 6), k6 = 1 - Math.pow(A6, 6);
  const rig = rigged(TEXT);

  // движение слоя: прыжок +100 по X в t=1, Blend, Word. Параметры нейтральны — отставание всё равно есть
  const TL = new L2({ posAt: t => (t >= 1 - 1e-9 ? [700, 500] : [600, 500]) });
  const E = effector({}, { 'Falloff shape': 1, 'Delay mode': 2, 'Clone': 2 });
  const eng = engine(rig, TL, E);
  const t = 1 + 5 * FD;
  const offs = [];
  for (let i = 1; i <= eng.total; i++) {
    if (isSp(rig.truth.chars[i - 1].c)) continue;
    const X = eng.at(i, t);
    offs.push(TL.toWorldVec(X.pos));
  }
  check(offs.every(o => near(o[0], -100 * Math.pow(A6, 6), 1e-6) && near(o[1], 0, 1e-9)),
    'слой прыгнул — клоны отстают: через 6 кадров пройдено 63% (' + (100 * k6).toFixed(1) + ' px)');

  // слой вращается: при Clone = Word слово отстаёт целиком (одинаковый сдвиг у букв слова)
  const TLr = new L2({ pos: [600, 500], posAt: null });
  TLr.rotAt = tt => (tt >= 1 - 1e-9 ? 40 : 0);
  Object.defineProperty(TLr, 'rot', { get() { return this.rotAt(NOW_ROT); } });
  let NOW_ROT = 0;
  const TLrot = {
    toWorld: (p, tt) => { NOW_ROT = tt === undefined ? NOW : tt; return TLr.toWorld(p, NOW_ROT); },
    toWorldVec: v => { NOW_ROT = NOW; return TLr.toWorldVec(v); },
    fromWorldVec: v => { NOW_ROT = NOW; return TLr.fromWorldVec(v); },
    parent: { toWorld: (q) => q, fromWorld: q => q, toWorldVec: v => v, fromWorldVec: v => v }, posAt: null
  };
  const engR = engine(rig, TLrot, effector({}, { 'Falloff shape': 1, 'Delay mode': 2, 'Clone': 2 }));
  const byWord = {};
  let rigidWords = true;
  for (let i = 1; i <= engR.total; i++) {
    const ch = rig.truth.chars[i - 1];
    if (isSp(ch.c)) continue;
    const p = engR.at(i, t).pos;
    if (byWord[ch.word]) { if (!near(byWord[ch.word][0], p[0], 1e-9) || !near(byWord[ch.word][1], p[1], 1e-9)) rigidWords = false; }
    else byWord[ch.word] = p;
  }
  const distinct = new Set(Object.values(byWord).map(p => p[0].toFixed(6))).size;
  check(rigidWords && distinct === 3, 'слой повернулся под родителем — слово отстаёт целиком, у слов свой сдвиг');

  // реакция на эффектор: эффектор прыгает на текст в t=1, Scale % 0, Blend
  const TL2 = new L2({ pos: [600, 500] });
  const Ej = effector({ posAt: tt => (tt >= 1 - 1e-9 ? [900, 480] : [5000, 5000]) },
    { 'Falloff shape': 2, 'Falloff size': 2000, 'Falloff %': 0, 'Scale %': 0, 'Delay mode': 2 });
  const ej = engine(rig, TL2, Ej);
  check(near(1 - ej.at(1, t).s, k6, 1e-9) && near(1 - ej.at(1, 1 - FD).s, 0, 1e-9), 'эффектор наехал — вес догоняет по Blend: 63% за 6 кадров');

  // Spring: перелёт веса за 1 доходит до масштаба (Amount не режется)
  const Es = effector({ posAt: Ej.posAt }, { 'Falloff shape': 2, 'Falloff size': 2000, 'Falloff %': 0, 'Scale %': 0, 'Delay mode': 3, 'Spring bounce %': 80 });
  const es = engine(rig, TL2, Es);
  let minS = 9;
  for (let kk = 0; kk <= 40; kk++) minS = Math.min(minS, es.at(1, 1 + kk * FD).s);
  check(minS < -0.05, 'Spring bounce 80%: вес перелетает за 1, Scale уходит в минус (' + minS.toFixed(3) + ') — запас K работает');

  // Position при Delay: движение эффектора с весом 1 — сдвиг D·w у всех букв одинаковый и с задержкой
  const Ep = effector({ posAt: Ej.posAt }, { 'Falloff shape': 2, 'Falloff size': 2000, 'Falloff %': 0, 'Position Y': -100, 'Delay mode': 2, 'Clone': 2 });
  const ep = engine(rig, TL2, Ep);
  check(near(TL2.toWorldVec(ep.at(1, t).pos)[1], -100 * k6, 1e-6), 'Position эффектора — с той же задержкой веса');
}

console.log('\n' + (fails ? 'ПРОВАЛОВ: ' + fails : 'всё зелёное') + ' (проверок: ' + (passes + fails) + ')');
process.exitCode = fails ? 1 : 0;
