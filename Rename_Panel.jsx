/* @ae-script
name:  Rename Panel (open)
desc:  Палитра утилит переименования. Suffix comps with folder name + Find/Replace и Truncate-after-first-match с выбором скоупа (selection / selected folder / whole project) и фильтром «только композиции».
prep:  |
  - Запустить (откроется палитра)
  - Для Suffix: выделить папки в Project panel, нажать кнопку
  - Для Find/Replace и Truncate: ввести поле Find (и Replace при необходимости), выбрать scope и фильтры, нажать кнопку
tags:  rename, panel, find, replace
*/

// AE ScriptUI panel — small rename utilities.
// Dock via File > Scripts > Install ScriptUI Panel, then Window > Rename_Panel.jsx.

(function buildPanel(thisObj) {
    var panel = (thisObj instanceof Panel)
        ? thisObj
        : new Window("palette", "Rename Panel", undefined, {resizeable: true});

    panel.orientation = "column";
    panel.alignChildren = ["fill", "top"];
    panel.spacing = 6;
    panel.margins = 10;

    // --- Suffix with folder name ---
    var btnSuffixFolder = panel.add("button", undefined, "Suffix comps with folder name");
    btnSuffixFolder.helpTip = "В выделенных папках добавляет к именам композиций _ИмяПапки в конце.";
    btnSuffixFolder.onClick = suffixCompsWithFolderName;

    // --- Find / Replace block ---
    var pnlFR = panel.add("panel", undefined, "Find / Replace");
    pnlFR.orientation = "column";
    pnlFR.alignChildren = ["fill", "top"];
    pnlFR.margins = [10, 14, 10, 10];
    pnlFR.spacing = 6;

    var grpFind = pnlFR.add("group");
    grpFind.orientation = "row";
    grpFind.alignChildren = ["left", "center"];
    var lblFind = grpFind.add("statictext", undefined, "Find:");
    lblFind.preferredSize.width = 60;
    var edFind = grpFind.add("edittext", undefined, "");
    edFind.characters = 22;
    edFind.alignment = ["fill", "center"];

    var grpRepl = pnlFR.add("group");
    grpRepl.orientation = "row";
    grpRepl.alignChildren = ["left", "center"];
    var lblRepl = grpRepl.add("statictext", undefined, "Replace:");
    lblRepl.preferredSize.width = 60;
    var edRepl = grpRepl.add("edittext", undefined, "");
    edRepl.characters = 22;
    edRepl.alignment = ["fill", "center"];

    var grpScope = pnlFR.add("panel", undefined, "Scope");
    grpScope.orientation = "column";
    grpScope.alignChildren = ["left", "top"];
    grpScope.margins = [10, 12, 10, 8];
    grpScope.spacing = 2;
    var rbSel    = grpScope.add("radiobutton", undefined, "Selection");
    var rbFolder = grpScope.add("radiobutton", undefined, "Inside selected folder(s)");
    var rbAll    = grpScope.add("radiobutton", undefined, "Whole project");
    rbSel.value = true;

    var grpOpts = pnlFR.add("group");
    grpOpts.orientation = "row";
    grpOpts.alignChildren = ["left", "center"];
    var cbComps = grpOpts.add("checkbox", undefined, "Only comps");
    var cbCase  = grpOpts.add("checkbox", undefined, "Match case");
    var cbRegex = grpOpts.add("checkbox", undefined, "Regex");
    cbComps.value = true;

    var grpBtns = pnlFR.add("group");
    grpBtns.orientation = "row";
    grpBtns.alignChildren = ["fill", "center"];
    grpBtns.alignment = ["fill", "top"];
    var btnReplace  = grpBtns.add("button", undefined, "Replace");
    btnReplace.helpTip = "Заменяет все вхождения Find на Replace в именах элементов по scope и фильтрам.";
    var btnTruncate = grpBtns.add("button", undefined, "Truncate after first match");
    btnTruncate.helpTip = "Находит первое вхождение Find и удаляет всё, что идёт после него (само вхождение сохраняется).";

    btnReplace.onClick  = function () { doRename("replace"); };
    btnTruncate.onClick = function () { doRename("truncate"); };

    panel.layout.layout(true);
    panel.layout.resize();
    panel.onResizing = panel.onResize = function () { this.layout.resize(); };

    if (panel instanceof Window) {
        panel.center();
        panel.show();
    }

    // ---------- handlers ----------

    function suffixCompsWithFolderName() {
        var sel = app.project.selection;
        var folders = [];
        for (var i = 0; i < sel.length; i++) {
            if (sel[i] instanceof FolderItem) folders.push(sel[i]);
        }
        if (folders.length === 0) {
            alert("Выдели одну или несколько папок с композициями.");
            return;
        }

        app.beginUndoGroup("Suffix comps with folder name");
        var renamed = 0, skipped = 0;
        for (var f = 0; f < folders.length; f++) {
            var folder = folders[f];
            var suffix = "_" + folder.name;
            for (var k = 1; k <= folder.items.length; k++) {
                var item = folder.items[k];
                if (!(item instanceof CompItem)) continue;
                if (endsWith(item.name, suffix)) {
                    skipped++;
                } else {
                    item.name = item.name + suffix;
                    renamed++;
                }
            }
        }
        app.endUndoGroup();

        alert("Renamed: " + renamed + "\nSkipped (already suffixed): " + skipped);
    }

    function doRename(mode) {
        var find = edFind.text;
        if (!find.length) {
            alert("Поле Find пустое.");
            return;
        }
        var replace   = edRepl.text;
        var onlyComps = cbComps.value;
        var matchCase = cbCase.value;
        var useRegex  = cbRegex.value;

        var items = collectItems();
        if (items === null) return; // scope-specific error already shown
        if (!items.length) {
            alert("По выбранному scope ничего не найдено.");
            return;
        }

        var pattern = useRegex ? find : escapeRegex(find);
        var rxAll, rxFirst;
        try {
            rxAll   = new RegExp(pattern, matchCase ? "g" : "gi");
            rxFirst = new RegExp(pattern, matchCase ? ""  : "i");
        } catch (e) {
            alert("Bad regex: " + e.toString());
            return;
        }

        app.beginUndoGroup(mode === "truncate" ? "Truncate names after first match" : "Find/replace in names");
        var changed = 0, skipped = 0;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (onlyComps && !(it instanceof CompItem)) continue;
            var oldName = it.name;
            var newName;
            if (mode === "truncate") {
                var m = oldName.match(rxFirst);
                if (!m) { skipped++; continue; }
                newName = oldName.substring(0, m.index + m[0].length);
            } else {
                newName = oldName.replace(rxAll, replace);
            }
            if (newName === oldName || newName.length === 0) {
                skipped++;
                continue;
            }
            try {
                it.name = newName;
                changed++;
            } catch (err) {
                skipped++;
            }
        }
        app.endUndoGroup();

        alert("Renamed: " + changed + "\nSkipped: " + skipped);
    }

    // ---------- helpers ----------

    function collectItems() {
        var out = [];
        if (rbSel.value) {
            var sel = app.project.selection;
            for (var i = 0; i < sel.length; i++) out.push(sel[i]);
        } else if (rbFolder.value) {
            var sel = app.project.selection;
            var anyFolder = false;
            for (var j = 0; j < sel.length; j++) {
                if (sel[j] instanceof FolderItem) {
                    anyFolder = true;
                    collectFromFolder(sel[j], out);
                }
            }
            if (!anyFolder) {
                alert("Выдели хотя бы одну папку в Project panel.");
                return null;
            }
        } else {
            for (var k = 1; k <= app.project.items.length; k++) {
                out.push(app.project.items[k]);
            }
        }
        return out;
    }

    function collectFromFolder(folder, out) {
        for (var k = 1; k <= folder.items.length; k++) {
            var item = folder.items[k];
            out.push(item);
            if (item instanceof FolderItem) collectFromFolder(item, out);
        }
    }

    function escapeRegex(s) {
        return s.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");
    }

    function endsWith(str, suf) {
        return str.length >= suf.length &&
               str.substring(str.length - suf.length) === suf;
    }
})(this);
