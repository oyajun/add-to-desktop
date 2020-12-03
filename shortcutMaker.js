const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const AppDisplay = imports.ui.appDisplay;
const PopupMenu = imports.ui.popupMenu;

var DEFAULT_AND_UEXEC = 0o00764;

// executes command and pass the result to the callback function
function execAsync(args, callback) {
    let proc = Gio.Subprocess.new(
        args,
        Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
    );

    proc.communicate_utf8_async(null, null, (proc, res) => {
        let out, err;
        try {
            let [, stdout, stderr] = proc.communicate_utf8_finish(res);
            // Failure
            if (!proc.get_successful())
                err = stderr;
            // Success
            out = stdout;
        } catch (e) {
            err = e;
        }
        callback(out, err); // the async errors and outputs are passed to another function
    });
}

// override the context menu rebuild method to add the new item
function editMenuClass(parentMenu) {
    AppDisplay.AppIconMenu = class CustomMenu extends parentMenu {
        // for shell version 3.35 or earlier
        _redisplay() {
            super._redisplay();
            insertAddToDesktopButton(this);
        }

        // for shell version 3.36 or later
        _rebuildMenu() {
            super._rebuildMenu();
            insertAddToDesktopButton(this);
        }
    }
}

function insertAddToDesktopButton(menu) {
    let nameArray = ["Add to Favorites", "Remove from Favorites"]
    let itemsArray = menu._getMenuItems();
    let pos = -1;
    for(let i = itemsArray.length-1; i >= 0; i--) {
        let item = itemsArray[i];
        // check class because there are also separators or other things
        if(item instanceof PopupMenu.PopupMenuItem) {
            let label = item.label.get_text();
            if(nameArray.includes(label)) {
                pos = i;
            }
        }
    }

    let label = "Add to Desktop";
    let item;
    if(pos === -1) {
        menu._appendSeparator();
        item = menu._appendMenuItem(label); // add at the end
    }
    else {
        item = new PopupMenu.PopupMenuItem(label);
        menu.addMenuItem(item, pos+1); // insert at specific position
    }

    item.connect('activate', () => {
        let appPath = menu._source.app.get_app_info().get_filename(); // get the .desktop file complete path
        let shortcutMaker = new ShortcutMaker();
        shortcutMaker.makeShortcut(appPath);
    });
}


var ShortcutMaker = class ShortcutMaker {
    constructor() {
        this._desktop = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        this._appPath = null;
        this._appFile = null;
        this._copyPath = null;
        this._shortcutFile = null;
    }

    // calculates the copy path from the desktop path
    getCopyPath() {
        let array = this._appPath.split("/");
        let name = array.pop();
        return this._desktop + '/' + name;
    }

    makeShortcut(appPath) {
        this._appPath = appPath;
        this._appFile = Gio.File.new_for_path(this._appPath);
        this._copyPath = this.getCopyPath();
        this._shortcutFile = Gio.File.new_for_path(this._copyPath);
        this._createCopy();
    }

    _createCopy() {
        this._appFile.copy_async(
            this._shortcutFile,
            Gio.FileCopyFlags.OVERWRITE | Gio.FileCopyFlags.TARGET_DEFAULT_PERMS,
            GLib.PRIORITY_DEFAULT,
            null,
            null,
            (source, result) => {
                try {
                    source.copy_finish(result);
                    this._setExecutableBit();
                } catch(e) {
                    log(`Failed to create shortcut ${e.message}`);
                }
            });
    }

    _setExecutableBit() {
        let new_info = new Gio.FileInfo();
        new_info.set_attribute_uint32(Gio.FILE_ATTRIBUTE_UNIX_MODE, DEFAULT_AND_UEXEC);
        this._shortcutFile.set_attributes_async(new_info,
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW,
            null,
            (source, result) => {
                try {
                    source.set_attributes_finish (result);
                } catch(e) {
                    log(`Failed to set unix mode: ${e.message}`);
                }
            });
    }
}