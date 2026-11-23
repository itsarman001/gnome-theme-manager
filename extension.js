// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {applyProfile} from './lib.js';

const DEBOUNCE_MS = 400;
const TICK_SECONDS = 20;

export default class GnomeThemeManager extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        this._applyId = 0;
        this._lastPeriod = null;

        // Dark/light switched by anything (Quick Settings, GNOME Settings, schedule...)
        this._ifaceSig = this._iface.connect('changed::color-scheme', () => this._queueApply());

        // Preferences edited: re-apply, and re-enforce the schedule if it changed
        this._settingsSig = this._settings.connect('changed', (_s, key) => {
            if (['auto-enabled', 'light-time', 'dark-time'].includes(key))
                this._enforceSchedule();
            this._queueApply();
        });

        // Schedule timer
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TICK_SECONDS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });

        // Runs at login (the extension is enabled when the session starts)
        this._enforceSchedule();
        this._queueApply();
    }

    disable() {
        if (this._applyId) {
            GLib.source_remove(this._applyId);
            this._applyId = 0;
        }
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        if (this._ifaceSig) {
            this._iface.disconnect(this._ifaceSig);
            this._ifaceSig = 0;
        }
        if (this._settingsSig) {
            this._settings.disconnect(this._settingsSig);
            this._settingsSig = 0;
        }
        this._iface = null;
        this._settings = null;
    }

    // ----- applying -----

    _currentMode() {
        return this._iface.get_string('color-scheme') === 'prefer-dark' ? 'dark' : 'light';
    }

    _queueApply() {
        if (this._applyId)
            GLib.source_remove(this._applyId);
        this._applyId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            this._applyId = 0;
            try {
                applyProfile(this._settings, this._currentMode());
            } catch (e) {
                console.error(`[gnome-theme-manager] ${e.message}`);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // ----- schedule -----

    _minutes(str) {
        const [h, m] = str.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    }

    // Which mode the clock says we should be in right now (null if equal times)
    _scheduledMode() {
        const now = GLib.DateTime.new_now_local();
        const t = now.get_hour() * 60 + now.get_minute();
        const light = this._minutes(this._settings.get_string('light-time'));
        const dark = this._minutes(this._settings.get_string('dark-time'));
        if (light === dark)
            return null;
        if (light < dark)
            return (t >= light && t < dark) ? 'light' : 'dark';
        return (t >= dark && t < light) ? 'dark' : 'light';
    }

    _setColorScheme(mode) {
        const value = mode === 'dark' ? 'prefer-dark' : 'default';
        if (this._iface.get_string('color-scheme') !== value)
            this._iface.set_string('color-scheme', value);   // triggers _queueApply
    }

    _enforceSchedule() {
        if (!this._settings.get_boolean('auto-enabled')) {
            this._lastPeriod = null;
            return;
        }
        const mode = this._scheduledMode();
        if (!mode)
            return;
        this._lastPeriod = mode;
        this._setColorScheme(mode);
    }

    // Only acts when the schedule crosses a boundary, so a manual switch
    // in the middle of a period is not overridden. Also catches up after suspend.
    _tick() {
        if (!this._settings.get_boolean('auto-enabled'))
            return;
        const mode = this._scheduledMode();
        if (mode && mode !== this._lastPeriod) {
            this._lastPeriod = mode;
            this._setColorScheme(mode);
        }
    }
}
