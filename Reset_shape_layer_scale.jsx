/* @ae-script
name:  Reset shape Scale → 100%
desc:  Сбрасывает Scale шейпового слоя (и всех групп/шейпов внутри) в 100%, запекая масштаб в геометрию: пути, Size/Position прямоугольников-эллипсов-звёзд, толщину и штрихи обводки, радиусы Round Corners, точки градиента, трансформы вложенных групп и Repeater. Визуально слой не меняется. Однородный статичный Scale — точно; неоднородный/анимированный — с предупреждением.
prep:  |
  - Открыть композицию
  - Выделить один или несколько шейповых слоёв
  - Scale лучше без ключей/выражений (анимированный оставляется как есть)
tags:  shape, scale, transform, bake
*/

(function () {
    if (!app.project) { alert("Нет открытого проекта."); return; }

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        alert("Активный элемент должен быть композицией.");
        return;
    }

    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) { alert("Выдели хотя бы один шейповый слой."); return; }

    // --- глобальное состояние прогона -----------------------------------
    var warnings = [];
    var nonUniform = false;
    var negScale = false;
    function warn(msg) { warnings.push(msg); }

    // --- утилиты записи значений (учитывают ключи и выражения) -----------
    function transformProp(prop, fn, name) {
        if (!prop) return;
        try { if (prop.expression && prop.expressionEnabled) { warn("выражение на «" + name + "» — не тронуто"); return; } } catch (e) {}
        try {
            var n = 0; try { n = prop.numKeys; } catch (e) {}
            if (n > 0) {
                for (var k = 1; k <= n; k++) prop.setValueAtTime(prop.keyTime(k), fn(prop.keyValue(k)));
            } else {
                prop.setValue(fn(prop.value));
            }
        } catch (e) { warn("не смог изменить «" + name + "»: " + e.toString()); }
    }

    function scale2D(prop, fx, fy) {
        if (!prop) return;
        transformProp(prop, function (v) {
            var r = []; for (var i = 0; i < v.length; i++) r[i] = v[i];
            r[0] = v[0] * fx; r[1] = v[1] * fy; return r;
        }, prop.name);
    }

    function scale1D(prop, f) {
        if (!prop) return;
        transformProp(prop, function (v) { return v * f; }, prop.name);
    }

    function scalePath(prop, fx, fy) {
        if (!prop) return;
        transformProp(prop, function (sh) {
            var ns = new Shape();
            ns.closed = sh.closed;
            var v = sh.vertices, it = sh.inTangents, ot = sh.outTangents;
            var nv = [], ni = [], no = [], i;
            for (i = 0; i < v.length; i++)  nv.push([v[i][0] * fx, v[i][1] * fy]);
            for (i = 0; i < it.length; i++) ni.push([it[i][0] * fx, it[i][1] * fy]);
            for (i = 0; i < ot.length; i++) no.push([ot[i][0] * fx, ot[i][1] * fy]);
            ns.vertices = nv; ns.inTangents = ni; ns.outTangents = no;
            return ns;
        }, prop.name);
    }

    // среднее геометрическое — для скалярных величин (толщина, радиус) при неоднородном скейле
    function avgF(fx, fy) { return Math.sqrt(Math.abs(fx * fy)); }

    function scaleDashes(strokeProp, f) {
        var d; try { d = strokeProp.property("ADBE Vector Stroke Dashes"); } catch (e) { return; }
        if (!d) return;
        for (var i = 1; i <= d.numProperties; i++) {
            var dp = d.property(i);
            try { if (dp.propertyValueType === PropertyValueType.OneD) scale1D(dp, f); } catch (e) {}
        }
    }

    // --- ЗАПЕКАНИЕ: масштабирует всю геометрию контента вокруг локального
    //     начала координат на (fx, fy). Значения Scale групп НЕ трогает —
    //     их сбрасывает resetContainer отдельным проходом.
    function scaleContent(vGroup, fx, fy) {
        for (var i = 1; i <= vGroup.numProperties; i++) {
            var p = vGroup.property(i);
            var mn = p.matchName;

            if (mn === "ADBE Vector Group") {
                var tg = p.property("ADBE Vector Transform Group");
                scale2D(tg.property("ADBE Vector Position"), fx, fy);
                scale2D(tg.property("ADBE Vector Anchor"),   fx, fy);
                scaleContent(p.property("ADBE Vectors Group"), fx, fy);

            } else if (mn === "ADBE Vector Shape - Group") {          // Path
                scalePath(p.property("ADBE Vector Shape"), fx, fy);

            } else if (mn === "ADBE Vector Shape - Rect") {
                scale2D(p.property("ADBE Vector Rect Size"),     fx, fy);
                scale2D(p.property("ADBE Vector Rect Position"), fx, fy);
                scale1D(p.property("ADBE Vector Rect Roundness"), avgF(fx, fy));

            } else if (mn === "ADBE Vector Shape - Ellipse") {
                scale2D(p.property("ADBE Vector Ellipse Size"),     fx, fy);
                scale2D(p.property("ADBE Vector Ellipse Position"), fx, fy);

            } else if (mn === "ADBE Vector Shape - Star") {
                scale2D(p.property("ADBE Vector Star Position"),     fx, fy);
                scale1D(p.property("ADBE Vector Star Inner Radius"), avgF(fx, fy));
                scale1D(p.property("ADBE Vector Star Outer Radius"), avgF(fx, fy));

            } else if (mn === "ADBE Vector Graphic - Stroke" || mn === "ADBE Vector Graphic - G-Stroke") {
                scale1D(p.property("ADBE Vector Stroke Width"), avgF(fx, fy));
                scaleDashes(p, avgF(fx, fy));
                if (mn === "ADBE Vector Graphic - G-Stroke") {
                    scale2D(p.property("ADBE Vector Grad Start Pt"), fx, fy);
                    scale2D(p.property("ADBE Vector Grad End Pt"),   fx, fy);
                }

            } else if (mn === "ADBE Vector Graphic - G-Fill") {
                scale2D(p.property("ADBE Vector Grad Start Pt"), fx, fy);
                scale2D(p.property("ADBE Vector Grad End Pt"),   fx, fy);

            } else if (mn === "ADBE Vector Filter - RC") {            // Round Corners
                scale1D(p.property("ADBE Vector RoundCorner Radius"), avgF(fx, fy));

            } else if (mn === "ADBE Vector Filter - Offset") {        // Offset Paths
                scale1D(p.property("ADBE Vector Offset Amount"), avgF(fx, fy));

            } else if (mn === "ADBE Vector Filter - Zigzag") {        // Zig Zag
                scale1D(p.property("ADBE Vector Zigzag Size"), avgF(fx, fy));

            } else if (mn === "ADBE Vector Filter - Roughen") {       // Wiggle Paths
                scale1D(p.property("ADBE Vector Roughen Size"), avgF(fx, fy));

            } else if (mn === "ADBE Vector Filter - Twist") {
                scale2D(p.property("ADBE Vector Twist Center"), fx, fy);

            } else if (mn === "ADBE Vector Filter - Repeater") {
                var rt = p.property("ADBE Vector Repeater Transform");
                if (rt) {
                    scale2D(rt.property("ADBE Vector Repeater Anchor Point"), fx, fy);
                    scale2D(rt.property("ADBE Vector Repeater Position"),     fx, fy);
                }

            } else if (mn === "ADBE Vector Graphic - Fill" ||
                       mn === "ADBE Vector Filter - Merge" ||
                       mn === "ADBE Vector Filter - Trim"  ||
                       mn === "ADBE Vector Filter - PB") {
                // нет геометрии, зависящей от масштаба

            } else if (mn === "ADBE Vector Filter - Wiggler") {       // Wiggle Transform
                warn("«Wiggle Transform» не пересчитан — проверь визуально");

            } else {
                warn("незнакомый элемент «" + p.name + "» (" + mn + ") — не пересчитан");
            }
        }
    }

    // --- СБРОС: у контейнера читаем Scale, запекаем его в контент, ставим
    //     100%, затем рекурсивно сбрасываем вложенные группы.
    function resetContainer(transform, contents, keys, label) {
        var sp = transform.property(keys.scale);
        var ap = transform.property(keys.anchor);
        var sv = sp.value;
        var fx = sv[0] / 100, fy = sv[1] / 100;

        var animated = false;
        try { animated = (sp.numKeys > 0) || (sp.expression && sp.expressionEnabled); } catch (e) {}

        if (animated) {
            warn("Scale анимирован/выражение на «" + label + "» — оставлен как есть");
        } else if (Math.abs(fx - 1) > 1e-7 || Math.abs(fy - 1) > 1e-7) {
            if (Math.abs(fx - fy) > 1e-6) nonUniform = true;
            if (fx < 0 || fy < 0) negScale = true;
            scaleContent(contents, fx, fy);      // запекаем масштаб этого контейнера в его контент
            scale2D(ap, fx, fy);                 // якорь контейнера — в его же системе координат
            var reset = []; for (var i = 0; i < sv.length; i++) reset.push(100);
            try { sp.setValue(reset); } catch (e) { warn("не смог сбросить Scale «" + label + "»: " + e.toString()); }
        }

        // вложенные группы — их собственный Scale сбрасываем отдельно
        for (var j = 1; j <= contents.numProperties; j++) {
            var p = contents.property(j);
            if (p.matchName === "ADBE Vector Group") {
                resetContainer(
                    p.property("ADBE Vector Transform Group"),
                    p.property("ADBE Vectors Group"),
                    { scale: "ADBE Vector Scale", anchor: "ADBE Vector Anchor" },
                    p.name
                );
            }
        }
    }

    // --- сбор шейповых слоёв --------------------------------------------
    var shapeLayers = [];
    for (var i = 0; i < sel.length; i++) {
        if (sel[i].matchName === "ADBE Vector Layer") shapeLayers.push(sel[i]);
    }
    if (shapeLayers.length === 0) { alert("Среди выделенных нет шейповых слоёв."); return; }

    app.beginUndoGroup("Reset shape Scale → 100%");
    try {
        for (var s = 0; s < shapeLayers.length; s++) {
            var L = shapeLayers[s];
            resetContainer(
                L.property("ADBE Transform Group"),
                L.property("ADBE Root Vectors Group"),
                { scale: "ADBE Scale", anchor: "ADBE Anchor Point" },
                L.name
            );
        }
    } catch (e) {
        alert("Ошибка: " + e.toString());
    }
    app.endUndoGroup();

    // --- отчёт (только если есть что сказать) ---------------------------
    var report = [];
    if (nonUniform) report.push("• Обнаружен неоднородный Scale (X≠Y): пути/Size пересчитаны по осям, но толщина обводки и радиусы взяты усреднённо, а при поворотах групп возможны отклонения. Проверь визуально.");
    if (negScale)   report.push("• Обнаружен отрицательный Scale (отражение) — проверь визуально.");
    for (var w = 0; w < warnings.length; w++) report.push("• " + warnings[w]);

    if (report.length > 0) {
        alert("Готово, но с оговорками:\n\n" + report.join("\n"));
    }
})();
