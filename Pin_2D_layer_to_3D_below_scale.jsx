/* @ae-script
name:  📌 2D ↔ 3D below (Position + Scale)
desc:  Как «📌 2D ↔ 3D below (Position)», но 2D-слой ещё и масштабируется вслед за видимым через камеру размером 3D-слоя под ним: подъезд камеры, её зум, уход слоя в глубину, Scale самого 3D-слоя и его родителей. Повороты 3D-слоя на размер не влияют. На кадре привязки размер 2D-слоя остаётся каким был — это кадр калибровки. Тумблер: привязанный с Scale — отвязывает, запекая Position и Scale текущего кадра; привязанный только по Position (соседней кнопкой) — докручивает Scale. Молчаливый, как и соседняя.
prep:  |
  - Открыть композицию
  - Привязать: выделить 2D-слой, прямо под которым лежит 3D-слой, и встать на кадр, где размер 2D-слоя выставлен как надо
  - Отвязать: выделить привязанный слой, встать на нужный кадр
tags:  layers, position, scale, expression, 3d, camera, toggle
*/

// Тумблер привязки 2D-слоя к 3D-слою на строку ниже — Position + Scale.
// Position — ровно как у соседней кнопки (Pin_2D_layer_to_3D_below.jsx),
// Scale — вслед за видимым через камеру размером 3D-слоя. Разбор — NOTES.md.
// Никаких alert'ов: невалидная ситуация = тихий no-op.

(function () {
    if (!app.project) return;

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) return;

    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return;

    // Метки внутри выражений — единственный признак «привязан нами».
    // На Position метка и выражение те же, что у соседней кнопки: для неё
    // слой, привязанный здесь, тоже привязан, и отвязывает она его целиком,
    // вместе со Scale. Метка Scale содержит метку Position как подстроку.
    var MARK = "@pin-2d-to-3d";
    var MARK_SCALE = MARK + "-scale";

    function isLight(layer) {
        return typeof LightLayer !== "undefined" && layer instanceof LightLayer;
    }

    // 3D-источник: обычный слой с включённым 3D, либо свет (он 3D по природе,
    // но AVLayer.threeDLayer у него в API нет). Камеру не берём — проекция
    // камеры через саму себя вырождена.
    function is3D(layer) {
        if (isLight(layer)) return true;
        var f = false;
        try { f = (layer.threeDLayer === true); } catch (e) {}
        return f;
    }

    function is2D(layer) {
        var f = null;
        try { f = layer.threeDLayer; } catch (e) { return false; }
        return (f === false);   // undefined (камера/свет) — не 2D
    }

    // Ссылка на слой в выражении: по имени, если оно уникально в компе,
    // иначе по индексу (имя-дубликат разрезолвится не в тот слой).
    function layerRef(layer) {
        var dupes = 0;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === layer.name) dupes++;
        }
        if (dupes !== 1) return "thisComp.layer(" + layer.index + ")";
        // экранируем имя посимвольно
        var esc = "", n = layer.name;
        for (var c = 0; c < n.length; c++) {
            var ch = n.charAt(c);
            if (ch === "\\" || ch === "\"") esc += "\\";
            esc += ch;
        }
        return "thisComp.layer(\"" + esc + "\")";
    }

    // Точка привязки источника в системе координат этого слоя — как у соседней
    // кнопки. У света нет Anchor Point: начало его координат и есть его позиция.
    function positionHead(ref, light) {
        return "// " + MARK + "\n" +
               "var src = " + ref + ";\n" +
               "var p = src.toComp(" + (light ? "[0, 0, 0]" : "src.anchorPoint") + ");\n" +
               "if (hasParent) p = parent.fromComp(p);\n";
    }

    // Видимый размер источника на текущем кадре → переменная k.
    // Три локальные оси источника проецируются на экран той же toComp(), что
    // и в Position (центральная разность ±1 по каждой оси), и из трёх экранных
    // векторов берётся меньшее сингулярное число. Для 3D-слоя с равномерным
    // Scale это ровно Scale·zoom/глубина: камера, зум, глубина, Scale источника
    // и его родителей входят, поворот источника — нет. Камера явно нигде не
    // упоминается, поэтому работает и без неё — через дефолтную камеру компа.
    function seenExpr(ref, light) {
        return "var src = " + ref + ";\n" +
               "var a = " + (light ? "[0, 0, 0]" : "src.anchorPoint.value") + ";\n" +
               "var ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], xx = 0, yy = 0, xy = 0;\n" +
               "for (var i = 0; i < 3; i++) {\n" +
               "    var d = sub(src.toComp(add(a, ax[i])), src.toComp(sub(a, ax[i])));\n" +
               "    xx += d[0] * d[0]; yy += d[1] * d[1]; xy += d[0] * d[1];\n" +
               "}\n" +
               "var h = (xx + yy) / 2, det = xx * yy - xy * xy;\n" +
               "var k = h > 0 ? Math.sqrt(Math.max(det, 0) / (h + Math.sqrt(Math.max(h * h - det, 0)))) : 0;\n";
    }

    // Рабочее выражение Scale. K0 — видимый размер источника на кадре привязки:
    // там Scale равен своему значению, дальше меняется пропорционально.
    // mul(), а не *: в JS-движке AE операторы на массивах не работают.
    function scaleExpr(ref, light, k0) {
        return "// " + MARK_SCALE + "\n" +
               "// Scale = своё значение × видимый размер 3D-слоя сейчас / на кадре привязки (K0)\n" +
               "var K0 = " + k0 + ";\n" +
               seenExpr(ref, light) +
               "mul(value, k / K0)";
    }

    // Калибровка: видимый размер источника на текущем кадре. toComp в
    // ExtendScript нет — считает сам AE: на Scale ставится пробное выражение,
    // отдающее [k, k], и читается его результат. Метки у пробы нет: вызывающий
    // тут же заменяет её рабочим выражением или прежним. Ошибка → NaN.
    function probeSeen(scale, ref, light) {
        scale.expression = "// временная проба видимого размера (Pin 2D + Scale)\n" +
                           seenExpr(ref, light) + "[k, k]";
        var k = NaN;
        try {
            scale.expressionEnabled = true;   // на Scale могло лежать выключенное выражение
            var v = scale.valueAtTime(comp.time, false);
            if (scale.expressionEnabled && !scale.expressionError) k = v[0];
        } catch (e) {}
        return k;
    }

    // Все свойства, на которых может стоять наша метка: Position во всех
    // ипостасях (объединённая + обе разделённые оси) и Scale. Разделённые оси
    // проверяем всегда — метка могла остаться на них после того, как Separate
    // Dimensions выключили уже поверх привязки.
    function pinProps(tr) {
        var names = ["ADBE Position", "ADBE Position_0", "ADBE Position_1", "ADBE Scale"];
        var out = [];
        for (var i = 0; i < names.length; i++) {
            var p = null;
            try { p = tr.property(names[i]); } catch (e) {}
            if (p) out.push(p);
        }
        return out;
    }

    function ourExpression(prop, mark) {
        var e = "";
        try { e = prop.expression; } catch (err) { return false; }
        return !!e && e.indexOf(mark) !== -1;
    }

    // Отвязка. Значения читаем ДО правок: prop.value при живом выражении — это
    // уже результат выражения на текущем времени, то есть привязанное состояние.
    function unpin(props) {
        var jobs = [], i;
        for (i = 0; i < props.length; i++) {
            if (!ourExpression(props[i], MARK)) continue;
            var v = null;
            try { v = props[i].value; } catch (err) {}
            jobs.push([props[i], v]);
        }
        for (i = 0; i < jobs.length; i++) {
            var prop = jobs[i][0], val = jobs[i][1];
            try {
                prop.expression = "";
                // На ключах setValue бросает исключение — анимацию не ломаем,
                // слой честно возвращается на свои ключи.
                if (val !== null && prop.numKeys === 0) prop.setValue(val);
            } catch (err) {
                // залоченный слой, залоченное свойство и прочее — молча мимо
            }
        }
    }

    app.beginUndoGroup("Toggle pin 2D to 3D below + Scale");

    for (var s = 0; s < sel.length; s++) {
        var L = sel[s];
        if (!is2D(L)) continue;

        var tr = L.property("ADBE Transform Group");
        if (!tr) continue;

        var scale = tr.property("ADBE Scale");
        if (!scale) continue;

        // Привязан с Scale — отвязываем всё. 3D-слой снизу для этого не нужен:
        // его могли увести, переименовать или удалить уже после привязки.
        // Привязанный только по Position (соседней кнопкой) сюда не попадает:
        // ниже он привяжется заново, уже с Scale.
        if (ourExpression(scale, MARK_SCALE)) {
            unpin(pinProps(tr));
            continue;
        }

        if (L.index >= comp.numLayers) continue;      // под слоем ничего нет

        var src = comp.layer(L.index + 1);
        if (!is3D(src)) continue;

        var ref = layerRef(src), light = isLight(src);
        var head = positionHead(ref, light);

        var oldScale = "", oldOn = true;
        try { oldScale = scale.expression; oldOn = scale.expressionEnabled; } catch (e) {}

        try {
            if (tr.property("ADBE Position").dimensionsSeparated) {
                // Separate Dimensions — по одному выражению на ось, каждое отдаёт число
                tr.property("ADBE Position_0").expression = head + "p[0]";
                tr.property("ADBE Position_1").expression = head + "p[1]";
            } else {
                // Position 2D-слоя двумерна — из трёхкомпонентного toComp берём X/Y
                tr.property("ADBE Position").expression = head + "[p[0], p[1]]";
            }

            // Не откалибровалось (3D-слой на этом кадре схлопнут Scale'ом в ноль,
            // ошибка выражения) — Scale возвращаем как был: слой остаётся
            // привязанным только по Position.
            var k0 = probeSeen(scale, ref, light);
            var ok = (k0 > 0 && isFinite(k0));
            scale.expression = ok ? scaleExpr(ref, light, k0) : oldScale;
            if (!ok && oldScale) scale.expressionEnabled = oldOn;
        } catch (e) {
            // залоченный слой, залоченное свойство и прочее — молча мимо
        }
    }

    app.endUndoGroup();   // пустая группа undo-шага не создаёт
})();
