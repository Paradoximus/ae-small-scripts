/* @ae-script
name:  Remove gaps between layers
desc:  Сдвигает выделенные слои так, чтобы каждый начинался ровно в конце предыдущего. Сортирует по startTime, гэпы убираются.
prep:  |
  - Открыть композицию
  - Выделить 2 или больше слоёв
tags:  timeline, layers
*/

(function removeAllGapsBetweenLayers() {
    // Проверяем, есть ли активная композиция
    var comp = app.project.activeItem;
    if (!(comp instanceof CompItem)) {
        alert("Пожалуйста, выберите композицию и слои, чтобы запустить скрипт.");
        return;
    }

    // Получаем выбранные слои
    var selectedLayers = comp.selectedLayers;
    if (selectedLayers.length < 2) {
        alert("Пожалуйста, выберите два или более слоев.");
        return;
    }

    // Начинаем Undo-группу
    app.beginUndoGroup("Remove All Gaps Between Layers");

    // Сортируем слои по их текущему времени начала
    selectedLayers.sort(function (a, b) {
        return a.startTime - b.startTime;
    });

    // Убираем промежутки между слоями
    for (var i = 1; i < selectedLayers.length; i++) {
        var previousLayer = selectedLayers[i - 1];
        var currentLayer = selectedLayers[i];

        // Начало текущего слоя должно совпадать с концом предыдущего слоя
        currentLayer.startTime = previousLayer.startTime + (previousLayer.outPoint - previousLayer.inPoint);
    }

    // Завершаем Undo-группу
    app.endUndoGroup();

    alert("Все промежутки между слоями успешно убраны!");
})();