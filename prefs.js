// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import * as Lib from './lib.js';

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function comboRow(title, settings, key, entries, subtitle = '') {
    const cur = settings.get_string(key);
    if (cur !== '' && !entries.some(e => e.value === cur))
        entries.push({label: `${cur} (not found)`, value: cur});

    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(entries.map(e => e.label)),
    });
    row.selected = Math.max(0, entries.findIndex(e => e.value === cur));
    row.connect('notify::selected', () =>
        settings.set_string(key, entries[row.selected].value));
    return row;
}

class Preview {
    constructor(settings, mode) {
        this._settings = settings;
        this._mode = mode;

        this._css = new Gtk.CssProvider();
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), this._css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        this._picture = new Gtk.Picture({
            content_fit: Gtk.ContentFit.COVER,
            height_request: 200,
            hexpand: true,
        });
        this._picture.add_css_class(`ats-wall-${mode}`);

        this._dot = new Gtk.Box({width_request: 14, height_request: 14, valign: Gtk.Align.CENTER});
        this._dot.add_css_class(`ats-dot-${mode}`);
        this._accentLabel = new Gtk.Label({xalign: 0});
        this._info = new Gtk.Label({xalign: 0, wrap: true, css_classes: ['caption']});

        const accentBox = new Gtk.Box({spacing: 8});
        accentBox.append(this._dot);
        accentBox.append(this._accentLabel);

        const card = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 6,
            halign: Gtk.Align.START, valign: Gtk.Align.END,
            margin_start: 12, margin_bottom: 12,
        });
        card.add_css_class(`ats-card-${mode}`);
        card.append(accentBox);
        card.append(this._info);

        this.widget = new Gtk.Overlay({child: this._picture, overflow: Gtk.Overflow.HIDDEN});
        this.widget.add_css_class(`ats-preview-${mode}`);
        this.widget.add_overlay(card);
        this.update();
    }

    update() {
        const g = k => this._settings.get_string(`${this._mode}-${k}`);
        let wall = g('background');
        if (!wall) {
            const bg = Lib.getSystemSettings('org.gnome.desktop.background');
            const uri = bg?.get_string(this._mode === 'dark' ? 'picture-uri-dark' : 'picture-uri');
            if (uri)
                wall = Gio.File.new_for_uri(uri).get_path() ?? '';
        }
        if (wall && GLib.file_test(wall, GLib.FileTest.EXISTS))
            this._picture.set_filename(wall);
        else
            this._picture.set_filename(null);

        const accent = g('accent');
        const hex = Lib.ACCENT_HEX[accent] ?? '#3584e4';
        this._accentLabel.label = accent ? cap(accent) : 'Accent unchanged';
        this._css.load_from_string(`
            .ats-preview-${this._mode} { border-radius: 12px; }
            .ats-dot-${this._mode} { background: ${hex}; border-radius: 99px; }
            .ats-card-${this._mode} {
                background: alpha(black, 0.65); color: white;
                border-radius: 10px; padding: 10px 14px;
            }
        `);

        const shell = g('shell') === Lib.SHELL_DEFAULT ? 'Default' : g('shell');
        const dash = v => v || '—';
        this._info.label =
            `Icons: ${dash(g('icons'))}\nCursor: ${dash(g('cursor'))}\n` +
            `Shell: ${dash(shell)}\nLegacy: ${dash(g('legacy'))}`;
    }
}

export default class GnomeThemeManagerPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(600, 860);

        window.add(this._modePage(window, settings, 'light', 'Light', 'weather-clear-symbolic'));
        window.add(this._modePage(window, settings, 'dark', 'Dark', 'weather-clear-night-symbolic'));
        window.add(this._autoPage(settings));
    }

    _modePage(window, settings, mode, title, icon) {
        const page = new Adw.PreferencesPage({title, icon_name: icon, name: mode});
        const key = k => `${mode}-${k}`;

        // 1. Preview
        const preview = new Preview(settings, mode);
        const previewGroup = new Adw.PreferencesGroup({title: 'Preview'});
        previewGroup.add(preview.widget);
        page.add(previewGroup);

        const group = new Adw.PreferencesGroup();
        page.add(group);

        // 2. Accent colour
        group.add(comboRow('Accent Color', settings, key('accent'), [
            {label: 'Unchanged', value: ''},
            ...Lib.listAccents().map(a => ({label: cap(a), value: a})),
        ]));

        // 3. Background
        const bgRow = new Adw.ActionRow({title: 'Background'});
        const refreshBg = () => {
            const p = settings.get_string(key('background'));
            bgRow.subtitle = p ? GLib.path_get_basename(p) : 'Unchanged';
        };
        refreshBg();
        const choose = new Gtk.Button({label: 'Choose…', valign: Gtk.Align.CENTER});
        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Leave wallpaper unchanged', css_classes: ['flat'],
        });
        choose.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title: `Select ${title} wallpaper`});
            const filter = new Gtk.FileFilter({name: 'Images'});
            filter.add_mime_type('image/*');
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);
            dialog.set_filters(filters);
            const pics = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
            if (pics)
                dialog.set_initial_folder(Gio.File.new_for_path(pics));
            dialog.open(window, null, (d, res) => {
                try {
                    const file = d.open_finish(res);
                    settings.set_string(key('background'), file.get_path());
                } catch (_e) { /* cancelled */ }
            });
        });
        clear.connect('clicked', () => settings.set_string(key('background'), ''));
        bgRow.add_suffix(choose);
        bgRow.add_suffix(clear);
        group.add(bgRow);

        // 4. Cursor theme
        group.add(comboRow('Cursor', settings, key('cursor'), [
            {label: 'Unchanged', value: ''},
            ...Lib.listCursorThemes().map(n => ({label: n, value: n})),
        ]));

        // 5. Icons
        group.add(comboRow('Icons', settings, key('icons'), [
            {label: 'Unchanged', value: ''},
            ...Lib.listIconThemes().map(n => ({label: n, value: n})),
        ]));

        // 6. Shell theme
        const userThemeOk = Lib.schemaExists('org.gnome.shell.extensions.user-theme');
        group.add(comboRow('Shell', settings, key('shell'), [
            {label: 'Unchanged', value: ''},
            {label: 'Default', value: Lib.SHELL_DEFAULT},
            ...Lib.listShellThemes().map(n => ({label: n, value: n})),
        ], userThemeOk ? '' : 'Requires the User Themes extension (gnome-shell-extension-user-theme)'));

        // 7. Legacy applications
        group.add(comboRow('Legacy Applications', settings, key('legacy'), [
            {label: 'Unchanged', value: ''},
            ...Lib.listLegacyThemes().map(n => ({label: n, value: n})),
        ]));

        const id = settings.connect('changed', (_s, k) => {
            if (k.startsWith(`${mode}-`)) {
                preview.update();
                refreshBg();
            }
        });
        window.connect('close-request', () => {
            settings.disconnect(id);
            return false;
        });

        return page;
    }

    _autoPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Auto Mode', icon_name: 'preferences-system-time-symbolic', name: 'auto',
        });
        const group = new Adw.PreferencesGroup({
            description: 'Switches GNOME between light and dark using the system clock.',
        });
        page.add(group);

        const enable = new Adw.SwitchRow({title: 'Enable Auto Mode'});
        settings.bind('auto-enabled', enable, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enable);

        const timeRow = (title, key) => {
            const row = new Adw.ActionRow({title});
            const [h, m] = settings.get_string(key).split(':').map(Number);
            const mk = (value, upper) => {
                const spin = new Gtk.SpinButton({
                    adjustment: new Gtk.Adjustment({lower: 0, upper, step_increment: 1, value}),
                    wrap: true, orientation: Gtk.Orientation.VERTICAL,
                    valign: Gtk.Align.CENTER, width_chars: 2,
                });
                spin.connect('output', () => {
                    spin.set_text(String(spin.get_value_as_int()).padStart(2, '0'));
                    return true;
                });
                return spin;
            };
            const hour = mk(h || 0, 23);
            const min = mk(m || 0, 59);
            const save = () => settings.set_string(key,
                `${String(hour.get_value_as_int()).padStart(2, '0')}:${String(min.get_value_as_int()).padStart(2, '0')}`);
            hour.connect('value-changed', save);
            min.connect('value-changed', save);
            row.add_suffix(hour);
            row.add_suffix(new Gtk.Label({label: ':'}));
            row.add_suffix(min);
            settings.bind('auto-enabled', row, 'sensitive', Gio.SettingsBindFlags.GET);
            return row;
        };

        group.add(timeRow('Light Theme Switch Time', 'light-time'));
        group.add(timeRow('Dark Theme Switch Time', 'dark-time'));
        return page;
    }
}
