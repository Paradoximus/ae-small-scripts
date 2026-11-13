// Round-trip: apply -> apply#2 -> remove на одних и тех же стаб-слоях.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SRC = path.join(__dirname, '..', 'Delay_children_trail.jsx');
const TR = 'ADBE Transform Group', FXP = 'ADBE Effect Parade';

function Prop(name, numKeys) {
  this.name = name;
  this.numKeys = numKeys || 0;
  this.expressionEnabled = false;
  this.canSetExpression = true;
  this.dimensionsSeparated = false;
  this.expression = '';
  this.setValue = () => {};
  this.property = () => new Prop('Slider', 0);
}

function makeTransform(animMap, is3D) {
  const mns = ['ADBE Anchor Point', 'ADBE Position', 'ADBE Scale', 'ADBE Rotate Z'];
  if (is3D) mns.push('ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Orientation');
  const props = {};
  mns.forEach(mn => { props[mn] = new Prop(mn, animMap[mn] ? 2 : 0); });
  return { property: mn => props[mn] || null };
}

function makeFxParade() {
  const list = [];
  return {
    get numProperties() { return list.length; },
    property: i => list[i - 1],
    addProperty: () => {
      const f = new Prop('fx', 0);
      f.remove = () => { const i = list.indexOf(f); if (i >= 0) list.splice(i, 1); };
      list.push(f);
      return f;
    }
  };
}

function Layer(name, index, animMap, is3D) {
  this.name = name; this.index = index; this.parent = null;
  const tg = makeTransform(animMap || {}, !!is3D);
  const fx = makeFxParade();
  this.property = mn => (mn === TR ? tg : mn === FXP ? fx : null);
}

function CompItem() {}

const nul = new Layer('NULL 1', 1, { 'ADBE Position': 1, 'ADBE Scale': 1, 'ADBE Rotate Z': 1 }, false);
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
  app: { project: { activeItem: comp }, beginUndoGroup: () => {}, endUndoGroup: () => {} },
  alert: m => alerts.push(m),
  confirm: () => true,
  ScriptUI: { environment: { keyboardState: { altKey: false } } },
  console
};
vm.createContext(sandbox);

function state() {
  let exprs = 0, sliders = 0;
  const where = [];
  for (const L of layers) {
    const tg = L.property(TR);
    for (const mn of ['ADBE Position', 'ADBE Scale', 'ADBE Rotate Z', 'ADBE Rotate X', 'ADBE Rotate Y', 'ADBE Orientation']) {
      const p = tg.property(mn);
      if (p && p.expression && p.expression.indexOf('@delay-parent') !== -1) { exprs++; where.push(L.name + '/' + mn); }
    }
    sliders += L.property(FXP).numProperties;
  }
  return { exprs, sliders, where: where.join(', ') };
}

const TXT = fs.readFileSync(SRC, 'utf8');
const flat = a => a.join(' | ').replace(/\n/g, ' ').slice(0, 95);

vm.runInContext(TXT, sandbox, { filename: 'apply' });
console.log('APPLY  :', flat(alerts));
console.log('  ->', JSON.stringify(state()));

alerts.length = 0;
vm.runInContext(TXT, sandbox, { filename: 'apply-again' });
console.log('APPLY#2:', flat(alerts));
console.log('  ->', JSON.stringify(state()));

alerts.length = 0;
sandbox.ScriptUI.environment.keyboardState.altKey = true;
vm.runInContext(TXT, sandbox, { filename: 'remove' });
console.log('REMOVE :', flat(alerts));
console.log('  ->', JSON.stringify(state()));
