# GameAtlas for Windows

GameAtlas is an offline-first Windows game collection app with cards, list view, score colours, filters, wishlists, descriptions, and online game lookup.

## Install and first run
Run the latest GameAtlas Setup executable. Node.js is not required. The installer is unsigned, so Windows may show an unknown-publisher notice.

A fresh installation contains **zero games**. The first-run wizard lets you:
1. Start an empty library with the standard game fields, or import a complete .gameatlas backup or legacy JSON export.
2. Choose a local backup folder.
3. Choose backups after each library change, once a day, or manual only.

Existing installations retain their database and artwork. Upgrades do not clear a collection or replace it with the empty starter. Existing backup-folder preferences are retained; older installations default to backups after changes.

Use the cog beside Add game to reopen Settings. The footer shortcut and all property-definition editors have been removed. Game values remain editable. Imported libraries retain their existing fields; users cannot add, delete, rename, or change field definitions in the editor.

## Backup scheduling
- After changes: creates a complete local backup after a game is added, modified, or deleted.
- Once a day: runs while the app is open, checked once per minute, using the local calendar date. If the app is closed, it catches up on the next launch.
- Manual only: creates no scheduled backups. Use Save complete backup.
- Settings remain changeable at any time. Automatic modes make an initial baseline when setup/settings are saved.
- The chosen folder may be a Google Drive folder. GameAtlas writes locally; your cloud-sync software handles uploading.
- Restore always creates a safety backup in the app's internal backups folder, including in manual mode.
- Selected-folder scheduled backups are not automatically deleted. Prior-version backups are left intact.
- Backup failures are reported after saving a game or in Settings; the game remains saved locally.

## Complete backups and restore
Save complete backup creates one .gameatlas file containing a consistent SQLite snapshot and cached thumbnail bytes, preserving all game metadata, descriptions, fields, choices, scores, links, and artwork references.

Manual backup first attempts missing linked images. If some remain unavailable, the app reports them and lets you cancel or explicitly save with missing thumbnails. Scheduled backups include what is cached at that moment and record missing images.

Restore validates the database and image checksums, creates a safety copy, and restores the collection and images together. Interrupted restores have recovery support. Older JSON imports remain supported, but have no embedded images.

Machine-specific settings and nested backup histories are not included in a library backup. Choose the backup location/schedule on the new PC during setup.

## Storage
The live database and image cache normally live in %APPDATA%/GameAtlas, separately from this repository and the installer. Keep the live database outside cloud-sync folders. Installer upgrades preserve it; uninstall does not deliberately remove it.

Internet is required only for lookup, uncached artwork, and opening external links. The old website and desktop app do not synchronize.

## Development
Use Node.js 22.13 or newer on Windows:
- npm ci
- npm run build
- npm run typecheck
- npm test
- npm run test:desktop
- npm start
- npm run dist

Generated outputs are ignored by Git. Installers are in release. Install newer installers manually to update. Test fixtures contain generic sample games and are not packaged.

The renderer uses a sandbox, context isolation, and a limited validated preload interface. No local HTTP server is used.
The former website source is retained under the website-before-desktop Git tag; older personal exports remain in the ignored BACKUPS folder.
