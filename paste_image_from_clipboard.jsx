/* @ae-script
name:  Paste image from clipboard
desc:  Сохраняет картинку из буфера обмена в <projectDir>/imgs_pasted/pasted_<timestamp>.png и импортирует в проект (в бин imgs_pasted). Под капотом — PowerShell.
prep:  |
  - Проект должен быть СОХРАНЁН (нужен projectDir)
  - В буфере обмена должна быть картинка (Snipping Tool / PrintScreen / любой grabber)
tags:  import, clipboard
*/

(function pasteImageFromClipboard() {
    if (!app.project.file) {
        alert("Сохрани проект перед использованием скрипта.");
        return;
    }

    var projectDir = app.project.file.parent.fsName;
    var outDir = projectDir + "\\imgs_pasted";

    var now = new Date();
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    var timestamp = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
                    "_" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    var outFile = outDir + "\\pasted_" + timestamp + ".png";

    // Пишем во фиксированный путь без пробелов
    var tmpDir  = "C:\\Temp";
    var tmpPs1  = tmpDir + "\\ae_paste.ps1";
    var tmpLog  = tmpDir + "\\ae_paste_result.txt";

    // Создаём C:\Temp если нет
    var tmpFolder = new Folder(tmpDir);
    if (!tmpFolder.exists) tmpFolder.create();

    var psLines = [
        "Add-Type -Assembly System.Windows.Forms",
        "$img = [System.Windows.Forms.Clipboard]::GetImage()",
        "if ($img -eq $null) { 'NO_IMAGE' | Out-File -Encoding utf8 '" + tmpLog + "'; exit }",
        "if (!(Test-Path '" + outDir + "')) { New-Item -ItemType Directory -Path '" + outDir + "' | Out-Null }",
        "$img.Save('" + outFile + "')",
        "'OK' | Out-File -Encoding utf8 '" + tmpLog + "'"
    ];

    var ps1File = new File(tmpPs1);
    ps1File.encoding = "UTF-8";
    if (!ps1File.open("w")) {
        alert("Не удалось записать ps1:\n" + tmpPs1);
        return;
    }
    ps1File.write(psLines.join("\r\n"));
    ps1File.close();

    // Проверяем что файл создался
    var check = new File(tmpPs1);
    if (!check.exists) {
        alert("PS1 файл не создан:\n" + tmpPs1);
        return;
    }

    // Запуск через cmd /c — более надёжно на Windows
    var cmd = 'cmd /c powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + tmpPs1 + '"';
    system.callSystem(cmd);

    // Небольшая пауза — ждём завершения
    var start = (new Date()).getTime();
    while ((new Date()).getTime() - start < 3000) { /* wait 3s */ }

    // Читаем результат
    var logFile = new File(tmpLog);
    if (!logFile.exists) {
        alert("Лог не создан.\nPS1 был: " + tmpPs1 + "\nПроверь его вручную в PS.");
        return;
    }
    logFile.encoding = "UTF-8";
    logFile.open("r");
    var result = logFile.read();
    logFile.close();

    result = result.replace(/^\s+|\s+$/g, "");

    if (result.indexOf("NO_IMAGE") !== -1) {
        alert("В буфере нет картинки.");
        return;
    }
    if (result.indexOf("OK") === -1) {
        alert("Неизвестный результат: '" + result + "'");
        return;
    }

    // Импорт в проект AE
    var imgFile = new File(outFile);
    if (!imgFile.exists) {
        alert("Файл не найден после сохранения:\n" + outFile);
        return;
    }

    var projectBin = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        var item = app.project.item(i);
        if (item instanceof FolderItem && item.name === "imgs_pasted") {
            projectBin = item;
            break;
        }
    }
    if (!projectBin) {
        projectBin = app.project.items.addFolder("imgs_pasted");
    }

    var imported = app.project.importFile(new ImportOptions(imgFile));
    imported.parentFolder = projectBin;

    alert("Готово!\nСохранено и импортировано:\n" + outFile);
})();
