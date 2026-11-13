/* @ae-script
name:  ✗ Deselect parented
desc:  Снимает выделение со слоёв, у которых есть parent. Остаются выделены только независимые слои.
prep:  |
  - Открыть композицию
  - Выделить группу слоёв
tags:  selection, layers
*/

// Скрипт для After Effects: оставляет выделенными только слои без родителя

(function keepOnlyUnparentedLayersSelected() {
    var comp = app.project.activeItem;

    if (!(comp instanceof CompItem)) {
        alert("Пожалуйста, выбери композицию.");
        return;
    }

    var selectedLayers = comp.selectedLayers;

    if (selectedLayers.length === 0) {
        alert("Нет выделенных слоёв.");
        return;
    }

    app.beginUndoGroup("Select Only Unparented Layers");

    for (var i = 0; i < selectedLayers.length; i++) {
        var layer = selectedLayers[i];
        // Если у слоя есть родитель — снимаем выделение
        if (layer.parent !== null) {
            layer.selected = false;
        }
    }

    app.endUndoGroup();
})();