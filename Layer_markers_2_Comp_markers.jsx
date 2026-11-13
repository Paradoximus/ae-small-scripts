/* @ae-script
name:  Layer markers → Comp markers
desc:  Копирует маркеры выделенного слоя в маркеры активной композиции (на те же таймкоды, с комментариями / chapter / url).
prep:  |
  - Открыть композицию
  - Выделить РОВНО ОДИН слой с маркерами
tags:  markers, comp
*/

/*  Copy Layer Markers to Comp Markers
    - Берёт маркеры с текущего выделенного слоя
    - Копирует их в маркеры композиции (в те же таймкоды)
    - Сохраняет комментарий и chapter (если есть)
*/

(function () {
    if (!app.project) {
        alert("Нет открытого проекта.");
        return;
    }

    var comp = app.project.activeItem;
    if (!(comp && (comp instanceof CompItem))) {
        alert("Активный элемент должен быть композицией.");
        return;
    }

    if (comp.selectedLayers.length !== 1) {
        alert("Выдели ровно один слой в активной композиции.");
        return;
    }

    var layer = comp.selectedLayers[0];

    var layerMarkerProp = layer.property("Marker");
    if (!layerMarkerProp) {
        alert("У слоя нет свойства Marker.");
        return;
    }

    var compMarkerProp = comp.markerProperty; // MarkerProperty композиции

    if (layerMarkerProp.numKeys === 0) {
        alert("На выделенном слое нет маркеров.");
        return;
    }

    app.beginUndoGroup("Copy Layer Markers to Comp");

    try {
        for (var i = 1; i <= layerMarkerProp.numKeys; i++) {
            var t = layerMarkerProp.keyTime(i);
            var mv = layerMarkerProp.keyValue(i); // MarkerValue

            // Копируем MarkerValue как есть: комментарий, chapter, url, cuePointName и т.д.
            compMarkerProp.setValueAtTime(t, mv);
        }
    } catch (e) {
        alert("Ошибка: " + e.toString());
    } finally {
        app.endUndoGroup();
    }
})();