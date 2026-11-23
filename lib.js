// SPDX-License-Identifier: GPL-2.0-or-later
// Shared by extension.js (shell process) and prefs.js (prefs process).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const SHELL_DEFAULT = '__default__';

const FALLBACK_ACCENTS = ['blue', 'teal', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'slate'];

export const ACCENT_HEX = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800',
    orange: '#ed5b00', red: '#e62d42', pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
};

// ---------- schema helpers ----------

export function schemaExists(id) {
    const src = Gio.SettingsSchemaSource.get_default();
    return !!src && !!src.lookup(id, true);
}

export function getSystemSettings(id) {
    return schemaExists(id) ? new Gio.Settings({schema_id: id}) : null;
}

// ---------- directory scanning ----------

function subdirs(path) {
    const out = [];
    try {
        const en = Gio.File.new_for_path(path).enumerate_children(
            'standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = en.next_file(null)) !== null)
            out.push(info.get_name());
        en.close(null);
    } catch (_e) { /* folder missing */ }
    return out;
}

const isDir = p => GLib.file_test(p, GLib.FileTest.IS_DIR);
const isFile = p => GLib.file_test(p, GLib.FileTest.IS_REGULAR);

function iconBases() {
    return [
        GLib.build_filenamev([GLib.get_home_dir(), '.icons']),
        GLib.build_filenamev([GLib.get_user_data_dir(), 'icons']),
        ...GLib.get_system_data_dirs().map(d => GLib.build_filenamev([d, 'icons'])),
    ];
}

function themeBases() {
    return [
        GLib.build_filenamev([GLib.get_home_dir(), '.themes']),
        GLib.build_filenamev([GLib.get_user_data_dir(), 'themes']),
        ...GLib.get_system_data_dirs().map(d => GLib.build_filenamev([d, 'themes'])),
    ];
}

function scan(bases, test) {
    const found = new Set();
    for (const base of bases) {
        for (const name of subdirs(base)) {
            if (!found.has(name) && test(GLib.build_filenamev([base, name])))
                found.add(name);
        }
    }
    return [...found].sort((a, b) => a.localeCompare(b));
}

function hasDirectoriesKey(indexPath) {
    try {
        const [ok, bytes] = GLib.file_get_contents(indexPath);
        return ok && new TextDecoder().decode(bytes).includes('Directories=');
    } catch (_e) {
        return false;
    }
}

// ---------- listings (same rules as GNOME Tweaks) ----------

export function listAccents() {
    try {
        const schema = Gio.SettingsSchemaSource.get_default()
            .lookup('org.gnome.desktop.interface', true);
        if (schema?.has_key('accent-color')) {
            const range = schema.get_key('accent-color').get_range();
            const list = range.get_child_value(1).get_variant().get_strv();
            if (list.length)
                return list;
        }
    } catch (_e) { /* fall through */ }
    return FALLBACK_ACCENTS;
}

export function listCursorThemes() {
    return scan(iconBases(), p => isDir(`${p}/cursors`));
}

export function listIconThemes() {
    return scan(iconBases(), p =>
        !p.endsWith('/hicolor') && hasDirectoriesKey(`${p}/index.theme`));
}

export function listShellThemes() {
    return scan(themeBases(), p => isFile(`${p}/gnome-shell/gnome-shell.css`));
}

export function listLegacyThemes() {
    const found = scan(themeBases(), p =>
        isFile(`${p}/gtk-3.0/gtk.css`) || isFile(`${p}/gtk-4.0/gtk.css`));
    // Built into GTK3 itself, not on disk
    for (const builtin of ['Adwaita', 'Adwaita-dark', 'HighContrast', 'HighContrastInverse'])
        if (!found.includes(builtin))
            found.push(builtin);
    return found.sort((a, b) => a.localeCompare(b));
}

// ---------- apply a profile ----------

export function applyProfile(settings, mode) {
    const get = k => settings.get_string(`${mode}-${k}`);

    const iface = getSystemSettings('org.gnome.desktop.interface');
    const bg = getSystemSettings('org.gnome.desktop.background');
    const user = getSystemSettings('org.gnome.shell.extensions.user-theme');

    const set = (gs, key, value) => {
        try {
            if (gs && value !== '' && gs.get_string(key) !== value)
                gs.set_string(key, value);
        } catch (e) {
            console.error(`[gnome-theme-manager] failed to set ${key}: ${e.message}`);
        }
    };

    set(iface, 'accent-color', get('accent'));
    set(iface, 'cursor-theme', get('cursor'));
    set(iface, 'icon-theme', get('icons'));
    set(iface, 'gtk-theme', get('legacy'));

    const wall = get('background');
    if (wall !== '' && bg) {
        const uri = Gio.File.new_for_path(wall).get_uri();
        set(bg, 'picture-uri', uri);
        set(bg, 'picture-uri-dark', uri);
    }

    const shell = get('shell');
    if (user && shell !== '') {
        try {
            const name = shell === SHELL_DEFAULT ? '' : shell;
            if (user.get_string('name') !== name)
                user.set_string('name', name);
        } catch (e) {
            console.error(`[gnome-theme-manager] failed to set shell theme: ${e.message}`);
        }
    }
}
