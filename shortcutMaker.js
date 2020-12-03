const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const AppDisplay = imports.ui.appDisplay;
const PopupMenu = imports.ui.popupMenu;

var S_IWOTH = 0o00002;

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
        let shortcutMaker = new ShortcutMaker(appPath);
        shortcutMaker.makeShortcut();
    });
}

// decides which permission are required, adds them, creates the shortcut and allows launching
class ShortcutMaker {
    constructor(appPath) {
        this._appPath = appPath;
        this._desktop = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP);
        this._info = new LauncherInfo(appPath);
        this._current = GLib.get_user_name();
    }

    makeShortcut() {
        this._info.initInfo(() => {this._decideAction()});
    }


    _decideAction() {
        log('Current user = ' + this._current);
        log('Owner = ' + this._info.owner);
        log('Can execute = ' + this._info.canExecute);
        log('Writable by others = ' + this._info.writableByOthers);

        if(this._current === this._info.owner) {
            if(this._info.writableByOthers) {
                log('Removing write bit for others');
                this._fixPermissions();
            }
            else {
                log('No extra permissions needed');
                this._createLink();
            }
        }
        else {
            let fixWrite = this._info.writableByOthers;
            let fixExec = !this._info.canExecute;
            if(fixWrite || fixExec) {
                log('Requiring authentication to fix permissions');
                this._sudoFixPermissions(fixWrite, fixExec);
            }
            else {
                log('No extra permissions needed');
                this._createLink();
            }
        }
    }

    _fixPermissions() {
        // the only action needed is remove writable by others
        let args = ['chmod', 'o-w', this._appPath];
        execAsync(args, (out, err) => {
            if(err === undefined) {
                this._createLink();
            }
            else {
                log(err);  // unexpected error
            }
        });
    }

    calcMode(fixWrite, fixExec) {
        let mode = '';
        if(fixWrite) {
            mode = 'o-w';
            if(fixExec) {
                mode = 'o-w,a+x';
            }
        }
        else {
            if(fixExec) {
                mode = 'a+x';
            }
        }
        return mode;
    }

    // require permission before executing command as root, using Gio subprocess to use pkexec
    _sudoFixPermissions(fixWrite, fixExec) {
        let mode = this.calcMode(fixWrite, fixExec);
        let args = ['pkexec', 'chmod', mode, this._appPath];
        execAsync(args, (out, err) => {
            // if we have successfully changed the permissions we create the link
            if(err === undefined) {
                log('Authenticated successfully');
                this._createLink(this._appPath);
            }
            else {
                log(err);  // may be request dismissed
            }
        });
    }

    _createLink() {
        // create a soft symbolic link on the desktop
        execAsync(['ln', '-s', this._appPath, this._desktop], () => {});
    }
}

// contains the info about the .desktop file
class LauncherInfo {
    constructor(appPath) {
        this.file = Gio.File.new_for_path(appPath);
    }

    initInfo(callback) {
        this.file.query_info_async(
            'access::can-execute,owner::user,unix::mode',
            Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_DEFAULT,
            null,
            (source, result) => {
                let fileInfo = source.query_info_finish(result);
                this.owner = fileInfo.get_attribute_as_string('owner::user');
                this.canExecute = fileInfo.get_attribute_boolean('access::can-execute');
                let unixMode = fileInfo.get_attribute_uint32('unix::mode');
                this.writableByOthers = (unixMode & S_IWOTH) != 0;
                callback();
            }
        )
    }
}
