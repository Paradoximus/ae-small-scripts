//@target aftereffects
// Small Scripts Launcher — dockable ScriptUI panel
// -------------------------------------------------
// Сканирует папку, на каждый .js/.jsx делает кнопку.
// Метаданные (name / desc / prep) читаются прямо из заголовка скрипта —
// блок /* @ae-script ... */ в формате YAML-like key: value.
// См. README_convention.md в той же папке.
//
// КНОПКИ: hover → подсказка с описанием и блоком "ПЕРЕД ЗАПУСКОМ".
// Reload — пересканировать папку без рестарта AE.
// Folder... — сменить папку (путь сохраняется в app.settings).

(function (thisObj) {

    var SETTINGS_SECTION = "SmallScriptsLauncher";
    var SETTINGS_KEY     = "folderPath";
    // Папка автора. На другой машине её нет — панель попросит выбрать свою через Folder...,
    // выбор запомнится в настройках AE.
    var DEFAULT_FOLDER   = "F:/Yandex.Disk/aaa_AEstuff/!!AE_SmallScripts";
    var PANEL_FILE_NAME  = "small_scripts_panel.jsx"; // lowercase для сравнения
    var HEADER_READ_BYTES = 8192;

    // ===== Path resolution =====

    function resolveFolderPath() {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, SETTINGS_KEY)) {
                var saved = app.settings.getSetting(SETTINGS_SECTION, SETTINGS_KEY);
                if (saved && new Folder(saved).exists) return saved;
            }
        } catch (e) {}
        return DEFAULT_FOLDER;
    }

    function displayName(file) {
        try { return decodeURI(file.name); } catch (e) { return file.name; }
    }

    var folderPath = resolveFolderPath();

    // ===== Header parser =====
    // Ищет первый блок /* @ae-script ... */, парсит key: value
    // и многострочные key: |
    //   continuation lines (с отступом >=2 пробела)
    // Возвращает { name, desc, prep, ... } либо null.
    function parseAeScriptHeader(file) {
        var savedEncoding = file.encoding;
        file.encoding = "UTF-8";
        var text = "";
        try {
            if (file.open("r")) {
                try { text = file.read(HEADER_READ_BYTES); } catch (e) { text = ""; }
                file.close();
            }
        } catch (e) {}
        file.encoding = savedEncoding;

        if (!text) return null;

        var m = text.match(/\/\*\s*@ae-script\b([\s\S]*?)\*\//);
        if (!m) return null;
        var body = m[1];

        var lines = body.split(/\r?\n/);
        var result = {};
        var currentKey = null;
        var buffer = null;
        var keyLineRe = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:\s*(.*)$/;   // \s* — иначе 'prep:  |' с двумя пробелами не открывает многострочный блок

        function flush() {
            if (currentKey !== null) {
                result[currentKey] = buffer.join("\n").replace(/\s+$/, "");
            }
            currentKey = null;
            buffer = null;
        }

        for (var i = 0; i < lines.length; i++) {
            var raw = lines[i];
            // снять ведущий "* " (JSDoc-style), если есть
            var stripped = raw.replace(/^\s*\*\s?/, "");
            var leadingWs = raw.match(/^(\s*)/)[1].length;
            var jsdocLine = !!raw.match(/^\s*\*/);
            var isTopLevel = leadingWs === 0 || jsdocLine;
            var km = isTopLevel ? stripped.match(keyLineRe) : null;

            if (km) {
                flush();
                var key = km[1].toLowerCase();
                var val = km[2].replace(/\s+$/, "");
                if (val === "|") {
                    currentKey = key;
                    buffer = [];
                } else {
                    result[key] = val;
                }
            } else if (currentKey !== null) {
                // continuation: снять до 2 ведущих пробелов
                var line = raw.replace(/^\s{0,2}/, "");
                // если строка была "  * text" в JSDoc-стиле — снять и звёздочку
                line = line.replace(/^\*\s?/, "");
                buffer.push(line);
            }
        }
        flush();

        return result;
    }

    // ===== Build window =====

    var win = (thisObj instanceof Panel)
        ? thisObj
        : new Window("palette", "Small Scripts", undefined, {resizeable: true});

    win.orientation   = "column";
    win.alignChildren = ["fill", "top"];
    win.spacing       = 4;
    win.margins       = 8;

    var bar = win.add("group");
    bar.orientation   = "row";
    bar.alignChildren = ["left", "center"];
    bar.spacing       = 4;

    var btnReload = bar.add("button", undefined, "Reload");
    btnReload.preferredSize.width = 70;
    btnReload.helpTip = "Пересканировать папку без перезагрузки AE.";

    var btnFolder = bar.add("button", undefined, "Folder...");
    btnFolder.preferredSize.width = 70;
    btnFolder.helpTip = "Сменить папку со скриптами (путь сохраняется в app.settings).";

    var btnOpen = bar.add("button", undefined, "Open dir");
    btnOpen.preferredSize.width = 70;
    btnOpen.helpTip = "Открыть папку со скриптами в Проводнике.";

    var pathLbl = win.add("statictext", undefined, "", {truncate: "middle"});
    pathLbl.characters = 40;
    pathLbl.helpTip = "Текущая папка со скриптами.";

    var sep = win.add("panel");
    sep.alignment = ["fill", "top"];
    sep.preferredSize.height = 2;

    var listGroup = win.add("group");
    listGroup.orientation   = "column";
    listGroup.alignChildren = ["fill", "top"];
    listGroup.spacing       = 3;
    listGroup.margins       = 0;

    // ===== Helpers =====

    function clearGroup(g) {
        while (g.children.length > 0) {
            g.remove(g.children[0]);
        }
    }

    function makeHelpTip(meta, fileName) {
        if (!meta) {
            return fileName + "\n\n(нет @ae-script заголовка — см. README_convention.md, потом Reload)";
        }
        var lines = [];
        var head = (meta.name || fileName);
        if (meta.name && meta.name !== fileName) head += "   [" + fileName + "]";
        lines.push(head);
        if (meta.desc) { lines.push(""); lines.push(meta.desc); }
        if (meta.prep) { lines.push(""); lines.push("ПЕРЕД ЗАПУСКОМ:"); lines.push(meta.prep); }
        if (meta.tags) { lines.push(""); lines.push("tags: " + meta.tags); }
        return lines.join("\n");
    }

    function runScript(file) {
        try {
            $.evalFile(file);
        } catch (e) {
            alert(
                "Ошибка при запуске " + displayName(file) + ":\n" +
                e.toString() +
                (e.line ? "\nстрока: " + e.line : "")
            );
        }
    }

    function listScripts(folder) {
        var files = folder.getFiles(function (f) {
            if (!(f instanceof File)) return false;
            var n = displayName(f).toLowerCase();
            if (n === PANEL_FILE_NAME) return false;
            if (n.indexOf(".bak") !== -1) return false;
            return !!n.match(/\.(jsx|js)$/);
        });
        files.sort(function (a, b) {
            var na = displayName(a).toLowerCase(), nb = displayName(b).toLowerCase();
            return na < nb ? -1 : (na > nb ? 1 : 0);
        });
        return files;
    }

    function relayout() {
        try {
            win.layout.layout(true);
            win.layout.resize();
        } catch (e) {}
    }

    function refresh() {
        clearGroup(listGroup);
        pathLbl.text = folderPath;

        var folder = new Folder(folderPath);
        if (!folder.exists) {
            var st = listGroup.add("statictext", undefined, "Папка не найдена. Folder... → выбрать.");
            st.alignment = ["fill", "top"];
            relayout();
            return;
        }

        var files = listScripts(folder);
        if (files.length === 0) {
            listGroup.add("statictext", undefined, "В папке нет .js / .jsx файлов.");
            relayout();
            return;
        }

        for (var i = 0; i < files.length; i++) {
            (function (file) {
                var meta  = parseAeScriptHeader(file);
                var fname = displayName(file);
                var label = (meta && meta.name) ? meta.name : fname;

                var btn = listGroup.add("button", undefined, label);
                btn.helpTip   = makeHelpTip(meta, fname);
                btn.alignment = ["fill", "top"];
                btn.onClick   = function () { runScript(file); };
            })(files[i]);
        }

        relayout();
    }

    btnReload.onClick = refresh;

    btnFolder.onClick = function () {
        var start = (new Folder(folderPath).exists) ? new Folder(folderPath) : Folder.desktop;
        var picked = Folder.selectDialog("Папка со скриптами", start);
        if (picked) {
            folderPath = picked.fsName.replace(/\\/g, "/");
            try {
                app.settings.saveSetting(SETTINGS_SECTION, SETTINGS_KEY, folderPath);
            } catch (e) {}
            refresh();
        }
    };

    btnOpen.onClick = function () {
        var f = new Folder(folderPath);
        if (f.exists) f.execute();
    };

    refresh();

    win.onResizing = win.onResize = function () { this.layout.resize(); };

    if (win instanceof Window) {
        win.center();
        win.show();
    }

})(this);
