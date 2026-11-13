/* @ae-script
name:  Comp per video layer
desc:  Берёт выделенную композицию и на каждый видео-футаж создаёт отдельную композицию ровно под размер и длительность видимого интервала слоя. Исходная композиция не меняется.
prep:  |
  - Выделить РОВНО ОДНУ композицию в Project panel
tags:  precomp, footage
*/

(function () {
    app.beginUndoGroup("Create comps from layers (no changes to original comp)");

    // ===== SETTINGS =====
    var ONLY_VIDEO_FOOTAGE = true; // у тебя "только видосы" — оставил true
    // ====================

    function getSelectedCompFromProject() {
        var sel = app.project.selection;
        if (!sel || sel.length !== 1 || !(sel[0] instanceof CompItem)) return null;
        return sel[0];
    }

    function findOrCreateFolder(folderName) {
        var root = app.project.rootFolder;
        for (var i = 1; i <= root.numItems; i++) {
            var it = root.item(i);
            if (it instanceof FolderItem && it.name === folderName) return it;
        }
        return app.project.items.addFolder(folderName);
    }

    function quantizeToFrames(t, frameDuration) {
        var frames = Math.max(1, Math.round(t / frameDuration));
        return frames * frameDuration;
    }

    function isVideoFootageLayer(layer) {
        if (!(layer instanceof AVLayer)) return false;
        if (!layer.source) return false;
        if (!(layer.source instanceof FootageItem)) return false;

        try {
            if (ONLY_VIDEO_FOOTAGE && !layer.source.hasVideo) return false;
        } catch (e) {}

        return true;
    }

    var srcComp = getSelectedCompFromProject();
    if (!srcComp) {
        alert("Выдели ОДНУ композицию в Project panel и запусти скрипт.");
        app.endUndoGroup();
        return;
    }

    var folder = findOrCreateFolder(srcComp.name);

    var fd = srcComp.frameDuration;
    var fps = srcComp.frameRate;

    var created = 0;
    var skipped = 0;

    // Один проход по слоям — без мутаций исходной компы
    for (var i = 1; i <= srcComp.numLayers; i++) {
        var lyr = srcComp.layer(i);

        if (!isVideoFootageLayer(lyr)) {
            skipped++;
            continue;
        }

        var footage = lyr.source; // FootageItem
        var w = footage.width;
        var h = footage.height;
        var par = footage.pixelAspect;

        var inP = lyr.inPoint;
        var outP = lyr.outPoint;

        var rawSpan = outP - inP;
        if (rawSpan <= 0) rawSpan = fd;

        var dur = quantizeToFrames(rawSpan, fd);

        var compName = lyr.name + " " + lyr.index;

        // создаём новую компу ровно под футаж
        var newComp = app.project.items.addComp(compName, w, h, par, dur, fps);
        newComp.parentFolder = folder;
        newComp.displayStartTime = 0;

        // добавляем футаж
        var nl = newComp.layers.add(footage);

        // ключевой момент: чтобы "видимый кусок" совпал с тем, что было в исходной компе
        // в исходной: видимый интервал [inP..outP]
        // в новой: хотим, чтобы этот интервал лег в [0..dur]
        nl.startTime = -inP;

        // тримим слой по границам новой компы
        nl.inPoint = 0;
        nl.outPoint = dur;

        created++;
    }

    app.endUndoGroup();
    alert("Готово.\nСоздано композиций: " + created + "\nПропущено слоёв: " + skipped);
})();