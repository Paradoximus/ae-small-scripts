/* @ae-script
name:  📌 2D ↔ 3D below (Position)
desc:  Тумблер. Непривязанный 2D-слой прибивает к экранной позиции 3D-слоя, лежащего прямо под ним (выражение на Position, toComp() через активную камеру). Уже привязанный — отвязывает, запекая текущую позицию в статическое значение, так что слой остаётся ровно там, где стоял. Остальные трансформы (Scale/Rotation/Opacity) не трогаются; привязку соседней кнопки «Position + Scale» отвязывает целиком. Молчаливый: если слой не 2D, если под ним не 3D-слой, если ничего не выделено — просто ничего не делает.
prep:  |
  - Открыть композицию
  - Привязать: выделить 2D-слой, прямо под которым лежит 3D-слой
  - Отвязать: выделить уже привязанный слой, встать на нужный кадр
tags:  layers, position, expression, 3d, toggle
*/

// Тумблер привязки 2D-слоя к 3D-слою на строку ниже — только Position.
// Никаких alert'ов: невалидная ситуация = тихий no-op.

(function () {
    if (!app.project) return;

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) return;

    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) return;

    // Метка внутри выражения — единственный признак «этот слой привязан нами».
    // Она же первой строкой уезжает в exprHead().
    var MARK = "@pin-2d-to-3d";

    // 3D-источник: обычный слой с включённым 3D, либо свет (он 3D по природе,
    // но AVLayer.threeDLayer у него в API нет). Камеру не берём — проекция
    // камеры через саму себя вырождена.
    function is3D(layer) {
        if (typeof LightLayer !== "undefined" && layer instanceof LightLayer) return true;
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

    // Общая часть: точка привязки источника в системе координат этого слоя.
    // toComp() гонит точку через активную камеру — это и есть «экранная позиция».
    // Собственный parent 2D-слоя учитываем: Position живёт в системе родителя.
    function exprHead(ref) {
        return "// " + MARK + "\n" +
               "var src = " + ref + ";\n" +
               "var p = src.toComp(src.anchorPoint);\n" +
               "if (hasParent) p = parent.fromComp(p);\n";
    }

    // Все ипостаси Position разом: объединённая + обе разделённые оси.
    // Разделённые проверяем всегда — метка могла остаться на них после того,
    // как Separate Dimensions выключили уже поверх привязки.
    // Плюс Scale: его привязывает соседняя кнопка «Position + Scale»
    // (метка @pin-2d-to-3d-scale содержит нашу), и отвязка здесь снимает
    // её привязку целиком, а не оставляет слой масштабироваться без позиции.
    // Привязка этой кнопки Scale не трогает.
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

    function ourExpression(prop) {
        var e = "";
        try { e = prop.expression; } catch (err) { return false; }
        return !!e && e.indexOf(MARK) !== -1;
    }

    function isPinned(props) {
        for (var i = 0; i < props.length; i++) {
            if (ourExpression(props[i])) return true;
        }
        return false;
    }

    // Отвязка. Значения читаем ДО правок: prop.value при живом выражении — это
    // уже результат выражения на текущем времени, то есть привязанная позиция.
    function unpin(props) {
        var jobs = [], i;
        for (i = 0; i < props.length; i++) {
            if (!ourExpression(props[i])) continue;
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

    app.beginUndoGroup("Toggle pin 2D to 3D below");

    for (var s = 0; s < sel.length; s++) {
        var L = sel[s];
        if (!is2D(L)) continue;

        var tr = L.property("ADBE Transform Group");
        if (!tr) continue;

        var props = pinProps(tr);

        // Привязан — отвязываем. 3D-слой снизу для этого не нужен: его могли
        // увести, переименовать или удалить уже после привязки.
        if (isPinned(props)) {
            unpin(props);
            continue;
        }

        if (L.index >= comp.numLayers) continue;      // под слоем ничего нет

        var src = comp.layer(L.index + 1);
        if (!is3D(src)) continue;

        var head = exprHead(layerRef(src));

        try {
            if (tr.property("ADBE Position").dimensionsSeparated) {
                // Separate Dimensions — по одному выражению на ось, каждое отдаёт число
                tr.property("ADBE Position_0").expression = head + "p[0]";
                tr.property("ADBE Position_1").expression = head + "p[1]";
            } else {
                // Position 2D-слоя двумерна — из трёхкомпонентного toComp берём X/Y
                tr.property("ADBE Position").expression = head + "[p[0], p[1]]";
            }
        } catch (e) {
            // залоченный слой, залоченное свойство и прочее — молча мимо
        }
    }

    app.endUndoGroup();   // пустая группа undo-шага не создаёт
})();
