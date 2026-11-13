/* @ae-script
name:  Fit comp duration to selected layer
desc:  Подгоняет длину композиции под выделенный слой. Для футажа с длительностью (видео/аудио/прекомп) — по полной длине источника от его startTime, даже если слой обрезан. Для стиллов / солидов / шейпов / текста — по текущему outPoint. Плюс пытается отзумить таймлайн на всю длительность.
prep:  |
  - Открыть композицию
  - Выделить один или несколько слоёв
tags:  comp, duration, layers, zoom
*/

(function () {
    if (!app.project) {
        alert("Нет открытого проекта.");
        return;
    }

    var comp = app.project.activeItem;
    if (!(comp && comp instanceof CompItem)) {
        alert("Активный элемент должен быть композицией.");
        return;
    }

    var layers = comp.selectedLayers;
    if (!layers || layers.length === 0) {
        alert("Выдели хотя бы один слой.");
        return;
    }

    var maxEnd = 0;
    for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        var end;
        var src = (L.source !== undefined) ? L.source : null;

        if (src && src.duration && src.duration > 0) {
            // Movie / audio / precomp — натуральный конец источника на таймлайне
            end = L.startTime + src.duration;
        } else {
            // Still / solid / shape / text / null / camera / light — по текущей обрезке
            end = L.outPoint;
        }

        if (end > maxEnd) maxEnd = end;
    }

    if (maxEnd <= 0) {
        alert("Не удалось вычислить длительность (слой полностью вне таймлайна?).");
        return;
    }

    // Снап вверх до целого кадра, чтобы слой гарантированно поместился
    var frameDur = comp.frameDuration;
    var frames = Math.ceil(maxEnd / frameDur - 1e-6);
    var newDuration = frames * frameDur;
    if (newDuration < frameDur) newDuration = frameDur;

    if (Math.abs(comp.duration - newDuration) < frameDur * 0.5) {
        // Уже подогнано
        return;
    }

    app.beginUndoGroup("Fit comp duration to selected layer");
    try {
        comp.duration = newDuration;
        fitTimelineZoom();
    } catch (e) {
        alert("Ошибка: " + e.toString());
    }
    app.endUndoGroup();

    // Прямого API для зума таймлайна в ExtendScript нет.
    // Пробуем найти меню-команду по нескольким возможным именам — что-то одно
    // обычно срабатывает в зависимости от версии AE.
    function fitTimelineZoom() {
        var candidates = [
            "Zoom Out to Show Entire Comp",
            "Zoom out to show entire comp",
            "Zoom To Show Entire Comp",
            "Zoom Out Full",
            "Time Zoom Out Full",
            "Show Entire Composition",
            "Zoom to Fit"
        ];
        for (var i = 0; i < candidates.length; i++) {
            var id = 0;
            try { id = app.findMenuCommandId(candidates[i]); } catch (e) { id = 0; }
            if (id && id !== 0) {
                try { app.executeCommand(id); return true; } catch (e) {}
            }
        }
        return false;
    }
})();
