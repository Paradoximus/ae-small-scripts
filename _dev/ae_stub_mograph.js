// Стаб AE DOM + мини-рантайм выражений для MoGraph_effector.jsx.
//
// Часть 1 — сценарии кнопки на стабе DOM: создать / добавить к эффектору / перевесить
//           клон / Alt-снять / обновить старый эффектор (до Delay) / ошибки выделения /
//           камера / чужое выражение / старый AE без setPropertyParameters.
//           Синтаксис всех сгенерированных выражений.
// Часть 2 — математика самих выражений на честной 2D-модели трансформа AE
//           (world = Parent·(pos + R·S·(pt − anchor))), со временем: веса всех форм
//           falloff'а; точность сдвига через Anchor Point при повёрнутом/масштабированном
//           родителе и флипе; Delay/Spring — Blend по формуле, перелёт Spring, отсутствие
//           скачка на краю окна истории, задержка собственных ключей, движения родителя и
//           реакции на эффектор (вес в прошлом — вложенное вычисление, как valueAtTime в AE).
//
// Чего стаб НЕ проверяет: 3D-ветку сдвига (fromWorldVec самого слоя — проверено в AE
// руками), живые dropdown/Layer Control, отрисовку гизмо, скорость в AE.
//
//   node _dev/ae_stub_mograph.js           # сценарии + математика, с ассертами
//   node _dev/ae_stub_mograph.js --dump    # плюс полные тексты выражений

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'MoGraph_effector.jsx');
const SCRIPT = fs.readFileSync(SRC, 'utf8');
const DUMP = process.argv.includes('--dump');

let fails = 0, passes = 0;
function check(cond, msg) {
  if (cond) { passes++; console.log('  ok   ' + msg); }
  else { fails++; console.log('  FAIL ' + msg); }
}

// ================= Часть 1: DOM =================
let LOG, COMP, NO_DROPDOWN = false;
const EXPRS = {};   // текст выражения -> где стоит

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
    return this._value;
  }
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
    this._value = v;
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
    const p = make(mn);
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
    LOG.push({ kind: 'removeFx', who: L.name + ' :: ' + this.name });
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

function make(mn) {
  if (EFFECT_PARAM[mn]) {
    const [nm, v] = EFFECT_PARAM[mn];
    const g = group(mn.replace('ADBE ', ''), mn, [[nm, mn + '-0001', v]]);
    if (mn === 'ADBE Dropdown Control' && !NO_DROPDOWN) {
      g._items[0].setPropertyParameters = function (items) { this._menu = items; return this; };
    }
    return g;
  }
  switch (mn) {
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
  // kind: av | shape | camera
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
      ['X Rotation', 'ADBE Rotate X', 0],
      ['Y Rotation', 'ADBE Rotate Y', 0],
      ['Rotation', 'ADBE Rotate Z', 0],
      ['Opacity', 'ADBE Opacity', 100]
    ]));
    if (this.__kind !== 'camera') add(this._root, new Group('Effects', 'ADBE Effect Parade'));
    if (this.__kind === 'shape') add(this._root, new Group('Contents', 'ADBE Root Vectors Group'));
    // чужие выражения: { 'ADBE Scale': 'wiggle(1,10)' }
    Object.keys(opts.foreign || {}).forEach(mn => {
      this.property('ADBE Transform Group').property(mn)._expr = opts.foreign[mn];
    });
  }
  property(k) { return this._root.property(k); }
  moveBefore(other) { COMP._move(this, other); }
  remove() { COMP._remove(this); }
}

function CompItem() {}
function Shape() { this.vertices = []; this.closed = true; }

function makeComp(layers, selected) {
  const comp = Object.create(CompItem.prototype);
  comp._layers = layers.slice();
  const reindex = () => comp._layers.forEach((L, i) => { L.index = i + 1; });
  reindex();
  Object.defineProperty(comp, 'numLayers', { get: () => comp._layers.length });
  comp.layer = i => comp._layers[i - 1];
  comp.width = 1920; comp.height = 1080;
  comp.selectedLayers = selected;
  comp.layers = {
    addShape() {
      const L = new Layer('Shape Layer 1', { kind: 'shape' });
      comp._layers.unshift(L); reindex();
      LOG.push({ kind: 'newLayer', who: L.name });
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
    CompItem, Shape,
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
const fxNames = L => { const g = L.property('ADBE Effect Parade'); return g ? g._items.map(f => f.name) : []; };
const fx = (L, n) => { const g = L.property('ADBE Effect Parade'); return g && g._items.find(f => f.name === n); };
const trExpr = (L, mn) => L.property('ADBE Transform Group').property(mn)._expr;
const ours = (L, mn) => trExpr(L, mn).indexOf('@mograph') !== -1;
const linkIdx = L => { const f = fx(L, 'MG Effector'); return f ? f._items[0].value : null; };
const isEff = L => String(L.comment).indexOf('@mograph-effector') !== -1;
const effectorsIn = comp => comp._layers.filter(isEff);

// ---------- 1. три 2D-слоя -> новый эффектор ----------
{
  const a = new Layer('dot A'), b = new Layer('dot B'), c = new Layer('dot C'), bg = new Layer('BG');
  const comp = makeComp([bg, a, b, c], [a, b, c]);
  const al = run('1. три 2D-слоя — создать эффектор', comp);
  const E = effectorsIn(comp)[0];
  check(!!E, 'эффектор создан');
  check(E && E.name === 'MG Effector', 'имя MG Effector');
  check(E && E.guideLayer === true && E.threeDLayer === false, 'гайд, 2D (все клоны 2D)');
  check(E && E.index === 2, 'встал прямо над верхним клоном (под BG)');
  check(E && fxNames(E).join('|') ===
    'Strength|Position X|Position Y|Position Z|Scale %|Rotation X|Rotation Y|Rotation Z|Opacity %|Falloff shape|Falloff size|Falloff %|Falloff ease|Invert|Delay mode|Delay (frames)|Spring bounce %',
    'полный набор контролов на эффекторе');
  const menu = E && fx(E, 'Falloff shape');
  check(menu && menu.matchName === 'ADBE Dropdown Control' && menu._items[0].value === 4 &&
        menu._items[0]._menu.join(',') === 'Infinite,Sphere,Box,Linear', 'Falloff shape — меню, по умолчанию Linear');
  const emenu = E && fx(E, 'Falloff ease');
  check(emenu && emenu._items[0].value === 5 && emenu._items[0]._menu[4] === 'Soft (edge)', 'Falloff ease — по умолчанию Soft (edge)');
  check(E && E.property('ADBE Transform Group').property('ADBE Rotate Z')._value === -90, 'эффектор повёрнут на −90°');
  const dmenu = E && fx(E, 'Delay mode');
  check(dmenu && dmenu.matchName === 'ADBE Dropdown Control' && dmenu._items[0].value === 1 &&
        dmenu._items[0]._menu.join(',') === 'Off,Blend,Spring', 'Delay mode — меню, стоит Off');
  check(E && fx(E, 'Delay (frames)')._items[0].value === 6 && fx(E, 'Spring bounce %')._items[0].value === 50,
    'Delay (frames) = 6, Spring bounce % = 50');
  check(E && fx(E, 'Falloff size')._items[0].value === 270, 'Falloff size = min(w,h)/4 = 270');
  const giz = E ? E.property('ADBE Root Vectors Group')._items.map(g => g.name) : [];
  check(giz.join('|') === 'Sphere|Sphere inner|Box|Box inner|Linear full|Linear zero|Center', 'гизмо: 7 групп');
  const cross = E && E.property('ADBE Root Vectors Group').property('Center')
    .property('ADBE Vectors Group').property(1).property('ADBE Vector Shape')._value;
  check(cross instanceof Shape && cross.closed === false && cross.vertices.length === 5, 'крестик — открытый путь из 5 точек');
  check(E && E.property('ADBE Transform Group').property('ADBE Position')._expr === '', 'выражение центроида снято с Position эффектора');
  [a, b, c].forEach(L => {
    check(fxNames(L).join('|') === 'MG Effector|MG Weight', L.name + ': эффекты MG Effector + MG Weight');
    check(linkIdx(L) === E.index, L.name + ': Layer Control смотрит на эффектор');
    check(['ADBE Anchor Point', 'ADBE Scale', 'ADBE Rotate Z', 'ADBE Opacity'].every(mn => ours(L, mn)),
      L.name + ': выражения на Anchor/Scale/Rotation/Opacity');
    check(trExpr(L, 'ADBE Rotate X') === '' && trExpr(L, 'ADBE Position') === '', L.name + ': X Rotation и Position не тронуты');
  });
  check(al.length === 1 && /Клонов: 3 из 3/.test(al[0]) && !/предупреждения/.test(al[0]), 'отчёт: 3 из 3, без предупреждений');
}

// ---------- 2. 2D + 3D + камера ----------
{
  const a = new Layer('flat'), b = new Layer('cube', { threeD: true }), cam = new Layer('Camera 1', { kind: 'camera' });
  const comp = makeComp([cam, a, b], [cam, a, b]);
  const al = run('2. 2D + 3D + камера', comp);
  const E = effectorsIn(comp)[0];
  check(E && E.threeDLayer === true, 'эффектор 3D, раз есть 3D-клон');
  check(ours(b, 'ADBE Rotate X') && ours(b, 'ADBE Rotate Y'), 'cube: X/Y Rotation тоже');
  check(!ours(a, 'ADBE Rotate X'), 'flat: X Rotation нет');
  check(/Camera 1: камера\/свет — пропущен/.test(al[0]) && /Клонов: 2 из 2/.test(al[0]), 'камера пропущена с предупреждением');
}

// ---------- 3. чужое выражение на Scale ----------
{
  const a = new Layer('wiggly', { foreign: { 'ADBE Scale': 'wiggle(2, 10)' } });
  const comp = makeComp([a], [a]);
  const al = run('3. чужое выражение на Scale', comp);
  check(trExpr(a, 'ADBE Scale') === 'wiggle(2, 10)', 'чужой wiggle не затёрт');
  check(ours(a, 'ADBE Anchor Point') && ours(a, 'ADBE Opacity'), 'остальные свойства подключены');
  check(/wiggly → Scale: уже есть своё выражение/.test(al[0]), 'предупреждение в отчёте');
}

// ---------- 4. эффектор + новые слои -> добавить, 5. перевесить клон ----------
{
  const a = new Layer('a'), b = new Layer('b'), c = new Layer('c', { threeD: true }), d = new Layer('d');
  const comp = makeComp([a, b, c, d], [a, b]);
  run('4a. создать эффектор на a, b', comp);
  const E1 = effectorsIn(comp)[0];

  comp.selectedLayers = [E1, c];
  const al = run('4b. выделить эффектор + c — добавить', comp);
  check(effectorsIn(comp).length === 1, 'нового эффектора нет');
  check(linkIdx(c) === E1.index, 'c подключён к существующему');
  check(E1.threeDLayer === true, 'эффектор переключён в 3D ради 3D-клона');
  check(/Эффектор: MG Effector\n/.test(al[0]), 'в отчёте без «(новый)»');
  check(/Старых клонов обновлено: 2/.test(al[0]), 'старые клоны a, b переписаны до текущей версии');

  comp.selectedLayers = [d, b];
  run('5a. новый эффектор на d + b (b был клоном первого)', comp);
  const E2 = effectorsIn(comp).find(L => L !== E1);
  check(E2 && E2.name === 'MG Effector 2', 'второй эффектор — MG Effector 2');
  check(linkIdx(b) === E2.index && linkIdx(a) === E1.index, 'b перевешен на второй, a остался у первого');
  check(fxNames(b).join('|') === 'MG Effector|MG Weight', 'у b эффекты не задублировались');

  // Alt: выделен один клон — снимается только он
  comp.selectedLayers = [a];
  run('5b. Alt, выделен клон a', comp, { alt: true });
  check(fxNames(a).length === 0 && !ours(a, 'ADBE Anchor Point') && trExpr(a, 'ADBE Scale') === '', 'a чистый');
  check(!E1.__removed && linkIdx(c) === E1.index, 'эффектор и клон c не тронуты');

  // Alt: выделен эффектор — все его клоны + он сам
  comp.selectedLayers = [E2];
  const al2 = run('5c. Alt, выделен второй эффектор', comp, { alt: true });
  check(E2.__removed === true, 'эффектор удалён');
  check(fxNames(b).length === 0 && fxNames(d).length === 0, 'b и d сняты');
  check(linkIdx(c) === E1.index, 'клон первого эффектора не задет');
  check(/Снято клонов: 2/.test(al2[0]) && /Эффекторов удалено: 1/.test(al2[0]), 'отчёт снятия');
}

// ---------- 6. ошибки выделения ----------
{
  const a = new Layer('a'), b = new Layer('b');
  const comp = makeComp([a, b], [a, b]);
  run('6a. подготовка: два эффектора', comp);
  comp.selectedLayers = [a];
  run('6a. подготовка: второй', comp);
  const effs = effectorsIn(comp);
  comp.selectedLayers = [effs[0], effs[1], a];
  const al = run('6b. два эффектора в выделении', comp);
  check(/несколько эффекторов/.test(al[0]), 'отказ: несколько эффекторов');
  comp.selectedLayers = [effs[0]];
  const al2 = run('6c. только эффектор — режим обновления', comp);
  check(/обновлён/.test(al2[0]) && /Контролов добавлено: 0/.test(al2[0]) && /Клонов переписано: 1 из 1/.test(al2[0]),
    'только эффектор — обновление: контролы на месте, его клон b переписан');
  check(effectorsIn(comp).length === 2, 'новых эффекторов не появилось');
  comp.selectedLayers = [];
  const al3 = run('6d. пустое выделение', comp);
  check(al3.length === 1 && /Выдели слои/.test(al3[0]), 'пустое выделение — alert');
  const cam = new Layer('Camera 1', { kind: 'camera' });
  const comp2 = makeComp([cam], [cam]);
  const al4 = run('6e. выделена только камера', comp2);
  check(/Ни на один/.test(al4[0]) && effectorsIn(comp2).length === 0, 'только камера — отказ, эффектор не создан');
  const x = new Layer('x');
  const comp3 = makeComp([x], [x]);
  const al5 = run('6f. Alt без клонов и эффекторов', comp3, { alt: true });
  check(/снимать нечего/.test(al5[0]), 'Alt по чистому слою — нечего снимать');
}

// ---------- 7. залоченный слой ----------
{
  const a = new Layer('ok'), b = new Layer('locked', { locked: true });
  const comp = makeComp([a, b], [a, b]);
  const al = run('7. один из слоёв залочен', comp);
  check(/Клонов: 1 из 2/.test(al[0]) && /locked: /.test(al[0]), 'залоченный пропущен с предупреждением, без исключения');
}

// ---------- 8. AE без setPropertyParameters ----------
{
  NO_DROPDOWN = true;
  const a = new Layer('a');
  const comp = makeComp([a], [a]);
  const al = run('8. старый AE — меню не настраивается', comp);
  NO_DROPDOWN = false;
  const E = effectorsIn(comp)[0];
  const f = fx(E, 'Falloff shape');
  check(f && f.matchName === 'ADBE Slider Control' && f._items[0].value === 4, 'Falloff shape — слайдер со значением 4 (Linear)');
  const dm = fx(E, 'Delay mode');
  check(dm && dm.matchName === 'ADBE Slider Control' && dm._items[0].value === 1, 'Delay mode — слайдер со значением 1 (Off)');
  check(!E.property('ADBE Effect Parade')._items.some(x => x.matchName === 'ADBE Dropdown Control'), 'пустые dropdown удалены');
  check(/Falloff shape» — слайдер вместо меню: 1 Infinite, 2 Sphere, 3 Box, 4 Linear/.test(al[0]) &&
        /Delay mode» — слайдер вместо меню: 1 Off, 2 Blend, 3 Spring/.test(al[0]), 'предупреждения с легендой для обоих меню');
}

// ---------- 9. эффектор старой версии (до Delay) ----------
{
  const OLD = '// @mograph — вес клона, 0–100 (старая версия)\nw * 100';
  const makeOld = (E, clones) => {
    const g = E.property('ADBE Effect Parade');
    g._items = g._items.filter(f => !/^(Delay|Spring|Falloff ease)/.test(f.name));   // до Delay и изингов
    clones.forEach(L => { fx(L, 'MG Weight')._items[0]._expr = OLD; });
  };
  const a = new Layer('a'), b = new Layer('b'), c = new Layer('c');
  const comp = makeComp([a, b, c], [a, b]);
  run('9a. эффектор на a, b', comp);
  const E = effectorsIn(comp)[0];
  makeOld(E, [a, b]);

  comp.selectedLayers = [E];
  const al = run('9b. выделен только старый эффектор — обновить', comp);
  check(fxNames(E).slice(-4).join('|') === 'Falloff ease|Delay mode|Delay (frames)|Spring bounce %', 'контролы ease и Delay добиты в конец');
  check(fx(E, 'Falloff ease')._items[0].value === 2, 'старому эффектору Falloff ease досыпан как Smooth — вид сцены не меняется');
  check([a, b].every(L => fx(L, 'MG Weight')._items[0]._expr.indexOf('delayed(rawAt)') !== -1), 'выражения веса переписаны');
  check([a, b].every(L => trExpr(L, 'ADBE Scale').indexOf('delayed(') !== -1), 'трансформы клонов — с Delay');
  check(/Контролов добавлено: 4/.test(al[0]) && /Клонов переписано: 2 из 2/.test(al[0]), 'отчёт обновления');

  const al2 = run('9c. повторное обновление', comp);
  check(/Контролов добавлено: 0/.test(al2[0]) && fxNames(E).length === 17, 'повтор ничего не дублирует');

  makeOld(E, [a, b]);
  comp.selectedLayers = [E, c];
  const al3 = run('9d. старый эффектор + новый слой c', comp);
  check(fxNames(E).length === 17 && linkIdx(c) === E.index, 'контролы добиты, c подключён');
  check(fx(a, 'MG Weight')._items[0]._expr !== OLD && /Старых клонов обновлено: 2/.test(al3[0]), 'старые клоны переписаны заодно');
}

// ---------- синтаксис всех выражений ----------
console.log('\n=== синтаксис сгенерированных выражений ===');
const texts = Object.keys(EXPRS);
texts.forEach(t => {
  let ok = true;
  try { new vm.Script(t); } catch (e) { ok = false; console.log('  СИНТАКСИС: ' + e.message + '\n' + t); }
  if (!ok) fails++; else passes++;
});
console.log('  уникальных выражений: ' + texts.length + ', все проверены new vm.Script');
if (DUMP) texts.forEach(t => console.log('\n--- ' + EXPRS[t][0] + ' (x' + EXPRS[t].length + ')\n' + t));

// ================= Часть 2: математика =================
console.log('\n=== математика выражений (2D-модель трансформа AE, со временем) ===');

const find = frag => texts.find(t => t.indexOf(frag) !== -1);
const X_WEIGHT = find('вес клона');
const X_ANCHOR = find('через Anchor Point');
const X_SCALE  = find('@mograph — Scale');
const X_ROTZ   = find('@mograph — Rotation Z');
const X_OPAC   = find('@mograph — Opacity');
const X_CENTER = texts.find(t => t.indexOf('var ids = [') === 0);

const FD = 1 / 30;
// Время текущего вычисления. valueAtTime у свойства с выражением в AE пересчитывает это
// выражение в момент t — здесь так же: вложенный evalAt подменяет NOW и возвращает обратно.
let NOW = 0;
const compiled = {};

function makeCtx(ctx) {
  return vm.createContext(Object.assign({
    Math,
    time: 0,
    thisComp: { frameDuration: FD },
    clamp: (v, a, b) => Math.min(Math.max(v, a), b),
    degreesToRadians: d => d * Math.PI / 180,
    mul: (a, k) => a.map(x => x * k)
  }, ctx));
}

function evalAt(text, sb, t) {
  const script = compiled[text] || (compiled[text] = new vm.Script(text));
  const prev = NOW;
  NOW = t || 0;
  sb.time = NOW;
  if (sb.__own) sb.value = sb.__own(NOW);
  try { return script.runInContext(sb); } finally { NOW = prev; }
}

// 2D-слой AE: world = Parent·(pos + R(rot)·S·(pt − anchor)), Y вниз, rot по часовой.
// posAt(t) — анимированная Position (в системе родителя).
class L2 {
  constructor(o) {
    Object.assign(this, { pos: [0, 0], anchor: [0, 0], rot: 0, scale: [100, 100], parent: null, posAt: null }, o);
  }
  posAtT(t) { return this.posAt ? this.posAt(t) : this.pos; }
  _cs() { const a = this.rot * Math.PI / 180; return [Math.cos(a), Math.sin(a)]; }
  _fwd(v) { const [c, s] = this._cs(); const x = v[0] * this.scale[0] / 100, y = v[1] * this.scale[1] / 100; return [c * x - s * y, s * x + c * y]; }
  _inv(v) { const [c, s] = this._cs(); const x = c * v[0] + s * v[1], y = -s * v[0] + c * v[1]; return [x / (this.scale[0] / 100), y / (this.scale[1] / 100)]; }
  toWorldA(pt, anchor, t) {
    if (t === undefined) t = NOW;
    const P = this.posAtT(t);
    const r = this._fwd([pt[0] - anchor[0], pt[1] - anchor[1]]);
    const q = [P[0] + r[0], P[1] + r[1], 0];
    return this.parent ? this.parent.toWorld(q, t) : q;
  }
  toWorld(pt, t) { return this.toWorldA(pt, this.anchor, t); }
  fromWorld(W, t) {
    if (t === undefined) t = NOW;
    const q = this.parent ? this.parent.fromWorld(W, t) : W;
    const P = this.posAtT(t);
    const r = this._inv([q[0] - P[0], q[1] - P[1]]);
    return [r[0] + this.anchor[0], r[1] + this.anchor[1], 0];
  }
  fromWorldVec(v) { const q = this.parent ? this.parent.fromWorldVec(v) : v; const r = this._inv(q); return [r[0], r[1], 0]; }
}

// Эффектор: 2D-слой с контролами. Значение контрола — число или функция времени.
// Нет такого контрола — бросает, как AE (так моделируется эффектор старой версии).
function effector(o, params) {
  const E = new L2(o);
  const P = Object.assign({
    'Strength': 100, 'Position X': 0, 'Position Y': 0, 'Position Z': 0, 'Scale %': 100,
    'Rotation X': 0, 'Rotation Y': 0, 'Rotation Z': 0, 'Opacity %': 100,
    'Falloff shape': 2, 'Falloff size': 200, 'Falloff %': 100, 'Falloff ease': 2, 'Invert': 0,
    'Delay mode': 1, 'Delay (frames)': 6, 'Spring bounce %': 50
  }, params);
  const val = (n, t) => (typeof P[n] === 'function' ? P[n](t) : P[n]);
  E.effect = n => {
    if (!(n in P)) throw new Error('effect not found: ' + n);
    return () => ({ get value() { return val(n, NOW); }, valueAtTime: t => val(n, t) });
  };
  E.transform = { position: { get value() { return E.posAtT(NOW).slice(0, 2); } } };   // 2D-эффектор
  E._P = P;
  return E;
}

let WEIGHT_EVALS = 0;   // сколько раз за прогон считалось выражение веса — сторож скорости

function weightCtx(C, E) {
  return makeCtx({
    effect: n => () => { if (n === 'MG Effector') return E; throw new Error('no effect ' + n); },
    transform: { position: { get value() { return C.posAtT(NOW); }, valueAtTime: t => C.posAtT(t) } },
    hasParent: !!C.parent,
    parent: C.parent
  });
}

// Контекст трансформ-свойства клона.
//   own(t)    — собственное значение свойства до выражения (ключи); keys — есть ли у него ключи
//   weight(t) — подменить вес константой/функцией; по умолчанию — честное выражение веса
// valueAtTime у MG Weight бросает: вызывать его из трансформов в цикле — ровно то, что
// клало AE в первой версии Delay (пересчёт чужого выражения на каждом шаге истории).
function propCtx(C, E, opts) {
  const wsb = weightCtx(C, E);
  const weightAt = opts.weight || (t => { WEIGHT_EVALS++; return evalAt(X_WEIGHT, wsb, t); });
  return makeCtx({
    __own: opts.own,
    thisProperty: { valueAtTime: t => opts.own(t), numKeys: opts.keys ? 2 : 0 },
    effect: n => () => {
      if (n === 'MG Effector') return E;
      if (n === 'MG Weight') return {
        get value() { return weightAt(NOW); },
        valueAtTime: () => { throw new Error('MG Weight.valueAtTime из трансформа — медленный путь'); }
      };
      throw new Error('no effect ' + n);
    },
    transform: {
      position: { valueAtTime: t => C.posAtT(t), numKeys: C.posAt ? 2 : 0 },
      scale: { get value() { return C.scale; } },
      rotation: { get value() { return C.rot; } }
    },
    hasParent: !!C.parent,
    parent: C.parent,
    fromWorldVec: opts.fromWorldVec || (v => C.fromWorldVec(v))
  });
}

const weightOf = (C, E, t) => evalAt(X_WEIGHT, weightCtx(C, E), t);
const near = (a, b, eps) => Math.abs(a - b) < (eps || 1e-6);
const at = (x, y) => new L2({ pos: [x, y] });
const step = (t0, a, b) => t => (t >= t0 - 1e-9 ? b : a);   // ступенька в момент t0
const FAR = () => effector({ pos: [5000, 5000] }, {});        // вес 0: клон далеко вне falloff'а
const A6 = Math.exp(-1 / 6);                                 // Blend, Delay 6 кадров: остаток за кадр

// --- веса (мгновенные) ---
{
  // Sphere R=200, falloff 50%: полная сила до 100, ноль после 200, между — smoothstep
  const E = effector({ pos: [500, 500] }, { 'Falloff %': 50 });
  check(near(weightOf(at(550, 500), E), 100), 'Sphere: внутри внутреннего радиуса — 100');
  check(near(weightOf(at(650, 500), E), 50), 'Sphere: середина рампы — 50');
  check(near(weightOf(at(800, 500), E), 0), 'Sphere: снаружи — 0');
  check(near(weightOf(at(606.066, 606.066), E), 50, 1e-3), 'Sphere: по диагонали, d=150 — 50');

  const Ebox = effector({ pos: [500, 500] }, { 'Falloff shape': 3, 'Falloff %': 50 });
  check(near(weightOf(at(640, 650), Ebox), 50), 'Box: d = max(|x|,|y|) = 150 — 50');
  check(near(weightOf(at(590, 590), Ebox), 100), 'Box: угол внутреннего квадрата — 100');

  // Linear R=200, f=100 -> рампа x ∈ [-100, 100]; x=50: t=0.75 -> 1 - 0.84375
  const Elin = effector({ pos: [500, 500] }, { 'Falloff shape': 4 });
  check(near(weightOf(at(550, 900), Elin), 15.625), 'Linear: x=50 — 15.625, y не влияет');
  check(near(weightOf(at(300, 500), Elin), 100), 'Linear: сзади — 100');
  const ElinRot = effector({ pos: [500, 500], rot: 90 }, { 'Falloff shape': 4 });
  check(near(weightOf(at(500, 550), ElinRot), 15.625), 'Linear: эффектор повёрнут на 90° — ось X смотрит вниз');

  check(near(weightOf(at(9999, 9999), effector({ pos: [0, 0] }, { 'Falloff shape': 1 })), 100), 'Infinite — 100 везде');
  check(near(weightOf(at(650, 500), effector({ pos: [500, 500] }, { 'Falloff %': 50, 'Invert': 1 })), 50), 'Invert на середине — 50');
  check(near(weightOf(at(550, 500), effector({ pos: [500, 500] }, { 'Invert': 1 })), 100 - weightOf(at(550, 500), effector({ pos: [500, 500] }, {}))), 'Invert = 100 − вес');
  check(near(weightOf(at(550, 500), effector({ pos: [500, 500] }, { 'Falloff %': 50, 'Strength': 40 })), 40), 'Strength 40% масштабирует вес');
  check(near(weightOf(at(650, 500), effector({ pos: [500, 500], scale: [200, 200] }, { 'Falloff %': 50 })), 100), 'Scale эффектора 200% удваивает falloff');
  check(near(weightOf(at(701, 500), effector({ pos: [500, 500] }, { 'Falloff %': 0 })), 0) &&
        near(weightOf(at(700, 500), effector({ pos: [500, 500] }, { 'Falloff %': 0 })), 100), 'Falloff 0% — жёсткая граница (d = R ещё внутри), без деления на ноль');

  // клон с родителем: точка покоя = parent.toWorld(position)
  const P = new L2({ pos: [100, 100], rot: 30, scale: [150, 150] });
  const q = P.fromWorld([650, 500]);
  const Cp = new L2({ pos: [q[0], q[1]], parent: P });
  check(near(weightOf(Cp, E), 50), 'клон под повёрнутым/масштабированным родителем — тот же вес 50');

  // эффектор не отвечает — вес 0, без исключения
  check(weightOf(at(0, 0), null) === 0, 'эффектор не задан (Layer Control = None) — 0');
}

// --- Falloff ease: 8 кривых рампы ---
// Sphere R=200, falloff 100%: рампа от центра до 200. u — путь по рампе от внешней границы
// внутрь, клон на расстоянии d = 200·(1 − u). Вес = ease(u)·100.
{
  const NAMES = ['Linear', 'Smooth', 'Steep', 'Hard', 'Soft (edge)', 'Steep (edge)', 'Soft (core)', 'Steep (core)'];
  const wAt = (e, u) => weightOf(at(500 + 200 * (1 - u), 500), effector({ pos: [500, 500] }, { 'Falloff ease': e })) / 100;
  const us = []; for (let i = 0; i <= 40; i++) us.push(i / 40);

  NAMES.forEach((nm, i) => {
    const e = i + 1, ws = us.map(u => wAt(e, u));
    let mono = true;
    for (let j = 1; j < ws.length; j++) if (ws[j] < ws[j - 1] - 1e-12) mono = false;
    check(near(ws[0], 0) && near(ws[ws.length - 1], 1) && mono, nm + ': 0 на внешней границе, 1 на внутренней, монотонно');
  });
  check(us.every(u => near(wAt(1, u), u)), 'Linear — прямая');
  check(us.every(u => near(wAt(2, u), u * u * (3 - 2 * u))), 'Smooth — smoothstep, как до изингов');
  const oldE = effector({ pos: [500, 500] }, {});
  delete oldE._P['Falloff ease'];
  check(near(weightOf(at(600, 500), oldE), weightOf(at(600, 500), effector({ pos: [500, 500] }, {}))),
    'эффектор старой версии без Falloff ease — Smooth, а не 0');

  // крутизна: в центре рампы наклон = s, на её концах 1/s; порядок Linear < Smooth < Steep < Hard
  // шаг мелкий: в точке перегиба вторая производная меняет знак скачком, центральная
  // разность ошибается на h·|Δf''|/4 (у Hard при h = 1e-4 это 0.04)
  const slope = (e, u) => (wAt(e, u + 1e-6) - wAt(e, u - 1e-6)) / 2e-6;
  check(near(slope(3, 0.5), 5, 1e-3) && near(slope(4, 0.5), 14, 1e-2), 'Steep и Hard: наклон в середине 5 и 14');
  check(near(slope(3, 0.02), 1 / 5, 0.05), 'Steep: у внешней границы пологая (наклон → 1/5)');
  check(wAt(1, 0.4) > wAt(2, 0.4) && wAt(2, 0.4) > wAt(3, 0.4) && wAt(3, 0.4) > wAt(4, 0.4) && wAt(4, 0.35) < 0.1 && wAt(4, 0.65) > 0.9,
    'по крутизне: Linear, Smooth, Steep, Hard; Hard — почти ступенька посередине');

  // сдвиг: edge — крутой участок у внешней границы (к середине рампы вес уже набран), core — у центра
  check(wAt(5, 0.5) > 0.6 && wAt(6, 0.5) > 0.8 && wAt(7, 0.5) < 0.4 && wAt(8, 0.5) < 0.2, 'edge к середине рампы уже набрал вес, core ещё нет');
  check(near(slope(6, 0.25), 6, 1e-2) && near(slope(8, 0.75), 6, 1e-2) && near(wAt(6, 0.25), 0.25) && near(wAt(8, 0.75), 0.75),
    'Steep (edge) / (core): перегиб в u = 0.25 / 0.75, наклон там 6');
  check(near(wAt(5, 0.3) + wAt(7, 0.7), 1, 1e-9), 'edge и core — зеркальные');

  // Linear-форма falloff'а тоже с изингом; Invert — после изинга
  const lin = e => weightOf(at(550, 900), effector({ pos: [500, 500] }, { 'Falloff shape': 4, 'Falloff ease': e })) / 100;
  check(near(lin(1), 0.25) && lin(4) < 0.05, 'Linear-форма: x=50 при рампе ±100 — Linear 0.25, Hard почти 0');
  check(near(weightOf(at(600, 500), effector({ pos: [500, 500] }, { 'Falloff ease': 6, 'Invert': 1 })) / 100, 1 - wAt(6, 0.5)),
    'Invert — поверх изинга');
}

// --- сдвиг через Anchor Point (Delay Off): контент уезжает ровно на d·w в мире ---
{
  const P = new L2({ pos: [300, 200], rot: 30, scale: [150, 90] });
  const q = P.fromWorld([650, 500]);
  const cases = [
    ['без родителя, поворот 40°, неравномерный масштаб', new L2({ pos: [650, 500], anchor: [25, 40], rot: 40, scale: [80, 120] })],
    ['под родителем (поворот 30°, масштаб 150×90)',      new L2({ pos: [q[0], q[1]], anchor: [25, 40], rot: -65, scale: [70, 110], parent: P })],
    ['флип клона (scale X −100)',                        new L2({ pos: [650, 500], anchor: [10, -5], rot: 15, scale: [-100, 100] })]
  ];
  const E = effector({ pos: [500, 500] }, { 'Falloff %': 50, 'Position X': 100, 'Position Y': -60 });
  cases.forEach(([label, C]) => {
    const w = weightOf(C, E);
    const a2 = evalAt(X_ANCHOR, propCtx(C, E, { own: () => C.anchor.slice() }), 0);
    let ok = true;
    [C.anchor, [0, 0], [200, -50]].forEach(pt => {
      const rest = C.toWorld(pt, 0), moved = C.toWorldA(pt, a2, 0);
      if (!near(moved[0] - rest[0], 100 * w / 100) || !near(moved[1] - rest[1], -60 * w / 100)) ok = false;
    });
    check(ok && w > 0, 'Anchor: ' + label + ' — сдвиг ровно [100, −60]·' + (w / 100).toFixed(2));
  });
  const C0 = new L2({ pos: [650, 500], anchor: [25, 40], scale: [0, 100] });
  check(JSON.stringify(evalAt(X_ANCHOR, propCtx(C0, E, { own: () => [25, 40] }), 0)) === '[25,40]', 'Anchor: нулевой масштаб — без сдвига, без NaN');
  const C1 = new L2({ pos: [650, 500], anchor: [25, 40] });
  check(JSON.stringify(evalAt(X_ANCHOR, propCtx(C1, FAR(), { own: () => [25, 40] }), 0)) === '[25,40]', 'Anchor: вес 0 — value как есть');
  // 3D-ветка: только форма (fromWorldVec в стабе — половинка вектора); Infinite -> вес 100
  const E3 = effector({}, { 'Falloff shape': 1, 'Position X': 100, 'Position Y': -60, 'Position Z': 40 });
  const r3 = evalAt(X_ANCHOR, propCtx(C1, E3, { own: () => [25, 40, 0], fromWorldVec: v => v.map(x => x / 2) }), 0);
  check(JSON.stringify(r3) === '[-25,70,-20]', 'Anchor 3D-ветка: value − fromWorldVec(d)');
}

// --- Scale / Rotation / Opacity (Delay Off) ---
{
  const E = effector({}, { 'Scale %': 0, 'Rotation Z': 90, 'Opacity %': 0 });
  const C = at(0, 0), w50 = { weight: () => 50 };
  check(JSON.stringify(evalAt(X_SCALE, propCtx(C, E, Object.assign({ own: () => [100, 80] }, w50)), 0)) === '[50,40]', 'Scale: 0% при весе 50 — половина');
  check(evalAt(X_ROTZ, propCtx(C, E, Object.assign({ own: () => 10 }, w50)), 0) === 55, 'Rotation Z: +90° при весе 50 — +45');
  check(evalAt(X_OPAC, propCtx(C, E, Object.assign({ own: () => 80 }, w50)), 0) === 40, 'Opacity: 0% при весе 50 — половина');
  check(evalAt(X_SCALE, propCtx(C, E, { own: () => [100, 80], weight: () => 0 }), 0).join() === '100,80', 'Scale: вес 0 — не тронут');
  const own = step(1, [100, 100], [200, 200]);
  check(evalAt(X_SCALE, propCtx(C, FAR(), { own, keys: true }), 1)[0] === 200, 'Delay Off: собственный ключ клона — мгновенно');
}

// --- Delay / Spring: всё движение клона, falloff не влияет ---
{
  const C = at(0, 0);
  const blend = effector({ pos: [5000, 5000] }, { 'Delay mode': 2 });   // клон вне falloff'а, вес 0

  // Blend: собственный ключ Scale 100 -> 200 в t=1. Через k кадров: 100 + 100·(1 − a^(k+1))
  const ownS = step(1, [100, 100], [200, 200]);
  const sAt = t => evalAt(X_SCALE, propCtx(C, blend, { own: ownS, keys: true }), t);
  check(near(sAt(0.9)[0], 100), 'Blend: до ключа — 100');
  check(near(sAt(1)[0], 100 + 100 * (1 - A6)), 'Blend: кадр ключа — первая доля экспоненты');
  check(near(sAt(1 + 5 * FD)[0], 100 + 100 * (1 - Math.pow(A6, 6))), 'Blend: через Delay кадров — 63% пути');
  check(near(sAt(3)[0], 200), 'Blend: хвост вне окна — ровно 200');
  check(near(weightOf(C, blend, 1), 0), 'при этом вес клона 0: Delay работает вне falloff\'а');

  // Spring на собственной Rotation 0 -> 90 в t=1
  const ownR = step(1, 0, 90);
  const series = (E, k0, k1) => {
    const out = [];
    for (let k = k0; k <= k1; k++) out.push(evalAt(X_ROTZ, propCtx(C, E, { own: ownR, keys: true, weight: () => 0 }), 1 + k * FD));
    return out;
  };
  const s50 = series(effector({}, { 'Delay mode': 3, 'Spring bounce %': 50 }), 0, 120);
  const max50 = Math.max(...s50);
  check(max50 > 95 && max50 < 100, 'Spring bounce 50%: перелёт ~9% (' + max50.toFixed(2) + ')');
  check(near(s50[s50.length - 1], 90, 0.01), 'Spring bounce 50%: успокоился на 90');
  const s0 = series(effector({}, { 'Delay mode': 3, 'Spring bounce %': 0 }), 0, 120);
  check(Math.max(...s0) <= 90 * 1.005, 'Spring bounce 0%: без перелёта (' + Math.max(...s0).toFixed(3) + ')');

  // bounce 100% (ζ = 0.2): окно 150 кадров. Ступенька уходит за край окна на k = 150 —
  // скачок между кадрами должен быть в пределах остаточного звона (< 1%)
  const s100 = series(effector({}, { 'Delay mode': 3, 'Spring bounce %': 100 }), 146, 152);
  let jump = 0;
  for (let i = 1; i < s100.length; i++) jump = Math.max(jump, Math.abs(s100[i] - s100[i - 1]));
  check(jump < 0.9, 'Spring bounce 100%: на краю окна истории нет скачка (' + jump.toFixed(3) + '°)');

  // Position: собственный ключ 0 -> 100 по X в t=1, Blend. Контент в мире = цель после Delay
  const Cm = new L2({ posAt: step(1, [0, 0], [100, 0]) });
  const contentX = (C2, E, t) => {
    const a2 = evalAt(X_ANCHOR, propCtx(C2, E, { own: () => C2.anchor.slice() }), t);
    return C2.toWorldA(C2.anchor, a2, t);
  };
  check(near(contentX(Cm, blend, 1)[0], 100 * (1 - A6)), 'Position: собственный ключ — отстаёт через Anchor');
  check(near(contentX(Cm, blend, 1 + 5 * FD)[0], 100 * (1 - Math.pow(A6, 6))), 'Position: через 6 кадров — 63%');

  // движение родителя: P прыгает на +100 по X, повёрнут на 30°; клон неподвижен в системе P
  const P = new L2({ posAt: step(1, [200, 0], [300, 0]), rot: 30 });
  const Cc = new L2({ pos: [50, 0], parent: P });
  const w0 = P.toWorld([50, 0], 0), w1 = P.toWorld([50, 0], 2);
  const got = contentX(Cc, blend, 1 + 5 * FD);
  const k6 = 1 - Math.pow(A6, 6);
  check(near(got[0], w0[0] + (w1[0] - w0[0]) * k6) && near(got[1], w0[1] + (w1[1] - w0[1]) * k6),
    'Position: движение родителя тоже отстаёт');

  // реакция на эффектор: эффектор прыгает на клон в t=1, Position Y −100, честный вес во времени
  const Ejump = effector({ posAt: step(1, [5000, 5000], [0, 0]) }, { 'Delay mode': 2, 'Position Y': -100 });
  check(near(contentX(at(0, 0), Ejump, 1 + 5 * FD)[1], -100 * k6), 'реакция на эффектор (вес в прошлом через valueAtTime) — отстаёт');

  // анимированный Strength пружинит: Infinite, Scale % 50, Strength 0 -> 100
  const Estr = effector({}, { 'Falloff shape': 1, 'Scale %': 50, 'Strength': step(1, 0, 100), 'Delay mode': 3 });
  let mn = 1e9;
  for (let k = 0; k <= 60; k++) mn = Math.min(mn, evalAt(X_SCALE, propCtx(C, Estr, { own: () => [100, 100] }), 1 + k * FD)[0]);
  check(mn < 50 && mn > 40, 'анимация Strength пружинит: Scale проваливается ниже 50 (' + mn.toFixed(2) + ')');

  // сам MG Weight — уже с задержкой
  check(near(weightOf(at(0, 0), Ejump, 1 + 5 * FD), 100 * k6), 'MG Weight уже с задержкой: Blend, 63% через 6 кадров');

  // сторож скорости: трансформ берёт вес один раз за кадр, а не на каждом шаге истории
  WEIGHT_EVALS = 0;
  evalAt(X_SCALE, propCtx(C, Estr, { own: ownS, keys: true }), 1.5);
  check(WEIGHT_EVALS === 1, 'Scale со Spring и своими ключами: вес считается 1 раз за кадр (' + WEIGHT_EVALS + ')');
  WEIGHT_EVALS = 0;
  contentX(new L2({ posAt: step(1, [0, 0], [100, 0]) }), Ejump, 1.5);
  check(WEIGHT_EVALS === 1, 'Anchor с Delay и своими ключами Position: вес 1 раз за кадр (' + WEIGHT_EVALS + ')');

  // эффектор старой версии: контролов Delay нет — без задержки и без ошибки
  const Eold = effector({ pos: [5000, 5000] }, {});
  delete Eold._P['Delay mode']; delete Eold._P['Delay (frames)']; delete Eold._P['Spring bounce %'];
  check(near(evalAt(X_SCALE, propCtx(C, Eold, { own: ownS, keys: true }), 1)[0], 200), 'старый эффектор без Delay — мгновенно');

  // Delay (frames) = 0 — тоже мгновенно
  const E0 = effector({ pos: [5000, 5000] }, { 'Delay mode': 3, 'Delay (frames)': 0 });
  check(near(evalAt(X_SCALE, propCtx(C, E0, { own: ownS, keys: true }), 1)[0], 200), 'Delay 0 кадров — мгновенно');
}

// --- центроид для постановки эффектора ---
{
  const text = X_CENTER.replace(/var ids = \[[^\]]*\]/, 'var ids = [1, 2]');
  const P = new L2({ pos: [1000, 0], rot: 90 });
  const layers = [
    { transform: { position: { value: [100, 100] } }, hasParent: false },
    { transform: { position: { value: [300, 0] } }, hasParent: true, parent: P }   // мир: [1000, 300]
  ];
  const r = evalAt(text, makeCtx({ thisComp: { layer: i => layers[i - 1] } }), 0);
  check(near(r[0], 550) && near(r[1], 200), 'центроид в мировых координатах, с учётом родителя');
}

console.log('\n' + (fails ? 'ПРОВАЛОВ: ' + fails : 'всё зелёное') + ' (проверок: ' + (passes + fails) + ')');
process.exitCode = fails ? 1 : 0;
