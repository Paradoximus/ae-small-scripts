/* @ae-script
name:  ⏳ Delay children (trail)
desc:  Выделенный нуль остаётся родителем, но дети начинают повторять его анимацию с отставанием. Свои PSR и свои ключи детей не трогаются — выражения только компенсируют трансформ родителя на дельту времени. Задержка = слайдер «Delay (frames)» на нуле × слайдер «Delay mult» на каждом ребёнке (по умолчанию 1, 2, 3… сверху вниз — готовый каскад). Position компенсируется точно (через fromWorld/toWorld), Rotation и Scale — покомпонентно; для 3D-нуля, крутящегося сразу по нескольким осям, поворот приблизительный. Alt+клик — снять всё обратно.
prep:  |
  - Открыть композицию
  - Выделить один анимированный нуль (возьму всех его прямых детей)
  - Либо: нуль + нужных его детей (тогда только их)
  - Alt+клик по кнопке — удалить выражения и слайдеры
tags:  parent, expression, delay, trail, null, offset
*/

(function () {

    // ===== конфиг =====
    var MARKER    = "@delay-parent";
    var FX_DELAY  = "Delay (frames)";   // слайдер на родителе
    var FX_MULT   = "Delay mult";       // слайдер на каждом ребёнке
    var DEF_DELAY = 3;                  // кадра
    var SLIDER    = "ADBE Slider Control";
    var TR        = "ADBE Transform Group";
    var FXP       = "ADBE Effect Parade";

    // ===== проверки контекста =====
    if (!app.project) { alert("Нет открытого проекта."); return; }

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        alert("Активный элемент должен быть композицией.");
        return;
    }

    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) {
        alert("Выдели анимированный нуль (или нуль + нужных его детей).");
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

    function isChildOf(L, P) {
        try { return !!(L.parent && L.parent.index === P.index); } catch (e) { return false; }
    }

    function animated(prop) {
        if (!prop) return false;
        try { if (prop.numKeys > 0) return true; } catch (e) {}
        try { if (prop.expressionEnabled && prop.expression !== "") return true; } catch (e) {}
        return false;
    }

    var TRANSFORM_MNS = [
        "ADBE Anchor Point", "ADBE Position",
        "ADBE Position_0", "ADBE Position_1", "ADBE Position_2",
        "ADBE Scale", "ADBE Orientation",
        "ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"
    ];

    function anyTransformAnim(layer) {
        for (var i = 0; i < TRANSFORM_MNS.length; i++) {
            if (animated(tr(layer, TRANSFORM_MNS[i]))) return true;
        }
        return false;
    }

    // анимация в любом месте цепочки родителей
    function chainAnim(layer) {
        var L = layer, guard = 0;
        while (L && guard++ < 50) {
            if (anyTransformAnim(L)) return true;
            try { L = L.parent; } catch (e) { L = null; }
        }
        return false;
    }

    function findFx(layer, nm) {
        try {
            var g = layer.property(FXP);
            if (!g) return null;
            for (var i = 1; i <= g.numProperties; i++) {
                if (g.property(i).name === nm) return g.property(i);
            }
        } catch (e) {}
        return null;
    }

    function ensureSlider(layer, nm, def) {
        var f = findFx(layer, nm);
        if (f) return f;
        var g = null;
        try { g = layer.property(FXP); } catch (e) { g = null; }
        if (!g) return null;                      // у камер и светов эффектов нет
        try {
            f = g.addProperty(SLIDER);
            f.name = nm;
            f.property(1).setValue(def);
            return f;
        } catch (e) { return null; }
    }

    function removeFx(layer, nm) {
        var f = findFx(layer, nm);
        if (!f) return false;
        try { f.remove(); return true; } catch (e) { return false; }
    }

    // ===== кто родитель, кто дети =====
    var parentLayer = null, kids = [];

    if (sel.length === 1) {
        parentLayer = sel[0];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (isChildOf(L, parentLayer)) kids.push(L);
        }
    } else {
        var cands = [];
        for (var a = 0; a < sel.length; a++) {
            for (var b = 0; b < sel.length; b++) {
                if (isChildOf(sel[b], sel[a])) { cands.push(sel[a]); break; }
            }
        }
        if (cands.length !== 1) {
            alert("Не понял, кто здесь родитель.\n\nВыдели ОДИН нуль — возьму всех его детей.\nИли нуль + его прямых детей — возьму только их.");
            return;
        }
        parentLayer = cands[0];
        for (var c = 0; c < sel.length; c++) {
            if (isChildOf(sel[c], parentLayer)) kids.push(sel[c]);
        }
    }

    if (kids.length === 0) {
        alert("У слоя «" + parentLayer.name + "» нет прямых детей.\nСначала запарень нужные слои к нему.");
        return;
    }
    kids.sort(function (x, y) { return x.index - y.index; });

    // ===== режим снятия (Alt) =====
    if (removeMode) {
        var CLEAN_MNS = ["ADBE Position", "ADBE Position_0", "ADBE Position_1", "ADBE Position_2",
                         "ADBE Scale", "ADBE Orientation",
                         "ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];
        app.beginUndoGroup("Delay children — снять");
        var cleared = 0;
        for (var k = 0; k < kids.length; k++) {
            for (var m = 0; m < CLEAN_MNS.length; m++) {
                var p = tr(kids[k], CLEAN_MNS[m]);
                if (!p) continue;
                try {
                    if (p.expression && p.expression.indexOf(MARKER) !== -1) {
                        p.expression = "";
                        cleared++;
                    }
                } catch (e) {}
            }
            removeFx(kids[k], FX_MULT);
        }
        removeFx(parentLayer, FX_DELAY);
        app.endUndoGroup();
        alert("Снято.\nВыражений очищено: " + cleared + "\nСлоёв затронуто: " + (kids.length + 1));
        return;
    }

    // ===== предупреждение: родитель без анимации =====
    if (!chainAnim(parentLayer)) {
        if (!confirm("У слоя «" + parentLayer.name + "» нет анимации трансформа —\nотставать будет не от чего.\n\nВсё равно навесить выражения?")) return;
    }

    var pFxGroup = null;
    try { pFxGroup = parentLayer.property(FXP); } catch (e) {}
    if (!pFxGroup) {
        alert("На слой «" + parentLayer.name + "» нельзя повесить эффект (камера/свет?).\nНужен нуль или обычный слой.");
        return;
    }

    // ===== генератор выражений =====
    var HEAD =
        "// " + MARKER + " — отставание от родителя (Small Scripts: Delay children)\n" +
        "var res = value;\n" +
        "try {\n" +
        "    var P = thisLayer.parent;\n" +
        "    var D = P.effect(\"" + FX_DELAY + "\")(\"Slider\").value\n" +
        "          * effect(\"" + FX_MULT + "\")(\"Slider\").value\n" +
        "          * thisComp.frameDuration;\n" +
        "    if (D != 0) {\n";

    var TAIL =
        "    }\n" +
        "} catch (err) { res = value; }\n" +
        "res";

    function expr(body) { return HEAD + body + "\n" + TAIL; }

    // Position — точная компенсация всей матрицы родителя.
    // value ребёнка это точка в системе координат слоя-родителя, поэтому
    // fromWorld(toWorld(value, time - D)) даёт ровно «где бы я оказался,
    // если бы родитель сейчас стоял в своём прошлом состоянии».
    var EXPR_POS = expr(
        "        var r = P.fromWorld(P.toWorld(value, time - D));\n" +
        "        res = (value.length == 2) ? [r[0], r[1]]\n" +
        "                                  : [r[0], r[1], (r.length > 2 ? r[2] : value[2])];"
    );

    var EXPR_SCALE = expr(
        "        var pc = P.transform.scale.value;\n" +
        "        var pd = P.transform.scale.valueAtTime(time - D);\n" +
        "        var r  = [];\n" +
        "        for (var i = 0; i < value.length; i++) {\n" +
        "            var c = (i < pc.length) ? pc[i] : 100;\n" +
        "            var v = (i < pd.length) ? pd[i] : 100;\n" +
        "            r[i] = (c == 0) ? value[i] : value[i] * v / c;\n" +
        "        }\n" +
        "        res = r;"
    );

    // Z-rotation: у 3D-слоя это zRotation, у 2D — rotation
    var EXPR_ROTZ = expr(
        "        var pr = function (T) {\n" +
        "            try { return P.transform.zRotation.valueAtTime(T); }\n" +
        "            catch (e) { return P.transform.rotation.valueAtTime(T); }\n" +
        "        };\n" +
        "        res = value + pr(time - D) - pr(time);"
    );

    function exprRotAxis(acc) {
        return expr(
            "        res = value + P.transform." + acc + ".valueAtTime(time - D)\n" +
            "                    - P.transform." + acc + ".value;"
        );
    }

    var EXPR_ORIENT = expr(
        "        res = add(value, sub(P.transform.orientation.valueAtTime(time - D),\n" +
        "                             P.transform.orientation.value));"
    );

    // ===== запись =====
    function writeExpr(prop, txt, label, kidName) {
        if (!prop) return 0;
        try { if (!prop.canSetExpression) return 0; } catch (e) { return 0; }
        var cur = "";
        try { cur = prop.expression || ""; } catch (e) {}
        if (cur !== "" && cur.indexOf(MARKER) === -1) {
            warn(kidName + " → " + label + ": уже есть своё выражение, не трогаю");
            return 0;
        }
        try { prop.expression = txt; return 1; }
        catch (e) { warn(kidName + " → " + label + ": " + e.toString()); return 0; }
    }

    app.beginUndoGroup("Delay children (trail)");

    var pDelay = ensureSlider(parentLayer, FX_DELAY, DEF_DELAY);
    if (!pDelay) {
        app.endUndoGroup();
        alert("Не смог добавить слайдер «" + FX_DELAY + "» на родителя.");
        return;
    }

    // что именно анимировано у родителя — то и компенсируем
    var needPos    = chainAnim(parentLayer);   // на позицию влияет ЛЮБАЯ анимация родителя
    var needScale  = animated(tr(parentLayer, "ADBE Scale"));
    var needRotZ   = animated(tr(parentLayer, "ADBE Rotate Z"));
    var needRotX   = animated(tr(parentLayer, "ADBE Rotate X"));
    var needRotY   = animated(tr(parentLayer, "ADBE Rotate Y"));
    var needOrient = animated(tr(parentLayer, "ADBE Orientation"));

    var touched = 0, done = 0, ord = 0;

    for (var kk = 0; kk < kids.length; kk++) {
        var kid  = kids[kk];
        var name = kid.name;
        ord++;

        var mult = ensureSlider(kid, FX_MULT, ord);
        if (!mult) { warn(name + ": нельзя добавить эффект (камера/свет) — пропущен"); continue; }

        var n = 0;

        if (needPos) {
            var pos  = tr(kid, "ADBE Position");
            var sepd = false;
            try { sepd = pos ? pos.dimensionsSeparated : false; } catch (e) {}
            if (sepd) warn(name + ": Position с раздельными измерениями — пропущен");
            else      n += writeExpr(pos, EXPR_POS, "Position", name);
        }
        if (needScale)  n += writeExpr(tr(kid, "ADBE Scale"),       EXPR_SCALE,               "Scale",       name);
        if (needRotZ)   n += writeExpr(tr(kid, "ADBE Rotate Z"),    EXPR_ROTZ,                "Rotation",    name);
        if (needRotX)   n += writeExpr(tr(kid, "ADBE Rotate X"),    exprRotAxis("xRotation"), "X Rotation",  name);
        if (needRotY)   n += writeExpr(tr(kid, "ADBE Rotate Y"),    exprRotAxis("yRotation"), "Y Rotation",  name);
        if (needOrient) n += writeExpr(tr(kid, "ADBE Orientation"), EXPR_ORIENT,              "Orientation", name);

        touched += n;
        if (n > 0) done++;
    }

    app.endUndoGroup();

    // ===== отчёт =====
    var msg = "Родитель: " + parentLayer.name + "\n" +
              "Детей обработано: " + done + " из " + kids.length + "\n" +
              "Выражений навешено: " + touched + "\n\n" +
              "«" + FX_DELAY + "» на нуле — шаг задержки (сейчас " + DEF_DELAY + " кадра).\n" +
              "«" + FX_MULT + "» на каждом ребёнке — множитель (1, 2, 3…).\n" +
              "Alt+клик по кнопке — снять всё.";
    if (warnings.length) {
        msg += "\n\n--- предупреждения ---\n" + warnings.join("\n");
    }
    alert(msg);

})();
