/* @ae-script
name:  🧲 MoGraph effector
desc:  Как Plain Effector в C4D. Выделенные слои становятся клонами, над ними создаётся эффектор — гайд-шейп с гизмо falloff'а и параметрами Position X/Y/Z, Scale %, Rotation X/Y/Z, Opacity %, falloff'ом Sphere / Box / Linear / Infinite с изингом рампы (Linear, Smooth и S-кривые разной крутизны со сдвигом к краю или к центру) и Delay (Off / Blend / Spring) — отставание и пружина всего движения клонов: своих ключей, движения родителя и реакции на эффектор; задержка одинаковая для всех клонов, falloff на неё не влияет. Каждый клон получает вес «MG Weight» (0–100), считаемый от своей точки покоя; сдвиг идёт через Anchor Point, так что Position и ключи клона не трогаются. Эффектор + слои в выделении — добавить слои к нему. Только эффектор — обновить до текущей версии (новые контролы, выражения клонов). Alt+клик — снять клоны из выделения; если в выделении эффектор — снять всех его клонов и удалить его.
prep:  |
  - Открыть композицию
  - Создать: выделить слои-клоны
  - Добавить к готовому: выделить эффектор + новые слои
  - Обновить старый эффектор: выделить только его
  - Alt+клик: выделить клоны и/или эффектор — снять
tags:  mograph, effector, falloff, delay, spring, expression, clones, 3d
*/

(function () {

    // ===== конфиг =====
    var MARK      = "@mograph";             // метка наших выражений, первой строкой
    var MARK_EFF  = "@mograph-effector";    // метка слоя-эффектора, в его Comment
    var FX_LINK   = "MG Effector";          // Layer Control на клоне -> его эффектор
    var FX_WEIGHT = "MG Weight";            // слайдер на клоне: вес 0–100
    var BASE_NAME = "MG Effector";
    var SHAPES    = ["Infinite", "Sphere", "Box", "Linear"];   // в выражениях это 1..4
    var DELAYS    = ["Off", "Blend", "Spring"];                // в выражениях это 1..3
    // Изинг рампы falloff'а (1..8): s — крутизна S-кривой, k — где её крутой участок.
    // edge — ближе к внешней границе (вес 0), core — к внутренней (вес 1). s = 0 — smoothstep.
    var EASES = [
        { nm: "Linear",       s: 1,   k: 0.5 },
        { nm: "Smooth",       s: 0,   k: 0.5 },
        { nm: "Steep",        s: 5,   k: 0.5 },
        { nm: "Hard",         s: 14,  k: 0.5 },
        { nm: "Soft (edge)",  s: 2.5, k: 0.25 },
        { nm: "Steep (edge)", s: 6,   k: 0.25 },
        { nm: "Soft (core)",  s: 2.5, k: 0.75 },
        { nm: "Steep (core)", s: 6,   k: 0.75 }
    ];
    var EASE_NAMES = [];
    for (var en = 0; en < EASES.length; en++) EASE_NAMES.push(EASES[en].nm);
    var MAX_HIST  = 600;                    // потолок истории Delay, кадров
    var COLOR     = [0.25, 0.8, 1];         // цвет гизмо
    var EFF_ROT   = -90;                    // поворот нового эффектора: у Linear полная сила снизу, ноль сверху
    var TR  = "ADBE Transform Group";
    var FXP = "ADBE Effect Parade";
    var VEC = "ADBE Root Vectors Group";

    // ===== проверки контекста =====
    if (!app.project) { alert("Нет открытого проекта."); return; }

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        alert("Активный элемент должен быть композицией.");
        return;
    }

    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) {
        alert("Выдели слои, которые станут клонами (или эффектор + слои, чтобы добавить их к нему).");
        return;
    }

    var removeMode = false;
    try { removeMode = !!(ScriptUI.environment.keyboardState.altKey); } catch (e) {}

    // ===== утилиты =====
    var warnings = [];
    function warn(m) { warnings.push(m); }

    function tr(layer, mn) {
        try { var g = layer.property(TR); return g ? g.property(mn) : null; } catch (e) { return null; }
    }

    function fxGroup(layer) {
        try { return layer.property(FXP); } catch (e) { return null; }   // у камер и светов нет
    }

    function findFx(layer, nm, mn) {
        var g = fxGroup(layer);
        if (!g) return null;
        try {
            for (var i = 1; i <= g.numProperties; i++) {
                var f = g.property(i);
                if (f.name === nm && f.matchName === mn) return f;
            }
        } catch (e) {}
        return null;
    }

    function removeFx(layer, nm, mn) {
        var f = findFx(layer, nm, mn);
        if (!f) return;
        try { f.remove(); } catch (e) {}
    }

    function isEffector(L) {
        try { return String(L.comment).indexOf(MARK_EFF) !== -1; } catch (e) { return false; }
    }

    function linkOf(L) { return findFx(L, FX_LINK, "ADBE Layer Control"); }

    function is3D(L) {
        try { return L.threeDLayer === true; } catch (e) { return false; }
    }

    // ===== выражения клона =====
    // Вес считается один раз — в слайдере MG Weight, — остальные свойства его только читают.
    // Точка покоя клона = его Position, переведённая через родителя в мир. Position мы
    // не трогаем (сдвиг идёт через Anchor Point), поэтому здесь она всегда «до эффектора»
    // и цикла ссылок нет. toWorld/fromWorld, а не toComp: камера сюда лезть не должна.
    //
    // Delay/Spring: задержка общая для всех клонов эффектора, falloff и Strength на её силу
    // не влияют. Дорогое в ней — история: фильтр прогоняется по окну прошлых кадров. Поэтому:
    //  - реакция на эффектор задерживается ОДИН раз на клон — в весе (MG Weight). Вес в
    //    прошлом считается прямо в этом выражении (rawAt), а не через valueAtTime другого
    //    свойства с выражением: такой вызов пересчитывает чужое выражение целиком, и в цикле
    //    это клало AE (первая версия Delay: на пяти клонах кадров было не дождаться);
    //  - собственное движение клона (ключи свойства; у Position — ключи и родитель)
    //    задерживается в самом свойстве, и только если оно правда анимировано;
    //  - трансформ-свойства читают уже задержанный вес на текущем кадре.
    // Параметры эффектора Position/Scale/Rotation/Opacity берутся на текущем кадре — их
    // анимация не задерживается. Пружинит всё, что идёт через вес: движение эффектора,
    // Strength, falloff.
    //
    // Окно истории — пока хвост фильтра не затухнет ниже 1% (e^-5): иначе в момент, когда
    // изменение уходит за край окна, был бы скачок. Перед окном клон считается в покое.
    var DELAYED =
        "function delayed(f) {                     // Delay/Spring над f(t) по окну истории\n" +
        "    var mode = 1, T = 0, bounce = 0;\n" +
        "    try {\n" +
        "        mode = Math.round(E.effect(\"Delay mode\")(1).value);    // 1 Off, 2 Blend, 3 Spring\n" +
        "        T = Math.max(0, E.effect(\"Delay (frames)\")(1).value);\n" +
        "        bounce = clamp(E.effect(\"Spring bounce %\")(1).value, 0, 100) / 100;\n" +
        "    } catch (err) { mode = 1; }                 // эффектор старой версии — без задержки\n" +
        "    if (mode < 2 || T < 0.01) return f(time);\n" +
        "    var dt = thisComp.frameDuration, tau = T * dt;\n" +
        "    var zeta = 1 - 0.8 * bounce;                // 1 — без перелёта, 0.2 — сильно пружинит\n" +
        "    var life = (mode == 2) ? tau : tau / zeta;  // постоянная затухания фильтра\n" +
        "    var n = Math.min(Math.ceil(5 * life / dt), " + MAX_HIST + ");\n" +
        "    var t0 = time - n * dt;\n" +
        "    var first = f(t0), scalar = (typeof first == \"number\");\n" +
        "    var y = scalar ? [first] : first.slice(), v = [];\n" +
        "    for (var c = 0; c < y.length; c++) v.push(0);\n" +
        "    var a = Math.exp(-dt / tau);\n" +
        "    var w0 = 1 / tau, sub = Math.max(1, Math.ceil(dt * w0 / 0.25)), hs = dt / sub;\n" +
        "    for (var i = 1; i <= n; i++) {\n" +
        "        var x = f(t0 + i * dt);\n" +
        "        if (scalar) x = [x];\n" +
        "        for (var j = 0; j < y.length; j++) {\n" +
        "            if (mode == 2) {\n" +
        "                y[j] = x[j] + (y[j] - x[j]) * a;    // Blend: точная экспонента за кадр\n" +
        "            } else {\n" +
        "                for (var k = 0; k < sub; k++) {     // Spring: y'' = w0^2 (x - y) - 2 zeta w0 y'\n" +
        "                    v[j] += (w0 * w0 * (x[j] - y[j]) - 2 * zeta * w0 * v[j]) * hs;\n" +
        "                    y[j] += v[j] * hs;\n" +
        "                }\n" +
        "            }\n" +
        "        }\n" +
        "    }\n" +
        "    return scalar ? y[0] : y;\n" +
        "}\n";

    // Рампа falloff'а: 1 до a, 0 после b, между — изинг. u — путь по рампе от внешней границы
    // (вес 0) к внутренней (вес 1). S-кривые — обобщение bias/gain Шлика (J. Barron, 2020):
    // s — крутизна в точке перегиба (1 — прямая, на концах наклон 1/s, s → ∞ — ступенька),
    // k — где перегиб: 0.5 посередине, меньше — к внешней границе, больше — к центру.
    var RAMP_S = [], RAMP_K = [];
    for (var ri = 0; ri < EASES.length; ri++) { RAMP_S.push(EASES[ri].s); RAMP_K.push(EASES[ri].k); }
    var RAMP =
        "function ramp(d, a, b, e) {     // e — пункт меню Falloff ease\n" +
        "    if (d <= a) return 1;\n" +
        "    if (d >= b) return 0;\n" +
        "    var u = (b - d) / (b - a);    // 0 на внешней границе, 1 на внутренней\n" +
        "    var s = [" + RAMP_S.join(", ") + "][e - 1], k = [" + RAMP_K.join(", ") + "][e - 1];\n" +
        "    if (!(s > 0)) return u * u * (3 - 2 * u);             // Smooth (smoothstep)\n" +
        "    if (u < k) return k * u / (u + s * (k - u));           // перегиб в (k, k), наклон там s\n" +
        "    return (1 - k) * (u - 1) / (1 - u - s * (k - u)) + 1;\n" +
        "}\n";

    var EXPR_WEIGHT =
        "// " + MARK + " — вес клона, 0–100, с Delay/Spring (Small Scripts: MoGraph effector)\n" +
        RAMP +
        "var E = null, flat = true;\n" +
        "try {\n" +
        "    E = effect(\"" + FX_LINK + "\")(1);\n" +
        "    flat = !(E.transform.position.value.length > 2);   // 2D-эффектор игнорирует Z\n" +
        "} catch (err) { E = null; }\n" +
        "\n" +
        "// Мгновенный вес в момент t: точка покоя -> система эффектора (от его начала координат) -> falloff\n" +
        "function rawAt(t) {\n" +
        "    try {\n" +
        "        var fx = function (n) { return E.effect(n)(1).valueAtTime(t); };\n" +
        "        var p = transform.position.valueAtTime(t);\n" +
        "        if (p.length < 3) p = [p[0], p[1], 0];\n" +
        "        var q = E.fromWorld(hasParent ? parent.toWorld(p, t) : p, t);\n" +
        "        var x = q[0], y = q[1], z = (!flat && q.length > 2) ? q[2] : 0;\n" +
        "        var shape = Math.round(fx(\"Falloff shape\"));   // 1 Infinite, 2 Sphere, 3 Box, 4 Linear\n" +
        "        var R = Math.abs(fx(\"Falloff size\"));\n" +
        "        var f = clamp(fx(\"Falloff %\"), 0, 100) / 100;\n" +
        "        var e = 2;                              // изинг рампы; у эффектора старой версии — Smooth\n" +
        "        try { e = Math.round(fx(\"Falloff ease\")); } catch (err2) { e = 2; }\n" +
        "        var w = 1;\n" +
        "        if (shape == 4) {\n" +
        "            var h = R * f / 2;                  // вдоль X эффектора: сзади 1, впереди 0\n" +
        "            w = ramp(x, -h, h, e);\n" +
        "        } else if (shape == 2 || shape == 3) {\n" +
        "            var d = (shape == 3) ? Math.max(Math.abs(x), Math.abs(y), Math.abs(z))\n" +
        "                                 : Math.sqrt(x * x + y * y + z * z);\n" +
        "            w = ramp(d, R * (1 - f), R, e);\n" +
        "        }\n" +
        "        if (fx(\"Invert\") != 0) w = 1 - w;\n" +
        "        return w * fx(\"Strength\") / 100;\n" +
        "    } catch (err) { return 0; }\n" +
        "}\n" +
        "\n" +
        DELAYED +
        "delayed(rawAt) * 100";

    // Трансформ-свойства клона: уже задержанный вес на текущем кадре + параметры эффектора
    // на текущем кадре + собственное значение (с задержкой, если у свойства есть ключи).
    var HEAD =
        "var E = null;\n" +
        "try { E = effect(\"" + FX_LINK + "\")(1); } catch (err) { E = null; }\n" +
        "var w = 0;                            // вес 0..1, Delay/Spring уже внутри\n" +
        "try { w = effect(\"" + FX_WEIGHT + "\")(1).value / 100; } catch (err) { w = 0; }\n" +
        "function fxv(n) { return E.effect(n)(1).value; }\n";

    function expr(label, body) {
        return "// " + MARK + " — " + label + " (Small Scripts: MoGraph effector)\n" +
               HEAD + DELAYED + body;
    }

    // Scale / Rotation / Opacity. Своё свойство с нашим выражением чужого выражения не
    // несёт, так что numKeys — точный признак «анимировано». valueAtTime своего же
    // свойства — значение до выражения, то есть ключи.
    function exprSimple(label, apply) {
        return expr(label,
            "var own = (thisProperty.numKeys > 0)\n" +
            "    ? delayed(function (t) { return thisProperty.valueAtTime(t); })\n" +
            "    : value;\n" +
            "var res = own;\n" +
            "if (w != 0 && E !== null) {\n" +
            "    try { " + apply + " } catch (err) { res = own; }\n" +
            "}\n" +
            "res");
    }

    // Position. Сдвиг D (мир) = задержка покоя (свои ключи Position, движение родителя)
    // + сдвиг эффектора с задержанным весом. Реализуется через Anchor Point:
    // Anchor' = Anchor − (Parent·R·S)⁻¹·D. Контент крутится и масштабируется вокруг
    // прежнего якоря и целиком уезжает на D. R и S — уже с поворотом/масштабом от эффектора,
    // поэтому сдвиг точный. 2D считается руками, 3D — через fromWorldVec самого слоя
    // (в AE проверено, работает).
    var EXPR_ANCHOR = expr("сдвиг Position, через Anchor Point",
        "function restAt(t) {                  // точка покоя клона в мире\n" +
        "    var p = transform.position.valueAtTime(t);\n" +
        "    if (p.length < 3) p = [p[0], p[1], 0];\n" +
        "    var q = hasParent ? parent.toWorld(p, t) : p;\n" +
        "    return (q.length < 3) ? [q[0], q[1], 0] : q;\n" +
        "}\n" +
        "var res = value;\n" +
        "try {\n" +
        "    var R0 = restAt(time);\n" +
        "    var Y = (hasParent || transform.position.numKeys > 0) ? delayed(restAt) : R0;\n" +
        "    var d = [Y[0] - R0[0], Y[1] - R0[1], Y[2] - R0[2]];\n" +
        "    if (w != 0 && E !== null) {\n" +
        "        d = [d[0] + fxv(\"Position X\") * w, d[1] + fxv(\"Position Y\") * w, d[2] + fxv(\"Position Z\") * w];\n" +
        "    }\n" +
        "    var s = transform.scale.value;\n" +
        "    var ok = (Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]) > 1e-6);\n" +
        "    for (var i = 0; i < s.length; i++) if (Math.abs(s[i]) < 0.001) ok = false;\n" +
        "    if (ok && value.length < 3) {\n" +
        "        var u = hasParent ? parent.fromWorldVec(d) : d;\n" +
        "        var an = degreesToRadians(transform.rotation.value);\n" +
        "        var cs = Math.cos(an), sn = Math.sin(an);\n" +
        "        res = [value[0] - ( cs * u[0] + sn * u[1]) / (s[0] / 100),\n" +
        "               value[1] - (-sn * u[0] + cs * u[1]) / (s[1] / 100)];\n" +
        "    } else if (ok) {\n" +
        "        var fv = fromWorldVec(d);\n" +
        "        res = [value[0] - fv[0], value[1] - fv[1], value[2] - fv[2]];\n" +
        "    }\n" +
        "} catch (err) { res = value; }\n" +
        "res");

    var EXPR_SCALE = exprSimple("Scale",
        "res = mul(own, 1 + (fxv(\"Scale %\") / 100 - 1) * w);");

    function exprRot(fxName) {
        return exprSimple(fxName,
            "res = own + fxv(\"" + fxName + "\") * w;");
    }

    var EXPR_OPACITY = exprSimple("Opacity",
        "res = own * (1 + (fxv(\"Opacity %\") / 100 - 1) * w);");

    var CLONE_PROPS = [
        { mn: "ADBE Anchor Point", label: "Anchor Point", expr: EXPR_ANCHOR },
        { mn: "ADBE Scale",        label: "Scale",        expr: EXPR_SCALE },
        { mn: "ADBE Rotate Z",     label: "Rotation",     expr: exprRot("Rotation Z") },
        { mn: "ADBE Rotate X",     label: "X Rotation",   expr: exprRot("Rotation X"), only3D: true },
        { mn: "ADBE Rotate Y",     label: "Y Rotation",   expr: exprRot("Rotation Y"), only3D: true },
        { mn: "ADBE Opacity",      label: "Opacity",      expr: EXPR_OPACITY }
    ];

    // ===== запись / снятие выражений =====
    function writeExpr(prop, txt, label, who) {
        if (!prop) return 0;
        try { if (!prop.canSetExpression) return 0; } catch (e) { return 0; }
        var cur = "";
        try { cur = prop.expression || ""; } catch (e) {}
        if (cur !== "" && cur.indexOf(MARK) === -1) {
            warn(who + " → " + label + ": уже есть своё выражение, не трогаю");
            return 0;
        }
        try { prop.expression = txt; return 1; }
        catch (e) { warn(who + " → " + label + ": " + e.toString()); return 0; }
    }

    function strip(L) {
        var n = 0;
        for (var i = 0; i < CLONE_PROPS.length; i++) {
            var p = tr(L, CLONE_PROPS[i].mn);
            if (!p) continue;
            try {
                if (p.expression && p.expression.indexOf(MARK) !== -1) { p.expression = ""; n++; }
            } catch (e) {}
        }
        removeFx(L, FX_WEIGHT, "ADBE Slider Control");
        removeFx(L, FX_LINK, "ADBE Layer Control");
        return n;
    }

    // Клон -> эффектор. Эффекты перечитываются после каждого addProperty:
    // добавление в группу инвалидирует ранее взятые ссылки на её соседей.
    function enroll(L, E) {
        var who = L.name;
        var g = fxGroup(L);
        if (!g) { warn(who + ": на слой нельзя повесить эффекты (камера/свет?) — пропущен"); return false; }
        try {
            var link = linkOf(L);
            if (!link) {
                g.addProperty("ADBE Layer Control").name = FX_LINK;
            } else {
                var was = link.property(1).value;
                if (was !== 0 && was !== E.index) {
                    var wasName = "#" + was;
                    try { wasName = comp.layer(was).name; } catch (e) {}
                    warn(who + ": был клоном «" + wasName + "», перевешен");
                }
            }
            linkOf(L).property(1).setValue(E.index);

            if (!findFx(L, FX_WEIGHT, "ADBE Slider Control")) {
                fxGroup(L).addProperty("ADBE Slider Control").name = FX_WEIGHT;
            }
            findFx(L, FX_WEIGHT, "ADBE Slider Control").property(1).expression = EXPR_WEIGHT;
        } catch (e) {
            warn(who + ": " + e.toString());
            return false;
        }
        var threeD = is3D(L);
        for (var i = 0; i < CLONE_PROPS.length; i++) {
            var cp = CLONE_PROPS[i];
            if (cp.only3D && !threeD) continue;
            writeExpr(tr(L, cp.mn), cp.expr, cp.label, who);
        }
        return true;
    }

    function clonesOf(E) {
        var out = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var f = linkOf(comp.layer(i));
            try { if (f && f.property(1).value === E.index) out.push(comp.layer(i)); } catch (e) {}
        }
        return out;
    }

    // ===== создание эффектора =====
    function uniqueName(base) {
        var used = {};
        for (var i = 1; i <= comp.numLayers; i++) used[comp.layer(i).name] = true;
        if (!used[base]) return base;
        for (var n = 2; n < 10000; n++) if (!used[base + " " + n]) return base + " " + n;
        return base;
    }

    function addCtrl(E, mn, nm, v) {
        var f = E.property(FXP).addProperty(mn);
        f.name = nm;
        f.property(1).setValue(v);
    }

    function addMenu(E, nm, items, v) {
        var f = E.property(FXP).addProperty("ADBE Dropdown Control");
        var menu = null;
        try { menu = f.property(1).setPropertyParameters(items); } catch (e) { menu = null; }
        if (menu) {
            // setPropertyParameters инвалидирует f — имя ставим через возвращённое свойство
            menu.propertyGroup(1).name = nm;
            menu.setValue(v);
            return;
        }
        // AE старше 17.0.2: меню не настроить — число вместо него, выражения читают так же (1)
        try { f.remove(); } catch (e) {}
        addCtrl(E, "ADBE Slider Control", nm, v);
        var legend = [];
        for (var i = 0; i < items.length; i++) legend.push((i + 1) + " " + items[i]);
        warn("«" + nm + "» — слайдер вместо меню: " + legend.join(", "));
    }

    // Все контролы эффектора по порядку. Тот же список добивает недостающие у эффектора
    // старой версии — новые встают в конец, выражения ищут их по имени.
    var SL = "ADBE Slider Control", AN = "ADBE Angle Control";
    var CONTROLS = [
        { nm: "Strength",        mn: SL, v: 100 },
        { nm: "Position X",      mn: SL, v: 0 },
        { nm: "Position Y",      mn: SL, v: 0 },
        { nm: "Position Z",      mn: SL, v: 0 },
        { nm: "Scale %",         mn: SL, v: 100 },
        { nm: "Rotation X",      mn: AN, v: 0 },
        { nm: "Rotation Y",      mn: AN, v: 0 },
        { nm: "Rotation Z",      mn: AN, v: 0 },
        { nm: "Opacity %",       mn: SL, v: 100 },
        { nm: "Falloff shape",   menu: SHAPES, v: 4 },                    // Linear
        { nm: "Falloff size",    mn: SL, v: Math.round(Math.min(comp.width, comp.height) / 4) },
        { nm: "Falloff %",       mn: SL, v: 100 },
        { nm: "Falloff ease",    menu: EASE_NAMES, v: 5, keep: 2 },       // новому Soft (edge), старому Smooth
        { nm: "Invert",          mn: "ADBE Checkbox Control", v: 0 },
        { nm: "Delay mode",      menu: DELAYS, v: 1 },
        { nm: "Delay (frames)",  mn: SL, v: 6 },
        { nm: "Spring bounce %", mn: SL, v: 50 }
    ];

    function hasFxNamed(E, nm) {
        var g = fxGroup(E);
        if (!g) return false;
        for (var i = 1; i <= g.numProperties; i++) if (g.property(i).name === nm) return true;
        return false;
    }

    function ensureControls(E, fresh) {
        var added = 0;
        for (var i = 0; i < CONTROLS.length; i++) {
            var c = CONTROLS[i];
            if (hasFxNamed(E, c.nm)) continue;
            var v = (!fresh && c.keep !== undefined) ? c.keep : c.v;
            if (c.menu) addMenu(E, c.nm, c.menu, v);
            else addCtrl(E, c.mn, c.nm, v);
            added++;
        }
        return added;
    }

    // Кусок гизмо: группа с одной фигурой и обводкой, видимость — по форме falloff'а.
    // Группу каждый раз берём заново по индексу — см. комментарий у enroll().
    function gizmoPart(E, nm, shapeMN, paramMN, paramExpr, strokeOpacity, visExpr) {
        var gi = E.property(VEC).addProperty("ADBE Vector Group").propertyIndex;
        function grp() { return E.property(VEC).property(gi); }
        grp().name = nm;
        grp().property("ADBE Vectors Group").addProperty(shapeMN);
        var param = grp().property("ADBE Vectors Group").property(1).property(paramMN);
        if (typeof paramExpr === "string") param.expression = paramExpr;
        else param.setValue(paramExpr);
        var st = grp().property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
        st.property("ADBE Vector Stroke Color").setValue(COLOR);
        st.property("ADBE Vector Stroke Width").setValue(2);
        st.property("ADBE Vector Stroke Opacity").setValue(strokeOpacity);
        if (visExpr) {
            grp().property("ADBE Vector Transform Group")
                 .property("ADBE Vector Group Opacity").expression = visExpr;
        }
    }

    // Гизмо рисуется вокруг начала координат шейп-слоя — от него же weight считает falloff,
    // так что круг/квадрат/линии на экране ровно там, где проходит граница.
    function buildGizmo(E) {
        function vis(k) { return "Math.round(effect(\"Falloff shape\")(1).value) == " + k + " ? 100 : 0"; }
        var R   = "var R = Math.abs(effect(\"Falloff size\")(1).value);\n";
        var F   = "var f = clamp(effect(\"Falloff %\")(1).value, 0, 100) / 100;\n";
        var LIN = R + F + "var h = R * f / 2;\nvar L = Math.max(thisComp.width, thisComp.height);\n";
        var ELL = "ADBE Vector Shape - Ellipse", ELL_S = "ADBE Vector Ellipse Size";
        var RCT = "ADBE Vector Shape - Rect",    RCT_S = "ADBE Vector Rect Size";
        var PTH = "ADBE Vector Shape - Group",   PTH_S = "ADBE Vector Shape";

        gizmoPart(E, "Sphere",       ELL, ELL_S, R + "[2 * R, 2 * R]", 100, vis(2));
        gizmoPart(E, "Sphere inner", ELL, ELL_S, R + F + "var r = 2 * R * (1 - f);\n[r, r]", 40, vis(2));
        gizmoPart(E, "Box",          RCT, RCT_S, R + "[2 * R, 2 * R]", 100, vis(3));
        gizmoPart(E, "Box inner",    RCT, RCT_S, R + F + "var r = 2 * R * (1 - f);\n[r, r]", 40, vis(3));
        // Linear: яркая линия — граница полной силы, бледная — нулевой
        gizmoPart(E, "Linear full",  PTH, PTH_S, LIN + "createPath([[-h, -L], [-h, L]], [], [], false)", 100, vis(4));
        gizmoPart(E, "Linear zero",  PTH, PTH_S, LIN + "createPath([[h, -L], [h, L]], [], [], false)", 40, vis(4));

        // крестик в центре — виден всегда, в том числе на Infinite
        var cross = new Shape();
        cross.vertices = [[-30, 0], [30, 0], [0, 0], [0, -30], [0, 30]];
        cross.closed = false;
        gizmoPart(E, "Center", PTH, PTH_S, cross, 100, null);
    }

    // Центр масс клонов в мировых координатах. ExtendScript не умеет toWorld, поэтому
    // считает выражение: ставим его на Position эффектора, читаем результат, снимаем.
    function placeAtCentroid(E, clones, threeD) {
        var pos = tr(E, "ADBE Position");
        var ids = [];
        for (var i = 0; i < clones.length; i++) ids.push(clones[i].index);
        var ex =
            "var ids = [" + ids.join(", ") + "], s = [0, 0, 0];\n" +
            "for (var i = 0; i < ids.length; i++) {\n" +
            "    var L = thisComp.layer(ids[i]);\n" +
            "    var p = L.transform.position.value;\n" +
            "    if (p.length < 3) p = [p[0], p[1], 0];\n" +
            "    if (L.hasParent) p = L.parent.toWorld(p);\n" +
            "    s = [s[0] + p[0], s[1] + p[1], s[2] + p[2]];\n" +
            "}\n" +
            "var n = ids.length;\n" +
            (threeD ? "[s[0] / n, s[1] / n, s[2] / n]" : "[s[0] / n, s[1] / n]");
        try {
            pos.expression = ex;
            var v = pos.value;           // при живом выражении — уже его результат
            pos.expression = "";
            pos.setValue(v);
        } catch (e) {
            try { pos.expression = ""; } catch (e2) {}
        }
    }

    function createEffector(clones, threeD) {
        var E = comp.layers.addShape();
        E.name = uniqueName(BASE_NAME);
        E.comment = MARK_EFF + " — эффектор MoGraph (Small Scripts)";
        E.guideLayer = true;
        if (threeD) E.threeDLayer = true;

        var top = clones[0];
        for (var i = 1; i < clones.length; i++) if (clones[i].index < top.index) top = clones[i];
        E.moveBefore(top);

        ensureControls(E, true);
        try { tr(E, "ADBE Rotate Z").setValue(EFF_ROT); } catch (e) {}
        buildGizmo(E);
        placeAtCentroid(E, clones, threeD);
        return E;
    }

    // ===== разбор выделения =====
    var effs = [], others = [];
    for (var s = 0; s < sel.length; s++) {
        if (isEffector(sel[s])) effs.push(sel[s]);
        else others.push(sel[s]);
    }

    // ===== режим снятия (Alt) =====
    if (removeMode) {
        var targets = [], seen = {};
        var take = function (L) { if (!seen[L.index]) { seen[L.index] = true; targets.push(L); } };
        for (var o = 0; o < others.length; o++) if (linkOf(others[o])) take(others[o]);
        for (var e = 0; e < effs.length; e++) {
            var cl = clonesOf(effs[e]);
            for (var c = 0; c < cl.length; c++) take(cl[c]);
        }
        if (targets.length === 0 && effs.length === 0) {
            alert("В выделении нет ни клонов, ни эффекторов — снимать нечего.");
            return;
        }

        app.beginUndoGroup("MoGraph effector — снять");
        var cleared = 0;
        for (var t = 0; t < targets.length; t++) cleared += strip(targets[t]);
        var removed = 0;
        for (var r = 0; r < effs.length; r++) {
            try { effs[r].remove(); removed++; } catch (err) { warn(effs[r].name + ": не удалился — " + err.toString()); }
        }
        app.endUndoGroup();

        var rmsg = "Снято клонов: " + targets.length + "\n" +
                   "Выражений очищено: " + cleared + "\n" +
                   "Эффекторов удалено: " + removed;
        if (warnings.length) rmsg += "\n\n--- предупреждения ---\n" + warnings.join("\n");
        alert(rmsg);
        return;
    }

    // ===== режим создания / добавления =====
    if (effs.length > 1) {
        alert("Выделено несколько эффекторов. Выдели один (добавить к нему слои) или ни одного (создать новый).");
        return;
    }
    // ===== только эффектор — обновить до текущей версии =====
    // Недостающие контролы (например, Delay у эффектора, сделанного до него) + свежие
    // выражения на всех его клонах. Повторный прогон ничего не ломает.
    if (others.length === 0) {
        var U = effs[0];
        app.beginUndoGroup("MoGraph effector — обновить");
        var addedU = 0;
        try { addedU = ensureControls(U); } catch (err) { warn(U.name + ": " + err.toString()); }
        var mine = clonesOf(U), rewritten = 0;
        for (var j = 0; j < mine.length; j++) if (enroll(mine[j], U)) rewritten++;
        app.endUndoGroup();

        var umsg = "Эффектор «" + U.name + "» обновлён.\n" +
                   "Контролов добавлено: " + addedU + "\n" +
                   "Клонов переписано: " + rewritten + " из " + mine.length;
        if (mine.length === 0) umsg += "\n\nЧтобы добавить слои — выдели их вместе с эффектором.";
        if (warnings.length) umsg += "\n\n--- предупреждения ---\n" + warnings.join("\n");
        alert(umsg);
        return;
    }

    var clones = [], any3D = false;
    for (var k = 0; k < others.length; k++) {
        if (!fxGroup(others[k])) { warn(others[k].name + ": камера/свет — пропущен"); continue; }
        clones.push(others[k]);
        if (is3D(others[k])) any3D = true;
    }
    if (clones.length === 0) {
        alert("Ни на один из выделенных слоёв нельзя повесить эффекты (камеры/светы).");
        return;
    }
    clones.sort(function (a, b) { return a.index - b.index; });

    app.beginUndoGroup("MoGraph effector");

    var created = effs.length === 0;
    var E;
    try {
        if (created) {
            E = createEffector(clones, any3D);
        } else {
            E = effs[0];
            if (any3D && !is3D(E)) E.threeDLayer = true;   // 3D-клонам нужен 3D-falloff
            ensureControls(E);                             // эффектор старой версии — добить контролы
        }
    } catch (err) {
        app.endUndoGroup();
        alert("Не смог создать эффектор: " + err.toString());
        return;
    }

    var done = 0, isNew = {};
    for (var m = 0; m < clones.length; m++) {
        isNew[clones[m].index] = true;
        if (enroll(clones[m], E)) done++;
    }

    // старые клоны этого эффектора — выражения до текущей версии, чтобы все вели себя одинаково
    var refreshed = 0;
    if (!created) {
        var olds = clonesOf(E);
        for (var o2 = 0; o2 < olds.length; o2++) {
            if (!isNew[olds[o2].index] && enroll(olds[o2], E)) refreshed++;
        }
    }

    app.endUndoGroup();

    // ===== отчёт =====
    var msg = "Эффектор: " + E.name + (created ? " (новый)" : "") + "\n" +
              "Клонов: " + done + " из " + clones.length +
              (refreshed ? "\nСтарых клонов обновлено: " + refreshed : "") + "\n\n" +
              "Параметры — в Effect Controls эффектора: Strength, Position X/Y/Z, Scale %, " +
              "Rotation X/Y/Z, Opacity %, Falloff shape / size / % / ease, Invert, " +
              "Delay mode (Off / Blend / Spring), Delay (frames), Spring bounce %.\n" +
              "Вес клона — слайдер «" + FX_WEIGHT + "» (0–100), его можно брать в свои выражения.\n" +
              "Alt+клик по кнопке — снять.";
    if (warnings.length) msg += "\n\n--- предупреждения ---\n" + warnings.join("\n");
    alert(msg);

})();
