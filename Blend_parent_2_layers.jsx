/* @ae-script
name:  🔀 Blend parent (A ↔ B)
desc:  Из двух выделенных 3D-слоёв делает новый 3D-нуль, «запаренченный» сразу к обоим с весом. Слайдер Blend = 0 — нуль целиком повторяет мировой трансформ первого слоя, 1 — второго, между ними линейная интерполяция позиции, масштаба и поворота (поворот — slerp по кратчайшему пути). Родители у A и B учитываются. Свои слои вешай на этот нуль парентингом, как на обычного родителя. Цели можно перевыбрать в Layer Control «Parent A» / «Parent B».
prep:  |
  - Открыть композицию
  - Выделить ровно два 3D-слоя: первый выделенный — A (Blend 0), второй — B (Blend 1)
  - Созданный нуль самого ни к чему не парентить: его трансформ считается в мировых координатах
tags:  parent, blend, constraint, 3d, null, expression
*/

(function () {

    // ===== конфиг =====
    var MARKER = "@blend-parent";
    var FX_T   = "Blend";        // слайдер 0..1 (можно и за пределы — экстраполяция)
    var FX_A   = "Parent A";     // Layer Control -> цель при Blend = 0
    var FX_B   = "Parent B";     // Layer Control -> цель при Blend = 1
    var TR     = "ADBE Transform Group";
    var FXP    = "ADBE Effect Parade";

    // ===== проверки контекста =====
    if (!app.project) { alert("Нет открытого проекта."); return; }

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        alert("Активный элемент должен быть композицией.");
        return;
    }

    var sel = comp.selectedLayers;
    if (!sel || sel.length !== 2) {
        alert("Выдели ровно два 3D-слоя.\nПервый выделенный — A (Blend 0), второй — B (Blend 1).");
        return;
    }

    // у камер и светов threeDLayer нет (undefined) — они сюда не пройдут
    function is3D(L) {
        try { return L.threeDLayer === true; } catch (e) { return false; }
    }

    var bad = [];
    for (var i = 0; i < sel.length; i++) {
        if (!is3D(sel[i])) bad.push("«" + sel[i].name + "»");
    }
    if (bad.length) {
        alert("Не 3D-слой: " + bad.join(", ") + "\n\nНужны два 3D-слоя (нуль, солид, шейп, текст — не камера и не свет).");
        return;
    }

    var A = sel[0], B = sel[1];

    // ===== выражения =====
    // Мировая рамка слоя снимается через toWorld — так в неё автоматически входит вся
    // цепочка родителей. Опорная точка = anchor слоя в мире (вокруг неё и крутится слой),
    // оси = образы единичных векторов слоя. Из осей — масштаб (длины) и поворот (кватернион).
    // Бленд: опорная точка, anchor и масштаб — lerp, поворот — slerp. Нуль получает
    // Anchor = lerp анкеров целей, тогда при Blend 0/1 его матрица совпадает с матрицей
    // цели точно, и дети нуля ведут себя ровно как дети A/B.
    // Orientation собирается как Rx·Ry·Rz (порядок AE), X/Y/Z Rotation нуля держатся в 0.
    var LIB = [
        "function bpDot(p, q) { return p[0] * q[0] + p[1] * q[1] + p[2] * q[2]; }",
        "function bpCross(p, q) { return [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]; }",
        "function bpLerp(p, q, k) { var r = []; for (var i = 0; i < p.length; i++) r[i] = p[i] + (q[i] - p[i]) * k; return r; }",
        "",
        "// матрица поворота (столбцы x, y, z) -> кватернион [w, x, y, z]",
        "function bpQuat(x, y, z) {",
        "    var m00 = x[0], m11 = y[1], m22 = z[2], tr = m00 + m11 + m22, S;",
        "    if (tr > 0) {",
        "        S = Math.sqrt(tr + 1) * 2;",
        "        return [S / 4, (y[2] - z[1]) / S, (z[0] - x[2]) / S, (x[1] - y[0]) / S];",
        "    }",
        "    if (m00 > m11 && m00 > m22) {",
        "        S = Math.sqrt(1 + m00 - m11 - m22) * 2;",
        "        return [(y[2] - z[1]) / S, S / 4, (y[0] + x[1]) / S, (z[0] + x[2]) / S];",
        "    }",
        "    if (m11 > m22) {",
        "        S = Math.sqrt(1 + m11 - m00 - m22) * 2;",
        "        return [(z[0] - x[2]) / S, (y[0] + x[1]) / S, S / 4, (z[1] + y[2]) / S];",
        "    }",
        "    S = Math.sqrt(1 + m22 - m00 - m11) * 2;",
        "    return [(x[1] - y[0]) / S, (z[0] + x[2]) / S, (z[1] + y[2]) / S, S / 4];",
        "}",
        "",
        "// мировая рамка слоя: a — anchor (в системе слоя), p — anchor в мире,",
        "// s — масштаб по осям (1 = 100%), q — поворот (null, если масштаб схлопнут в 0)",
        "function bpFrame(L) {",
        "    var a = L.transform.anchorPoint.value;",
        "    a = [a[0], a[1], (a.length > 2 ? a[2] : 0)];",
        "    var o = L.toWorld(a), K = 100;",
        "    function axis(n) {",
        "        var pt = [a[0], a[1], a[2]];",
        "        pt[n] += K;",
        "        var w = L.toWorld(pt);",
        "        return [(w[0] - o[0]) / K, (w[1] - o[1]) / K, (w[2] - o[2]) / K];",
        "    }",
        "    var U = axis(0), V = axis(1), W = axis(2);",
        "    var s = [Math.sqrt(bpDot(U, U)), Math.sqrt(bpDot(V, V)), Math.sqrt(bpDot(W, W))];",
        "    var q = null;",
        "    if (s[0] > 1e-6 && s[1] > 1e-6) {",
        "        var x = [U[0] / s[0], U[1] / s[0], U[2] / s[0]];",
        "        var d = bpDot(V, x);",
        "        var y = [V[0] - x[0] * d, V[1] - x[1] * d, V[2] - x[2] * d];",
        "        var n = Math.sqrt(bpDot(y, y));",
        "        if (n > 1e-9) {",
        "            y = [y[0] / n, y[1] / n, y[2] / n];",
        "            var z = bpCross(x, y);",
        "            if (bpDot(z, W) < 0) s[2] = -s[2];   // зеркало: отрицательный масштаб",
        "            q = bpQuat(x, y, z);",
        "        }",
        "    }",
        "    return { a: a, p: o, s: s, q: q };",
        "}",
        "",
        "// slerp по кратчайшему пути; у цели со схлопнутым масштабом берётся поворот другой",
        "function bpSlerp(qa, qb, k) {",
        "    if (!qa) qa = qb || [1, 0, 0, 0];",
        "    if (!qb) qb = qa;",
        "    var d = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3];",
        "    if (d < 0) { qb = [-qb[0], -qb[1], -qb[2], -qb[3]]; d = -d; }",
        "    var ka = 1 - k, kb = k;",
        "    if (d < 0.9995) {",
        "        var th = Math.acos(d), sn = Math.sin(th);",
        "        ka = Math.sin((1 - k) * th) / sn;",
        "        kb = Math.sin(k * th) / sn;",
        "    }",
        "    var q = [ka * qa[0] + kb * qb[0], ka * qa[1] + kb * qb[1], ka * qa[2] + kb * qb[2], ka * qa[3] + kb * qb[3]];",
        "    var n = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);",
        "    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];",
        "}",
        "",
        "// кватернион -> Orientation AE (градусы), R = Rx(a)·Ry(b)·Rz(c)",
        "function bpOrient(q) {",
        "    var w = q[0], X = q[1], Y = q[2], Z = q[3];",
        "    var m00 = 1 - 2 * (Y * Y + Z * Z), m01 = 2 * (X * Y - w * Z), m02 = 2 * (X * Z + w * Y);",
        "    var m10 = 2 * (X * Y + w * Z), m11 = 1 - 2 * (X * X + Z * Z);",
        "    var m12 = 2 * (Y * Z - w * X), m22 = 1 - 2 * (X * X + Y * Y);",
        "    var sb = Math.max(-1, Math.min(1, m02)), b = Math.asin(sb), a, c;",
        "    if (Math.cos(b) > 1e-6) {",
        "        a = -Math.atan2(m12, m22);",
        "        c = -Math.atan2(m01, m00);",
        "    } else {",
        "        a = Math.atan2(sb * m10, m11);   // гимбал: X и Z крутят вокруг одной оси",
        "        c = 0;",
        "    }",
        "    var D = 180 / Math.PI;",
        "    return [a * D, b * D, c * D];",
        "}"
    ].join("\n");

    function expr(label, body) {
        return [
            "// " + MARKER + " — " + label + " (Small Scripts: Blend parent)",
            LIB,
            "",
            "var res = value;",
            "try {",
            "    var k  = effect('" + FX_T + "')(1).value;",
            "    var FA = bpFrame(effect('" + FX_A + "')(1));",
            "    var FB = bpFrame(effect('" + FX_B + "')(1));",
            "    var r  = " + body + ";",
            "    var ok = true;",
            "    for (var i = 0; i < r.length; i++) if (!(r[i] > -1e9 && r[i] < 1e9)) ok = false;   // NaN / Infinity",
            "    if (ok) res = r;",
            "} catch (err) { res = value; }",
            "res"
        ].join("\n");
    }

    function exprZero(label) {
        return "// " + MARKER + " — " + label + ": весь поворот идёт через Orientation\n0";
    }

    var PROPS = [
        { mn: "ADBE Anchor Point", label: "Anchor Point", txt: expr("Anchor Point", "bpLerp(FA.a, FB.a, k)") },
        { mn: "ADBE Position",     label: "Position",     txt: expr("Position",     "bpLerp(FA.p, FB.p, k)") },
        { mn: "ADBE Scale",        label: "Scale",        txt: expr("Scale",        "(function (s) { return [s[0] * 100, s[1] * 100, s[2] * 100]; })(bpLerp(FA.s, FB.s, k))") },
        { mn: "ADBE Orientation",  label: "Orientation",  txt: expr("Orientation",  "bpOrient(bpSlerp(FA.q, FB.q, k))") },
        { mn: "ADBE Rotate X",     label: "X Rotation",   txt: exprZero("X Rotation") },
        { mn: "ADBE Rotate Y",     label: "Y Rotation",   txt: exprZero("Y Rotation") },
        { mn: "ADBE Rotate Z",     label: "Z Rotation",   txt: exprZero("Z Rotation") }
    ];

    // ===== утилиты =====
    function uniqueName(base) {
        var used = {};
        for (var u = 1; u <= comp.numLayers; u++) used[comp.layer(u).name] = true;
        if (!used[base]) return base;
        for (var n = 2; n < 10000; n++) if (!used[base + " " + n]) return base + " " + n;
        return base;
    }

    // ===== создание =====
    var warnings = [];

    app.beginUndoGroup("Blend parent (A ↔ B)");

    var C = comp.layers.addNull(comp.duration);
    C.threeDLayer = true;
    C.name = uniqueName("Blend " + A.name + " / " + B.name);
    C.comment = MARKER + " — бленд-родитель (Small Scripts)";
    C.moveBefore(A.index < B.index ? A : B);   // временный index 1 уже ушёл, индексы A/B снова честные

    // ссылки на эффекты перечитываются после каждого addProperty —
    // добавление в группу инвалидирует ранее взятые ссылки на соседей
    C.property(FXP).addProperty("ADBE Slider Control").name = FX_T;
    C.property(FXP).addProperty("ADBE Layer Control").name = FX_A;
    C.property(FXP).addProperty("ADBE Layer Control").name = FX_B;
    var fx = C.property(FXP);
    fx.property(FX_T).property(1).setValue(0);
    fx.property(FX_A).property(1).setValue(A.index);
    fx.property(FX_B).property(1).setValue(B.index);

    var tg = C.property(TR);
    for (var p = 0; p < PROPS.length; p++) {
        try { tg.property(PROPS[p].mn).expression = PROPS[p].txt; }
        catch (e) { warnings.push(PROPS[p].label + ": " + e.toString()); }
    }

    for (var s = 0; s < sel.length; s++) sel[s].selected = false;
    C.selected = true;

    app.endUndoGroup();

    if (warnings.length) {
        alert("Нуль «" + C.name + "» создан, но не всё навесилось:\n\n" + warnings.join("\n"));
    }

})();
