/* @ae-script
name:  🔤 MoGraph text effector
desc:  MoGraph effector для текстового слоя: клонами становятся буквы, слова или строки (меню Clone на эффекторе, переключается вживую). Эффектор тот же, что у слоёв: гайд-шейп с гизмо falloff'а, Position X/Y/Z, Scale %, Rotation X/Y/Z, Opacity %, falloff Sphere / Box / Linear / Infinite с изингом рампы (Linear, Smooth и S-кривые разной крутизны со сдвигом к краю или к центру), Delay Off / Blend / Spring (отставание и пружина реакции на эффектор и движения самого слоя). На слой ставятся три аниматора текста с Expression Selector'ами, исходный текст не трогается. Раскладку букв кнопка меряет и запекает — поправил текст, шрифт или размер: выдели эффектор и нажми снова. Эффектор + текст в выделении — добавить текст к нему. Alt+клик — снять.
prep:  |
  - Открыть композицию
  - Создать: выделить текстовый слой (или несколько)
  - Добавить к готовому: выделить эффектор + текстовые слои
  - Перемерить после правки текста: выделить только эффектор
  - Alt+клик: выделить текстовый слой и/или эффектор — снять
tags:  mograph, effector, text, falloff, delay, spring, expression, animator
*/

(function () {

    // ===== конфиг =====
    var MARK      = "@mgtext";              // метка наших выражений, первой строкой
    var MARK_EFF  = "@mgtext-effector";     // метка слоя-эффектора, в его Comment
    var LINK_BASE = "MG Text";              // Layer Control на текстовом слое -> эффектор; он же префикс аниматоров
    var SEP       = " · ";                  // «MG Text · Position»
    var BASE_NAME = "MG Text Effector";
    var CLONES    = ["Letter", "Word", "Line"];                // в выражениях это 1..3
    var SHAPES    = ["Infinite", "Sphere", "Box", "Linear"];   // 1..4
    var DELAYS    = ["Off", "Blend", "Spring"];                // 1..3
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
    var K_HEAD    = 2;                      // запас амплитуды: Amount селектора режется на ±100%, а Spring перелетает за 1
    var B_POS     = 10000;                  // базис Position-аниматора, px: сдвиг = B_POS · Amount / 100
    var COLOR     = [0.25, 0.8, 1];         // цвет гизмо
    var EFF_ROT   = -90;                    // поворот нового эффектора: у Linear полная сила снизу, ноль сверху
    var TR  = "ADBE Transform Group";
    var FXP = "ADBE Effect Parade";
    var VEC = "ADBE Root Vectors Group";
    var TXT = "ADBE Text Properties";
    var LC  = "ADBE Layer Control";

    // ===== проверки контекста =====
    if (!app.project) { alert("Нет открытого проекта."); return; }

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        alert("Активный элемент должен быть композицией.");
        return;
    }

    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) {
        alert("Выдели текстовый слой (или эффектор + текстовые слои, чтобы добавить их к нему).");
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
        try { return layer.property(FXP); } catch (e) { return null; }
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

    function isText(L) {
        try { return L instanceof TextLayer; } catch (e) { return false; }
    }

    function is3D(L) {
        try { return L.threeDLayer === true; } catch (e) { return false; }
    }

    function textProps(L) { return L.property(TXT); }
    function animators(L) { return textProps(L).property("ADBE Text Animators"); }

    // ===== замер раскладки текста =====
    // Выражения AE не знают, где на экране стоит буква, поэтому раскладку меряет скрипт и
    // запекает её в выражения селекторов. Строки и их базовые линии — из раскладки самого AE
    // (composedLineRange, 24.3+, и baselineLocs). Положение букв внутри строки — замером на
    // временном point-text слое тем же шрифтом: правый край чернил у «префикс строки + H»
    // минус тот же край у одной «H» = перо после префикса, с кернингом, трекингом и пробелами.
    function isBreak(c) { return c === "\r" || c === "\n" || c === "\u0003"; }
    function isSep(c) { return c === " " || c === "\t" || isBreak(c); }
    function r2(x) { return Math.round(x * 100) / 100; }

    var tmpLayer = null;
    function tmpProp() {
        if (!tmpLayer) {
            tmpLayer = comp.layers.addText("H");
            tmpLayer.name = "MG Text — замер (временный)";
        }
        return tmpLayer.property(TXT).property("ADBE Text Document");
    }
    function killTmp() {
        if (tmpLayer) { try { tmpLayer.remove(); } catch (e) {} tmpLayer = null; }
    }

    // Стиль переносится атрибутами, а не копией документа: документ абзацного текста
    // сделал бы и замерочный слой абзацным, с переносами. Смешанный стиль внутри текста
    // не переносится — меряется стилем первого символа.
    var STYLE = ["font", "fontSize", "tracking", "horizontalScale", "fauxBold", "fauxItalic",
                 "allCaps", "smallCaps", "ligature", "autoKernType", "fontCapsOption", "digitSet", "tsume"];

    function measurer(src) {
        var prop = tmpProp(), d = prop.value;
        return function (str) {
            d.text = str;
            for (var i = 0; i < STYLE.length; i++) {
                try { d[STYLE[i]] = src[STYLE[i]]; } catch (e) {}
            }
            try { d.justification = ParagraphJustification.LEFT_JUSTIFY; } catch (e) {}
            prop.setValue(d);
            var r = tmpLayer.sourceRectAtTime(comp.time, false);
            return { right: r.left + r.width, top: r.top, height: r.height };
        };
    }

    function hardLines(s) {
        var out = [], a = 0;
        for (var i = 0; i < s.length; i++) {
            if (isBreak(s.charAt(i))) { out.push([a, i + 1]); a = i + 1; }
        }
        out.push([a, s.length]);
        return out;
    }

    // Отрезки composed lines -> покрытие [0, n) без дыр. Дыры из одних переводов строки
    // (AE может не класть их в строку) приклеиваются к предыдущей. Кривые данные — null.
    function tileLines(raw, s) {
        var n = s.length, out = [], pos = 0;
        for (var j = 0; j < raw.length; j++) {
            var a = raw[j][0], b = raw[j][1];
            if (typeof a !== "number" || typeof b !== "number" || b < a || a < pos || b > n) return null;
            for (var k = pos; k < a; k++) if (!isBreak(s.charAt(k))) return null;
            if (a > pos) {
                if (out.length) out[out.length - 1][1] = a;
                else a = 0;
            }
            out.push([a, b]);
            pos = b;
        }
        for (var k2 = pos; k2 < n; k2++) if (!isBreak(s.charAt(k2))) return null;
        if (!out.length) return null;
        out[out.length - 1][1] = n;
        return out;
    }

    function apiLines(td, s) {
        var cnt = 0;
        try { cnt = td.composedLineCount; } catch (e) { return null; }
        if (!(cnt > 0)) return null;
        var raw = [];
        try {
            for (var j = 0; j < cnt; j++) {
                var r = td.composedLineRange(j);            // конец по умолчанию j + 1
                raw.push([r.characterStart, r.characterEnd]);
            }
        } catch (e) { return null; }
        return tileLines(raw, s);
    }

    // Полная выключка растягивает пробелы: недостачу ширины строки против раскладки AE
    // раздаём внутренним пробелам поровну.
    function justifySpaces(pens, str, last, extra) {
        var first = -1, cnt = 0;
        for (var m = 0; m <= last; m++) {
            var c = str.charAt(m);
            if (!isSep(c)) { if (first < 0) first = m; }
            else if (first >= 0 && !isBreak(c)) cnt++;
        }
        if (cnt === 0) return;
        var per = extra / cnt, add = 0;
        for (var m2 = 0; m2 < str.length; m2++) {
            var c2 = str.charAt(m2);
            if (m2 > first && m2 < last && isSep(c2) && !isBreak(c2)) add += per;
            pens[m2 + 1] += add;
        }
    }

    // -> { n, CH, LN, WD, NR, AL, YC, APG, P3D, notes } — всё в системе слоя
    function bake(T) {
        var notes = [];
        var tp = textProps(T), srcProp = tp.property("ADBE Text Document");
        var td = srcProp.valueAtTime(comp.time, false);
        var s = String(td.text), n = s.length;
        if (n === 0) throw new Error("пустой текст");

        var box = false;
        try { box = (td.boxText === true); } catch (e) {}
        try { if (srcProp.numKeys > 0) notes.push("Source Text анимирован — раскладка снята на текущем кадре"); } catch (e) {}
        try {
            if (comp.time < T.inPoint || comp.time >= T.outPoint) {
                notes.push("на текущем кадре слоя нет — AE мог не отдать раскладку; надёжнее мерить, стоя на кадре, где текст виден");
            }
        } catch (e) {}
        try {
            if (tp.property("ADBE Text Path Options").property("ADBE Text Path").value > 0) {
                notes.push("текст на пути — позиции букв посчитаны без пути, веса будут мимо");
            }
        } catch (e) {}

        var lines = apiLines(td, s);
        if (!lines) {
            lines = hardLines(s);
            if (box) notes.push("абзацный текст, а AE не отдал переносы строк (нужен 24.3+) — строки по абзацам, позиции примерные");
        }

        var locs = null;
        try {
            var bl = td.baselineLocs;
            if (bl && bl.length >= 4) {
                locs = [];
                for (var i = 0; i + 3 < bl.length; i += 4) locs.push([bl[i], bl[i + 1], bl[i + 2], bl[i + 3]]);
            }
        } catch (e) { locs = null; }
        if (locs) {
            while (lines.length > locs.length && lines[lines.length - 1][0] === lines[lines.length - 1][1]) lines.pop();
            if (lines.length !== locs.length) {
                notes.push("строки не сошлись с раскладкой AE — положение строк примерное");
                locs = null;
            }
        }

        var fs = 0, lead = 0, just = null, full = false, JC = -1, JR = -1;
        try { fs = td.fontSize; } catch (e) {}
        try { lead = td.autoLeading ? fs * 1.2 : td.leading; } catch (e) { lead = fs * 1.2; }
        try { just = td.justification; } catch (e) {}
        try {
            var PJ = ParagraphJustification;
            JC = PJ.CENTER_JUSTIFY; JR = PJ.RIGHT_JUSTIFY;
            full = just === PJ.FULL_JUSTIFY_LASTLINE_LEFT || just === PJ.FULL_JUSTIFY_LASTLINE_RIGHT ||
                   just === PJ.FULL_JUSTIFY_LASTLINE_CENTER || just === PJ.FULL_JUSTIFY_LASTLINE_FULL;
        } catch (e) {}
        var bx = 0, by = 0, bw = 0;
        if (box) { try { bx = td.boxTextPos[0]; by = td.boxTextPos[1]; bw = td.boxTextSize[0]; } catch (e) {} }

        var meas = measurer(td);
        var h = meas("H"), rH = h.right;
        var YC = h.top + h.height / 2;           // середина высоты заглавных от базовой линии (минус — вверх)

        var CH = [], LN = [], WD = [], prevY = null;
        for (var j = 0; j < lines.length; j++) {
            var a = lines[j][0], str = s.substring(a, lines[j][1]);
            var pens = [0], acc = "", last = -1;
            for (var m = 0; m < str.length; m++) {
                var c = str.charAt(m);
                if (isBreak(c)) { pens.push(pens[m]); continue; }
                acc += c;
                pens.push(meas(acc + "H").right - rH);
                if (!isSep(c)) last = m;
            }
            var pend = (last >= 0) ? pens[last + 1] : 0;

            // начало строки и базовая линия: из раскладки AE, иначе — по выключке и интерлиньяжу
            var sx, sy, L = locs ? locs[j] : null;
            var fx = (just === JC) ? -pend / 2 : (just === JR) ? -pend : 0;
            if (box) fx = bx + ((just === JC) ? (bw - pend) / 2 : (just === JR) ? bw - pend : 0);
            if (L && Math.abs(L[0]) < 1e30 && Math.abs(L[1]) < 1e30) {
                sx = L[0]; sy = L[1];
                var extra = (L[2] - L[0]) - pend;
                if (full && last >= 0 && extra > 0.02 * pend) justifySpaces(pens, str, last, extra);
            } else if (prevY !== null) {
                sx = fx; sy = prevY + lead;                // пустая строка
            } else {
                sx = fx; sy = box ? by + fs * 0.8 + lead * j : lead * j;
            }
            prevY = sy;

            var lx0 = null, lx1 = null, inWord = false;
            for (var m2 = 0; m2 < str.length; m2++) {
                var c2 = str.charAt(m2), x0 = sx + pens[m2], x1 = sx + pens[m2 + 1], wi = -1;
                if (!isSep(c2)) {
                    if (!inWord) { WD.push(x0, x1); inWord = true; }
                    WD[WD.length - 1] = x1;
                    wi = WD.length / 2 - 1;
                    lx0 = (lx0 === null) ? x0 : Math.min(lx0, x0);
                    lx1 = (lx1 === null) ? x1 : Math.max(lx1, x1);
                } else {
                    inWord = false;
                }
                CH.push(x0, x1, j, wi);
            }
            LN.push(sy, (lx0 === null) ? sx : lx0, (lx1 === null) ? sx : lx1);
        }

        // опора группировки All: середина всего текста по X, средняя базовая линия
        var ax0 = null, ax1 = null, ys = 0, yn = 0;
        for (var q = 0; q < LN.length; q += 3) {
            if (LN[q + 1] === LN[q + 2]) continue;
            ax0 = (ax0 === null) ? LN[q + 1] : Math.min(ax0, LN[q + 1]);
            ax1 = (ax1 === null) ? LN[q + 2] : Math.max(ax1, LN[q + 2]);
            ys += LN[q]; yn++;
        }
        var AL = [(ax0 === null) ? 0 : (ax0 + ax1) / 2, yn ? ys / yn : 0];

        var NR = [];
        for (var k = 0; k < n; k++) if (!isBreak(s.charAt(k))) NR.push(k);

        var apg = 1;
        try { apg = tp.property("ADBE Text More Options").property("ADBE Text Anchor Point Option").value; } catch (e) {}
        if (apg === 4) notes.push("Anchor Point Grouping = All — опора группы клона примерная, лучше Character");
        var p3d = false;
        try { p3d = (T.threeDPerChar === true); } catch (e) {}

        function round(arr, ints) {        // ints — шаг записи, в котором стоят целые (строка, слово)
            for (var z = 0; z < arr.length; z++) if (!ints || z % 4 < 2) arr[z] = r2(arr[z]);
            return arr;
        }
        return {
            n: n, CH: round(CH, true), LN: round(LN), WD: round(WD), NR: NR, AL: round(AL),
            YC: r2(YC), APG: apg, P3D: p3d, notes: notes
        };
    }

    // ===== выражения =====
    // Каждый аниматор — одно свойство (или группа) + Expression Selector на Characters.
    // Селектор выполняется для каждой буквы; клон (буква / слово / строка) выбирается меню
    // Clone на эффекторе, и все буквы клона берут вес из одной точки — его центра.
    //
    // Опора поворота и масштаба. У AE она задаётся Anchor Point Grouping слоя и выражениям
    // недоступна. Её не трогаем: разницу между опорой AE (a) и опорой клона (p) доливает
    // Position-аниматор, сдвигом (M − I)(a − p), где M — поворот·масштаб клона при его весе.
    // Так слово крутится целиком вокруг своего центра, а Clone переключается без кнопки.
    //
    // Запас амплитуды. Amount селектора AE режет на ±100%, а вес со Spring или Strength > 100
    // вылезает за 1. Поэтому Scale/Rotation аниматора — это K × параметр эффектора, а Amount —
    // вес / K; у Position аниматор держит базис B, а Amount = сдвиг / B, по осям отдельно.
    // Opacity всё равно режется в 0–100, ему запас не нужен — он отдельным аниматором.
    //
    // Delay/Spring: история по окну прошлых кадров, как у эффектора слоёв (см. NOTES.md).
    // Вес в прошлом считается прямо в селекторе, без valueAtTime чужих выражений. Движение
    // самого слоя (ключи трансформа, родитель) задерживается в Position — клон отстаёт целиком.
    var DELAYED =
        "function delayed(f) {                     // Delay/Spring над f(t) по окну истории\n" +
        "    var mode = 1, T = 0, bounce = 0;\n" +
        "    try {\n" +
        "        mode = Math.round(E.effect(\"Delay mode\")(1).value);    // 1 Off, 2 Blend, 3 Spring\n" +
        "        T = Math.max(0, E.effect(\"Delay (frames)\")(1).value);\n" +
        "        bounce = clamp(E.effect(\"Spring bounce %\")(1).value, 0, 100) / 100;\n" +
        "    } catch (err) { mode = 1; }\n" +
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
        "function ramp(d, a, b, e) {               // e — пункт меню Falloff ease\n" +
        "    if (d <= a) return 1;\n" +
        "    if (d >= b) return 0;\n" +
        "    var u = (b - d) / (b - a);              // 0 на внешней границе, 1 на внутренней\n" +
        "    var s = [" + RAMP_S.join(", ") + "][e - 1], k = [" + RAMP_K.join(", ") + "][e - 1];\n" +
        "    if (!(s > 0)) return u * u * (3 - 2 * u);             // Smooth (smoothstep)\n" +
        "    if (u < k) return k * u / (u + s * (k - u));           // перегиб в (k, k), наклон там s\n" +
        "    return (1 - k) * (u - 1) / (1 - u - s * (k - u)) + 1;\n" +
        "}\n";

    var COMMON =
        RAMP +
        "function weightAt(W, t) {                 // мгновенный вес: точка в мире -> система эффектора -> falloff\n" +
        "    try {\n" +
        "        var fx = function (n) { return E.effect(n)(1).valueAtTime(t); };\n" +
        "        var q = E.fromWorld(W, t);\n" +
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
        "function worldAt(t) {                     // точка выборки клона в мире в момент t\n" +
        "    var W = thisLayer.toWorld(smp, t);\n" +
        "    return (W.length < 3) ? [W[0], W[1], 0] : W;\n" +
        "}\n" +
        "function isMoving() {                     // двигается ли сам слой: ключи трансформа или родитель\n" +
        "    if (thisLayer.hasParent) return true;\n" +
        "    var tf = thisLayer.transform;\n" +
        "    try { if (tf.position.numKeys > 0) return true; } catch (err) {}\n" +
        "    try { if (tf.anchorPoint.numKeys > 0) return true; } catch (err) {}\n" +
        "    try { if (tf.scale.numKeys > 0) return true; } catch (err) {}\n" +
        "    try { if (tf.rotation.numKeys > 0) return true; } catch (err) {}\n" +
        "    try { if (tf.xPosition.numKeys > 0 || tf.yPosition.numKeys > 0) return true; } catch (err) {}\n" +
        "    try { if (tf.zPosition.numKeys > 0) return true; } catch (err) {}\n" +
        "    try { if (tf.orientation.numKeys > 0) return true; } catch (err) {}\n" +
        "    try { if (tf.xRotation.numKeys > 0 || tf.yRotation.numKeys > 0) return true; } catch (err) {}\n" +
        "    return false;\n" +
        "}\n" +
        DELAYED +
        "function lim(w) { return Math.max(-K, Math.min(K, w)); }\n" +
        "function weightNow() {                    // вес клона сейчас, Delay/Spring уже внутри\n" +
        "    var mv = isMoving(), W0 = worldAt(time);\n" +
        "    return lim(delayed(function (t) { return weightAt(mv ? worldAt(t) : W0, t); }));\n" +
        "}\n";

    // Сдвиг: задержка движения слоя + сдвиг эффектора (мир -> система слоя) + доливка опоры.
    var BODY_POS =
        "var S = 100, RX = 0, RY = 0, RZ = 0;\n" +
        "function bend(v, w) {                     // (M − I)·v, M — масштаб и поворот клона при весе w\n" +
        "    var s = 1 + (S / 100 - 1) * w;\n" +
        "    var x = v[0] * s, y = v[1] * s, z = v[2] * s, t1;\n" +
        "    if (P3D) {                             // X, потом Y, потом Z — порядок слоёв AE\n" +
        "        var a = degreesToRadians(RX * w), b = degreesToRadians(RY * w);\n" +
        "        t1 = y * Math.cos(a) - z * Math.sin(a); z = y * Math.sin(a) + z * Math.cos(a); y = t1;\n" +
        "        t1 = x * Math.cos(b) + z * Math.sin(b); z = -x * Math.sin(b) + z * Math.cos(b); x = t1;\n" +
        "    }\n" +
        "    var g = degreesToRadians(RZ * w);\n" +
        "    t1 = x * Math.cos(g) - y * Math.sin(g); y = x * Math.sin(g) + y * Math.cos(g); x = t1;\n" +
        "    return [x - v[0], y - v[1], z - v[2]];\n" +
        "}\n" +
        "var res = [0, 0, 0];\n" +
        "if (E !== null) {\n" +
        "    try {\n" +
        "        var P = [fxv(\"Position X\"), fxv(\"Position Y\"), fxv(\"Position Z\")];\n" +
        "        S = fxv(\"Scale %\"); RZ = fxv(\"Rotation Z\");\n" +
        "        if (P3D) { RX = fxv(\"Rotation X\"); RY = fxv(\"Rotation Y\"); }\n" +
        "        var ap = unit(APG);                   // где AE на деле держит опору этой буквы\n" +
        "        var dv = [ap[0] - piv[0], ap[1] - piv[1], 0];\n" +
        "        var needM = (Math.abs(dv[0]) + Math.abs(dv[1]) > 1e-3) && (S != 100 || RZ != 0 || RX != 0 || RY != 0);\n" +
        "        var needP = (P[0] != 0 || P[1] != 0 || P[2] != 0);\n" +
        "        var mv = isMoving(), dm = 1;\n" +
        "        try { dm = Math.round(E.effect(\"Delay mode\")(1).value); } catch (err) { dm = 1; }\n" +
        "        if (needM || needP || (mv && dm >= 2)) {\n" +
        "            var W0 = worldAt(time);\n" +
        "            var Y = delayed(function (t) {     // точка клона и его вес — одной историей\n" +
        "                var W = mv ? worldAt(t) : W0;\n" +
        "                return [W[0], W[1], W[2], weightAt(W, t)];\n" +
        "            });\n" +
        "            var w = lim(Y[3]);\n" +
        "            var d = [Y[0] - W0[0] + P[0] * w, Y[1] - W0[1] + P[1] * w, Y[2] - W0[2] + P[2] * w];\n" +
        "            var u = thisLayer.fromWorldVec(d);\n" +
        "            u = [u[0], u[1], (u.length > 2) ? u[2] : 0];\n" +
        "            if (needM) {\n" +
        "                var c = bend(dv, w);\n" +
        "                u = [u[0] + c[0], u[1] + c[1], u[2] + c[2]];\n" +
        "            }\n" +
        "            if (isFinite(u[0]) && isFinite(u[1]) && isFinite(u[2])) {\n" +
        "                res = [u[0] / B * 100, u[1] / B * 100, u[2] / B * 100];\n" +
        "            }\n" +
        "        }\n" +
        "    } catch (err) { res = [0, 0, 0]; }\n" +
        "}\n" +
        "res";

    var BODY_XFORM =
        "var res = [0, 0, 0];\n" +
        "if (E !== null) {\n" +
        "    try {\n" +
        "        var busy = fxv(\"Scale %\") != 100 || fxv(\"Rotation Z\") != 0 ||\n" +
        "                   (P3D && (fxv(\"Rotation X\") != 0 || fxv(\"Rotation Y\") != 0));\n" +
        "        if (busy) { var a = weightNow() / K * 100; res = [a, a, a]; }\n" +
        "    } catch (err) { res = [0, 0, 0]; }\n" +
        "}\n" +
        "res";

    var BODY_OPAC =
        "var res = [0, 0, 0];\n" +
        "if (E !== null) {\n" +
        "    try {\n" +
        "        if (fxv(\"Opacity %\") != 100) { var a = weightNow() * 100; res = [a, a, a]; }\n" +
        "    } catch (err) { res = [0, 0, 0]; }\n" +
        "}\n" +
        "res";

    function selExpr(link, D, kind, body) {
        return "// " + MARK + " — " + kind + ", селектор (Small Scripts: MoGraph text effector)\n" +
            "// Раскладка текста запечена кнопкой. Поправил текст, шрифт или размер — выдели эффектор и нажми её снова.\n" +
            "var CH = [" + D.CH.join(",") + "];   // на символ: x0, x1 (перо), строка, слово (-1 — пробел)\n" +
            "var LN = [" + D.LN.join(",") + "];   // на строку: базовая линия, xmin, xmax\n" +
            "var WD = [" + D.WD.join(",") + "];   // на слово: xmin, xmax\n" +
            "var NR = [" + D.NR.join(",") + "];   // номера символов без переводов строки\n" +
            "var AL = [" + D.AL.join(",") + "];   // опора группировки All\n" +
            "var NALL = " + D.n + ", YC = " + D.YC + ", APG = " + D.APG + ", P3D = " + (D.P3D ? "true" : "false") +
                ", K = " + K_HEAD + ", B = " + B_POS + ";\n" +
            "var E = null;\n" +
            "try { E = effect(\"" + link + "\")(1); } catch (err) { E = null; }\n" +
            "function fxv(n) { return E.effect(n)(1).value; }\n" +
            "var k = textIndex - 1;                   // символ в запечённой строке\n" +
            "if (textTotal != NALL && textTotal == NR.length) k = NR[Math.max(0, Math.min(k, NR.length - 1))];\n" +
            "k = Math.max(0, Math.min(k, NALL - 1));\n" +
            "function unit(m) {                       // опора клона в системе слоя: [центр по X, базовая линия]\n" +
            "    var li = CH[4 * k + 2], wi = CH[4 * k + 3];\n" +
            "    if (m == 4) return [AL[0], AL[1]];\n" +
            "    if (m == 3) return [(LN[3 * li + 1] + LN[3 * li + 2]) / 2, LN[3 * li]];\n" +
            "    if (m == 2 && wi >= 0) return [(WD[2 * wi] + WD[2 * wi + 1]) / 2, LN[3 * li]];\n" +
            "    return [(CH[4 * k] + CH[4 * k + 1]) / 2, LN[3 * li]];\n" +
            "}\n" +
            "var mode = 1;                            // 1 Letter, 2 Word, 3 Line\n" +
            "try { mode = Math.round(fxv(\"Clone\")); } catch (err) { mode = 1; }\n" +
            "var piv = unit(mode);\n" +
            "var smp = [piv[0], piv[1] + YC, 0];      // вес берётся с середины высоты букв, не с базовой линии\n" +
            "var flat = true;                         // 2D-эффектор игнорирует Z\n" +
            "try { flat = !(E.transform.position.value.length > 2); } catch (err) { flat = true; }\n" +
            COMMON + body;
    }

    // Значения свойств аниматоров — параметры эффектора на текущем кадре (их анимация не задерживается).
    function propHead(label) {
        return "// " + MARK + " — " + label + " (Small Scripts: MoGraph text effector)\n";
    }
    function fxRead(link, ctrl) { return "effect(\"" + link + "\")(1).effect(\"" + ctrl + "\")(1).value"; }

    function exprPosBasis() {
        return propHead("базис сдвига: сдвиг = базис × Amount селектора") +
            "value.length > 2 ? [" + B_POS + ", " + B_POS + ", " + B_POS + "] : [" + B_POS + ", " + B_POS + "]";
    }
    function exprScale(link) {
        return propHead("Scale × " + K_HEAD + ", Amount селектора = вес / " + K_HEAD) +
            "var s = 100;\n" +
            "try { s = 100 + " + K_HEAD + " * (" + fxRead(link, "Scale %") + " - 100); } catch (err) { s = 100; }\n" +
            "value.length > 2 ? [s, s, s] : [s, s]";
    }
    function exprRot(link, ctrl) {
        return propHead(ctrl + " × " + K_HEAD + ", Amount селектора = вес / " + K_HEAD) +
            "var r = 0;\n" +
            "try { r = " + K_HEAD + " * " + fxRead(link, ctrl) + "; } catch (err) { r = 0; }\n" +
            "r";
    }
    function exprOpacity(link) {
        return propHead("Opacity") +
            "var o = 100;\n" +
            "try { o = " + fxRead(link, "Opacity %") + "; } catch (err) { o = 100; }\n" +
            "o";
    }

    // ===== аниматоры на текстовом слое =====
    function isLinkName(nm) { return nm === LINK_BASE || /^MG Text \d+$/.test(nm); }

    function links(T) {                      // [{ name, target }] — наши Layer Control'ы на слое
        var out = [], g = fxGroup(T);
        if (!g) return out;
        for (var i = 1; i <= g.numProperties; i++) {
            var f = g.property(i);
            if (f.matchName !== LC || !isLinkName(f.name)) continue;
            var v = 0;
            try { v = f.property(1).value; } catch (e) {}
            out.push({ name: f.name, target: v });
        }
        return out;
    }

    function freeLink(T) {                   // имя, которого нет ни у одного эффекта слоя
        var used = {}, g = fxGroup(T);
        for (var i = 1; i <= g.numProperties; i++) used[g.property(i).name] = true;
        if (!used[LINK_BASE]) return LINK_BASE;
        for (var n = 2; n < 1000; n++) if (!used[LINK_BASE + " " + n]) return LINK_BASE + " " + n;
        return LINK_BASE + " " + (new Date()).getTime();
    }

    function stripAnimators(T, link) {
        var n = 0, pre = link + SEP;
        for (var i = animators(T).numProperties; i >= 1; i--) {
            var a = animators(T).property(i);
            if (a.name.indexOf(pre) !== 0) continue;
            try { a.remove(); n++; } catch (e) { warn(T.name + " → " + a.name + ": " + e.toString()); }
        }
        return n;
    }

    function stripRig(T, link) {
        var n = stripAnimators(T, link);
        removeFx(T, link, LC);
        return n;
    }

    // Аниматор: свойства с выражениями + один Expression Selector. Ссылки на группы берутся
    // заново после каждого addProperty — добавление инвалидирует ранее взятые ссылки.
    function addAnimator(T, name, props, amountExpr) {
        var ai = animators(T).addProperty("ADBE Text Animator").propertyIndex;
        function A() { return animators(T).property(ai); }
        function sels() { return A().property("ADBE Text Selectors"); }
        A().name = name;
        for (var s = sels().numProperties; s >= 1; s--) sels().property(s).remove();   // если AE положил Range Selector сам
        for (var p = 0; p < props.length; p++) {
            A().property("ADBE Text Animator Properties").addProperty(props[p].mn);
        }
        for (var q = 0; q < props.length; q++) {
            A().property("ADBE Text Animator Properties").property(props[q].mn).expression = props[q].expr;
        }
        var si = sels().addProperty("ADBE Text Expressible Selector").propertyIndex;
        try { sels().property(si).property("ADBE Text Range Type2").setValue(1); } catch (e) {}   // Based On: Characters
        sels().property(si).property("ADBE Text Expressible Amount").expression = amountExpr;
    }

    // Текстовый слой -> эффектор. Своя связь с этим эффектором уже есть — переписываем её
    // (перемер), нет — новая связь рядом со старыми: эффекторы на одном тексте складываются.
    function enroll(T, E, D) {
        var who = T.name, link = null, ls = links(T);
        for (var i = 0; i < ls.length; i++) if (ls[i].target === E.index) { link = ls[i].name; break; }
        try {
            if (!link) {
                link = freeLink(T);
                fxGroup(T).addProperty(LC).name = link;
                findFx(T, link, LC).property(1).setValue(E.index);
            }
            stripAnimators(T, link);
            addAnimator(T, link + SEP + "Position",
                [{ mn: "ADBE Text Position 3D", expr: exprPosBasis() }],
                selExpr(link, D, "Position", BODY_POS));
            var xf = [
                { mn: "ADBE Text Scale 3D", expr: exprScale(link) },
                { mn: "ADBE Text Rotation", expr: exprRot(link, "Rotation Z") }
            ];
            if (D.P3D) {
                xf.push({ mn: "ADBE Text Rotation X", expr: exprRot(link, "Rotation X") });
                xf.push({ mn: "ADBE Text Rotation Y", expr: exprRot(link, "Rotation Y") });
            }
            addAnimator(T, link + SEP + "Transform", xf, selExpr(link, D, "Transform", BODY_XFORM));
            addAnimator(T, link + SEP + "Opacity",
                [{ mn: "ADBE Text Opacity", expr: exprOpacity(link) }],
                selExpr(link, D, "Opacity", BODY_OPAC));
        } catch (e) {
            warn(who + ": " + e.toString());
            return false;
        }
        return true;
    }

    function rigsOf(E) {                     // [{ layer, link }] по всей композиции
        var out = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (!isText(L)) continue;
            var ls = links(L);
            for (var j = 0; j < ls.length; j++) if (ls[j].target === E.index) out.push({ layer: L, link: ls[j].name });
        }
        return out;
    }

    function hasLayer(arr, L) {
        for (var i = 0; i < arr.length; i++) if (arr[i] === L) return true;
        return false;
    }

    // Замер всех слоёв разом, временный слой — один на прогон и убирается до подключения:
    // пока он есть, индексы слоёв сдвинуты на единицу. Поэтому повторы отсеиваются по самому
    // слою, а не по index: после первого замера index у всех ниже уже другой.
    function bakeAll(layers) {
        var out = [], uniq = [];
        for (var u = 0; u < layers.length; u++) if (!hasLayer(uniq, layers[u])) uniq.push(layers[u]);
        try {
            for (var i = 0; i < uniq.length; i++) {
                var L = uniq[i];
                try {
                    var D = bake(L);
                    for (var w = 0; w < D.notes.length; w++) warn(L.name + ": " + D.notes[w]);
                    out.push({ layer: L, data: D });
                } catch (e) {
                    warn(L.name + ": не смог измерить текст — " + e.toString());
                }
            }
        } finally {
            killTmp();
        }
        return out;
    }

    // ===== эффектор =====
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
        { nm: "Clone",           menu: CLONES, v: 1 },
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

    // Гизмо рисуется вокруг начала координат шейп-слоя — от него же считается falloff.
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
        gizmoPart(E, "Linear full",  PTH, PTH_S, LIN + "createPath([[-h, -L], [-h, L]], [], [], false)", 100, vis(4));
        gizmoPart(E, "Linear zero",  PTH, PTH_S, LIN + "createPath([[h, -L], [h, L]], [], [], false)", 40, vis(4));

        var cross = new Shape();
        cross.vertices = [[-30, 0], [30, 0], [0, 0], [0, -30], [0, 30]];
        cross.closed = false;
        gizmoPart(E, "Center", PTH, PTH_S, cross, 100, null);
    }

    // Центр текста в мире. ExtendScript не умеет toWorld — считает выражение: ставим его на
    // Position эффектора, читаем результат, снимаем.
    function placeAtCenter(E, layers, threeD) {
        var pos = tr(E, "ADBE Position");
        var ids = [];
        for (var i = 0; i < layers.length; i++) ids.push(layers[i].index);
        var ex =
            "var ids = [" + ids.join(", ") + "], s = [0, 0, 0];\n" +
            "for (var i = 0; i < ids.length; i++) {\n" +
            "    var L = thisComp.layer(ids[i]);\n" +
            "    var r = L.sourceRectAtTime(time, false);\n" +
            "    var p = L.toWorld([r.left + r.width / 2, r.top + r.height / 2]);\n" +
            "    if (p.length < 3) p = [p[0], p[1], 0];\n" +
            "    s = [s[0] + p[0], s[1] + p[1], s[2] + p[2]];\n" +
            "}\n" +
            "var n = ids.length;\n" +
            (threeD ? "[s[0] / n, s[1] / n, s[2] / n]" : "[s[0] / n, s[1] / n]");
        try {
            pos.expression = ex;
            var v = pos.value;
            pos.expression = "";
            pos.setValue(v);
        } catch (e) {
            try { pos.expression = ""; } catch (e2) {}
        }
    }

    function createEffector(layers, threeD) {
        var E = comp.layers.addShape();
        E.name = uniqueName(BASE_NAME);
        E.comment = MARK_EFF + " — эффектор MoGraph для текста (Small Scripts)";
        E.guideLayer = true;
        if (threeD) E.threeDLayer = true;

        var top = layers[0];
        for (var i = 1; i < layers.length; i++) if (layers[i].index < top.index) top = layers[i];
        E.moveBefore(top);

        ensureControls(E, true);
        try { tr(E, "ADBE Rotate Z").setValue(EFF_ROT); } catch (e) {}
        buildGizmo(E);
        placeAtCenter(E, layers, threeD);
        return E;
    }

    // ===== разбор выделения =====
    var effs = [], texts = [], skipped = [];
    for (var s = 0; s < sel.length; s++) {
        if (isEffector(sel[s])) effs.push(sel[s]);
        else if (isText(sel[s])) texts.push(sel[s]);
        else skipped.push(sel[s].name);
    }
    if (skipped.length) warn("не текст, пропущены: " + skipped.join(", "));

    function report(msg) {
        if (warnings.length) msg += "\n\n--- предупреждения ---\n" + warnings.join("\n");
        alert(msg);
    }

    // ===== режим снятия (Alt) =====
    if (removeMode) {
        var jobs = [], seenJob = {};
        var take = function (L, link) {
            var key = L.index + "|" + link;
            if (!seenJob[key]) { seenJob[key] = true; jobs.push({ layer: L, link: link }); }
        };
        for (var t = 0; t < texts.length; t++) {
            var ls = links(texts[t]);
            for (var l = 0; l < ls.length; l++) take(texts[t], ls[l].name);
        }
        for (var e = 0; e < effs.length; e++) {
            var rg = rigsOf(effs[e]);
            for (var r = 0; r < rg.length; r++) take(rg[r].layer, rg[r].link);
        }
        if (jobs.length === 0 && effs.length === 0) {
            alert("В выделении нет ни текста с эффектором, ни эффекторов — снимать нечего.");
            return;
        }

        app.beginUndoGroup("MoGraph text effector — снять");
        var gone = 0, layersTouched = {};
        for (var jb = 0; jb < jobs.length; jb++) {
            gone += stripRig(jobs[jb].layer, jobs[jb].link);
            layersTouched[jobs[jb].layer.index] = true;
        }
        var removed = 0;
        for (var re = 0; re < effs.length; re++) {
            try { effs[re].remove(); removed++; } catch (err) { warn(effs[re].name + ": не удалился — " + err.toString()); }
        }
        app.endUndoGroup();

        var nTouched = 0;
        for (var key in layersTouched) if (layersTouched.hasOwnProperty(key)) nTouched++;
        report("Снято связей текст → эффектор: " + jobs.length + " (слоёв: " + nTouched + ")\n" +
               "Аниматоров удалено: " + gone + "\n" +
               "Эффекторов удалено: " + removed);
        return;
    }

    // ===== режим создания / добавления / перемера =====
    if (effs.length > 1) {
        alert("Выделено несколько эффекторов. Выдели один (добавить к нему текст / перемерить) или ни одного (создать новый).");
        return;
    }

    // ===== только эффектор — перемерить текст и обновить до текущей версии =====
    if (texts.length === 0 && effs.length === 1) {
        var U = effs[0];
        var mine = rigsOf(U), mineLayers = [];
        for (var mi = 0; mi < mine.length; mi++) mineLayers.push(mine[mi].layer);

        app.beginUndoGroup("MoGraph text effector — перемерить");
        var addedU = 0;
        try { addedU = ensureControls(U); } catch (err) { warn(U.name + ": " + err.toString()); }
        var bakedU = bakeAll(mineLayers), rewritten = 0;
        for (var bu = 0; bu < bakedU.length; bu++) if (enroll(bakedU[bu].layer, U, bakedU[bu].data)) rewritten++;
        app.endUndoGroup();

        var umsg = "Эффектор «" + U.name + "»: текст перемерен.\n" +
                   "Контролов добавлено: " + addedU + "\n" +
                   "Текстовых слоёв переписано: " + rewritten + " из " + mineLayers.length;
        if (mineLayers.length === 0) umsg += "\n\nЧтобы добавить текст — выдели его вместе с эффектором.";
        report(umsg);
        return;
    }

    if (texts.length === 0) {
        report("В выделении нет текстовых слоёв.");
        return;
    }
    texts.sort(function (a, b) { return a.index - b.index; });

    app.beginUndoGroup("MoGraph text effector");

    // старые тексты этого эффектора перемеряются заодно — все его клоны в одной версии
    var created = effs.length === 0;
    var toBake = texts.slice(), olds = [];
    if (!created) {
        var rg0 = rigsOf(effs[0]);
        for (var o = 0; o < rg0.length; o++) { toBake.push(rg0[o].layer); olds.push(rg0[o].layer); }
    }
    var baked = bakeAll(toBake);
    var bakedTexts = [], bakedLayers = [], any3D = false;
    for (var b = 0; b < baked.length; b++) {
        bakedLayers.push(baked[b].layer);
        if (is3D(baked[b].layer)) any3D = true;
    }
    for (var b2 = 0; b2 < texts.length; b2++) if (hasLayer(bakedLayers, texts[b2])) bakedTexts.push(texts[b2]);
    if (bakedTexts.length === 0) {
        app.endUndoGroup();
        report("Ни один текст не удалось измерить.");
        return;
    }

    var E;
    try {
        if (created) {
            E = createEffector(bakedTexts, any3D);
        } else {
            E = effs[0];
            if (any3D && !is3D(E)) E.threeDLayer = true;   // 3D-тексту нужен 3D-falloff
            ensureControls(E);                             // эффектор старой версии — добить контролы
        }
    } catch (err) {
        app.endUndoGroup();
        report("Не смог создать эффектор: " + err.toString());
        return;
    }

    // стекинг: к тексту с чужим эффектором добавляется этот — не ошибка, но стоит сказать.
    // Текст уже при этом эффекторе (перемер) — молчим.
    for (var st = 0; st < bakedTexts.length; st++) {
        var own = links(bakedTexts[st]), mineAlready = false;
        for (var sm = 0; sm < own.length; sm++) if (own[sm].target === E.index) mineAlready = true;
        if (mineAlready) continue;
        for (var so = 0; so < own.length; so++) {
            if (own[so].target !== E.index && own[so].target !== 0) {
                var otherName = "#" + own[so].target;
                try { otherName = comp.layer(own[so].target).name; } catch (err) {}
                warn(bakedTexts[st].name + ": уже есть эффектор «" + otherName + "» — эффекторы складываются");
            }
        }
    }

    var done = 0, refreshed = 0;
    for (var m = 0; m < baked.length; m++) {
        if (!enroll(baked[m].layer, E, baked[m].data)) continue;
        if (hasLayer(texts, baked[m].layer)) done++;
        else if (hasLayer(olds, baked[m].layer)) refreshed++;
    }

    app.endUndoGroup();

    // ===== отчёт =====
    report("Эффектор: " + E.name + (created ? " (новый)" : "") + "\n" +
           "Текстовых слоёв: " + done + " из " + texts.length +
           (refreshed ? "\nСтарых текстов перемерено: " + refreshed : "") + "\n\n" +
           "Clone на эффекторе: Letter / Word / Line — что считать клоном, переключается вживую.\n" +
           "Остальное как у эффектора слоёв: Strength, Position X/Y/Z, Scale %, Rotation X/Y/Z " +
           "(X/Y — если у текста включён Per-character 3D), Opacity %, Falloff, Delay.\n" +
           "Falloff ease — изинг рампы: edge — крутой участок у внешней границы, core — у центра.\n" +
           "Поправил текст, шрифт или размер — выдели эффектор и нажми кнопку ещё раз.\n" +
           "Alt+клик по кнопке — снять.");

})();
