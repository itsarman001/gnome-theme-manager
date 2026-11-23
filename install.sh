#!/usr/bin/env bash
set -e
UUID="gnome-theme-manager@itsarman001"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
SRC="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$DEST"
cp -r "$SRC"/{metadata.json,extension.js,prefs.js,lib.js,schemas} "$DEST"/
glib-compile-schemas "$DEST/schemas"

echo "Installed to $DEST"
echo "Log out and back in (Wayland), then run:"
echo "  gnome-extensions enable $UUID"
echo "  gnome-extensions prefs  $UUID"
