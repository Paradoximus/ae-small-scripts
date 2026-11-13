// Мини-стаб AE DOM: прогоняем Delay_children_trail.jsx и вылавливаем
// сгенерированные выражения, чтобы проверить их синтаксис отдельно.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'Delay_children_trail.jsx');
const TR = 'ADBE Transform Group', FXP = 'ADBE Effect Parade';

const captured = {};   // label -> expression text

function Prop(name, opts) {
  opts = opts || {};
  this.name = name;
  this.numKeys = opts.numKeys || 0;
  this.expressionEnabled = false;
  this.canSetExpression = true;
  this.dimensionsSeparated = false;
  this._expr = '';
  this._owner = opts.owner || '?';
  Object.defineProperty(this, 'expression', {
    get() { return this._expr; },
    set(v) { this._expr = v; captured[this._owner + ' :: ' + this.name] = v; }
  });
  this.setValue = () => {};
  this.property = () => new Prop('Slider', { owner: this._owner });
}

function makeTransform(owner, animMap, is3D) {
  const mns = ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Rotate Z'];
  if (is3D) mns.push('ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Orientation');
  const props = {};
  mns.forEach(mn => { props[mn] = new Prop(mn, { owner, numKeys: animMap[mn] ? 2 : 0 }); });
  return { property: mn => props[mn] || null };
}

function makeFxParade(owner) {
  const list = [];
  return {
    get numProperties() { return list.length; },
    property: i => list[i - 1],
    addProperty: () => { const f = new Prop('fx', { owner }); list.push(f); return f; }
  };
}

function Layer(name, index, animMap, is3D, canFx) {
  this.name = name; this.index = index; this.parent = null;
  const tg = makeTransform(name, animMap || {}, !!is3D);
  const fx = canFx === false ? null : makeFxParade(name);
  this.property = mn => (mn === TR ? tg : mn === FXP ? fx : null);
}

function CompItem() {}

// сцена: анимированный 3D-нуль + трое детей
const nul = new Layer('NULL 1', 1,
  { 'ADBE Position': 1, 'ADBE Scale': 1, 'ADBE Rotate Z': 1, 'ADBE Rotate X': 1, 'ADBE Rotate Y': 1, 'ADBE Orientation': 1 },
  true);
const kids = [new Layer('kid A', 2, {}, true), new Layer('kid B', 3, {}, false), new Layer('kid C', 4, {}, false)];
kids.forEach(k => { k.parent = nul; });
const layers = [nul].concat(kids);

const comp = new CompItem();
comp.numLayers = layers.length;
comp.frameDuration = 1 / 25;
comp.layer = i => layers[i - 1];
comp.selectedLayers = [nul];

const alerts = [];
const sandbox = {
  CompItem,
  app: {
    project: { activeItem: comp },
    beginUndoGroup: () => {}, endUndoGroup: () => {}
  },
  alert: m => alerts.push(m),
  confirm: () => true,
  ScriptUI: undefined,
  console
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'Delay_children_trail.jsx' });

console.log('--- ALERTS ---');
alerts.forEach(a => console.log(a));

console.log('\n--- CAPTURED EXPRESSIONS: ' + Object.keys(captured).length + ' ---');
const seen = {};
let bad = 0;
for (const key of Object.keys(captured)) {
  const txt = captured[key];
  if (seen[txt]) continue;
  seen[txt] = true;
  const tmp = path.join(__dirname, 'expr_' + Object.keys(seen).length + '.js');
  // выражение AE = тело функции, поэтому оборачиваем
  fs.writeFileSync(tmp, '(function(value, time, thisLayer, thisComp, effect, add, sub){\n' + txt + '\n})');
  try {
    new vm.Script(fs.readFileSync(tmp, 'utf8'), { filename: tmp });
    console.log('OK   ' + key.split(' :: ')[1]);
  } catch (e) { bad++; console.log('FAIL ' + key + ' → ' + e.message); }
  console.log('----------------------------------------');
  console.log(txt);
  console.log('----------------------------------------');
}
console.log(bad === 0 ? '\nALL EXPRESSIONS PARSE OK' : '\n' + bad + ' BROKEN');
