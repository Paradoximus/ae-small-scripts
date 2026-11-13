/* @ae-script
name:  InOut GAPЫ selected footages
desc:  берёт выделенные в Project футажи/AVItems, создаёт новую композицию и раскладывает слои по “абсолютному” времени их inPoint/outPoint
prep:  |
  - Выделить 2 или больше футажей в проекте
tags:  timeline, layers
*/

(function BuildSequence_UsingStartTimecode_WrapInComps() {
    app.beginUndoGroup("Wrap selected footages -> sequence by Start TC + gaps");

    function hasNum(v) { return (typeof v === "number") && !isNaN(v) && isFinite(v); }
    function fmtSeconds(sec) { return (Math.round(sec * 100) / 100).toString() + "s"; }

    function tryGetStartTCSeconds(footage) {
        // В AE разные типы источников отдают это по-разному.
        // Пробуем несколько вариантов, возвращаем {tc:number|null, mode:string}
        // Важно: это НЕ inPoint/outPoint слоя — это старт таймкода источника.

        // 1) mainSource.displayStartTime (часто существует у FileSource)
        try {
            if (footage.mainSource && hasNum(footage.mainSource.displayStartTime)) {
                return { tc: footage.mainSource.displayStartTime, mode: "mainSource.displayStartTime" };
            }
        } catch (e1) {}

        // 2) footage.displayStartTime (иногда так)
        try {
            if (hasNum(footage.displayStartTime)) {
                return { tc: footage.displayStartTime, mode: "footage.displayStartTime" };
            }
        } catch (e2) {}

        // 3) mainSource.startTime (в твоей диагностике было undefined, но оставим на всякий)
        try {
            if (footage.mainSource && hasNum(footage.mainSource.startTime)) {
                return { tc: footage.mainSource.startTime, mode: "mainSource.startTime" };
            }
        } catch (e3) {}

        // 4) Ничего не нашли
        return { tc: null, mode: "not_found" };
    }

    function addGapFill(comp, gapStart, gapLen) {
        if (gapLen <= 0) return;

        var THRESH = 30.0;
        if (gapLen <= THRESH) {
            var black = comp.layers.addSolid([0, 0, 0], "GAP_black_" + fmtSeconds(gapLen), comp.width, comp.height, comp.pixelAspect, comp.duration);
            black.startTime = gapStart;
            black.inPoint = gapStart;
            black.outPoint = gapStart + gapLen;
        } else {
            var redDur = 5.0;
            var red = comp.layers.addSolid([1, 0, 0], "GAP_red_5s", comp.width, comp.height, comp.pixelAspect, comp.duration);
            red.startTime = gapStart;
            red.inPoint = gapStart;
            red.outPoint = gapStart + redDur;

            var mv = new MarkerValue(fmtSeconds(gapLen));
            red.property("Marker").setValueAtTime(red.inPoint, mv);
        }
    }

    var proj = app.project;
    if (!proj) { alert("Нет открытого проекта."); app.endUndoGroup(); return; }

    var sel = proj.selection;
    if (!sel || sel.length === 0) {
        alert("Выдели футажи в Project panel и запусти скрипт.");
        app.endUndoGroup();
        return;
    }

    // Папка под обёртки
    var folder = proj.items.addFolder("_WRAPPED_byStartTC");

    // Создаём обёртки и собираем клипы
    var wrapped = [];
    var skipped = 0;
    var diagModes = {}; // mode -> count

    for (var i = 0; i < sel.length; i++) {
        var it = sel[i];

        // Берём только FootageItem (видео/аудио/секвенсы). Папки/компы пропускаем.
        try {
            if (!(it instanceof FootageItem)) continue;
        } catch (e) {
            // Если вдруг instanceof капризничает — хотя в AE обычно норм.
            continue;
        }

        if (!hasNum(it.duration) || it.duration <= 0) { skipped++; continue; }

        // Параметры обёртки берём из футажа
        var w = it.width && it.width > 0 ? it.width : 1920;
        var h = it.height && it.height > 0 ? it.height : 1080;
        var par = hasNum(it.pixelAspect) ? it.pixelAspect : 1.0;
        var fps = hasNum(it.frameRate) && it.frameRate > 0 ? it.frameRate : 25;

        var wrapName = "WRP__" + it.name;
        var wrapComp = proj.items.addComp(wrapName, w, h, par, it.duration, fps);
        wrapComp.parentFolder = folder;

        // Добавляем футаж внутрь обёртки
        var L = wrapComp.layers.add(it);
        L.startTime = 0;
        L.inPoint = 0;
        L.outPoint = it.duration;

        // Пытаемся достать стартовый таймкод источника
        var tcInfo = tryGetStartTCSeconds(it);
        if (!diagModes[tcInfo.mode]) diagModes[tcInfo.mode] = 0;
        diagModes[tcInfo.mode]++;

        // Если нашли — пробуем сохранить его в displayStartTime обёртки
        // (не обязательно, но удобно для отладки/соответствия логике AE)
        if (tcInfo.tc !== null) {
            try { wrapComp.displayStartTime = tcInfo.tc; } catch (eSet) {}
        }

        // Для секвенса используем tcInfo.tc как "абсолютный In"
        // Если не нашли — считаем 0, но пометим
        var absIn = (tcInfo.tc !== null) ? tcInfo.tc : 0;
        var absOut = absIn + it.duration;

        wrapped.push({
            comp: wrapComp,
            name: it.name,
            inP: absIn,
            outP: absOut,
            tcMode: tcInfo.mode
        });
    }

    if (wrapped.length === 0) {
        alert("Не удалось создать обёртки: проверь, что выделены именно FootageItem (файлы) в Project panel.");
        app.endUndoGroup();
        return;
    }

    // Сортируем по "абсолютному времени"
    wrapped.sort(function(a, b) { return a.inP - b.inP; });

    // Границы
    var minIn = wrapped[0].inP;
    var maxOut = wrapped[0].outP;
    for (var k = 1; k < wrapped.length; k++) {
        if (wrapped[k].inP < minIn) minIn = wrapped[k].inP;
        if (wrapped[k].outP > maxOut) maxOut = wrapped[k].outP;
    }

    var shift = -minIn;
    var seqDur = (maxOut - minIn);
    if (seqDur <= 0) seqDur = 1;

    // Итоговая композиция — по параметрам первой обёртки
    var base = wrapped[0].comp;
    var seqName = "SEQUENCE_byStartTC";
    var seqComp = proj.items.addComp(seqName, base.width, base.height, base.pixelAspect, seqDur, base.frameRate);
    seqComp.parentFolder = folder;

    // Раскладываем обёртки
    for (var n = 0; n < wrapped.length; n++) {
        var wItem = wrapped[n];

        var layerIn = wItem.inP + shift;
        var layerOut = wItem.outP + shift;

        var lay = seqComp.layers.add(wItem.comp);
        lay.startTime = layerIn;
        lay.inPoint = layerIn;
        lay.outPoint = layerOut;
        lay.name = wItem.name;
    }

    // Заполняем промежутки (с учётом перекрытий)
    var firstStart = wrapped[0].inP + shift;
    if (firstStart > 0) addGapFill(seqComp, 0, firstStart);

    var curEnd = wrapped[0].outP + shift;
    for (var g = 1; g < wrapped.length; g++) {
        var nextIn = wrapped[g].inP + shift;
        var nextOut = wrapped[g].outP + shift;

        if (nextIn > curEnd) {
            addGapFill(seqComp, curEnd, nextIn - curEnd);
        }
        if (nextOut > curEnd) curEnd = nextOut;
    }

    // Диагностика в конце
    var diag = "Готово.\nСоздано обёрток: " + wrapped.length + "\nПропущено: " + skipped + "\n\nЧтение StartTC (какое поле сработало):\n";
    for (var key in diagModes) {
        if (diagModes.hasOwnProperty(key)) diag += "- " + key + ": " + diagModes[key] + "\n";
    }
    diag += "\nИтоговая композиция: " + seqName + "\nПапка: _WRAPPED_byStartTC";

    app.endUndoGroup();
    alert(diag);

})();