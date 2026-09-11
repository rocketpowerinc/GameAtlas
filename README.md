# GameAtlas for Windows

GameAtlas is a private, offline-first Windows desktop game library. It keeps the original cards, list, score colours, filters, property editor, wishlist, game descriptions, and game lookup.

## Install
Run the GameAtlas Setup executable from the release folder. The installer can create a desktop shortcut. Node.js and a web browser are not required. This initial build is unsigned, so Windows may show an unknown-publisher notice.

The first launch imports the bundled 509-game snapshot, including the subsequent 315-description backfill. Existing installations are never replaced by this seed. If the website has newer changes, export its GameAtlas JSON and use Properties & backups > Restore backup in the desktop app.

## Storage and backups
The live SQLite database is stored in the Windows user's application-data directory for GameAtlas (normally %APPDATA%/GameAtlas). It is independent of the source repository and installer.
- Save complete backup creates one portable .gameatlas file containing a consistent SQLite database snapshot and the actual cached artwork bytes. All game properties, choices, descriptions, scores, source links, and metadata are preserved.
- Manual backup first attempts missing linked thumbnails. If any cannot be downloaded, the app states the missing count and offers Cancel or an explicitly incomplete backup. Games that have no artwork URL remain without artwork.
- Automatic pre-save and additional-folder backups include every locally cached image at that moment; they do not wait for the internet. Missing linked images are recorded in the archive and reported before restoring it.
- The latest 20 pre-save and 7 daily complete snapshots are retained. Pre-restore safety snapshots are retained separately. Existing legacy JSON backups are left intact.
- Choose backup folder creates additional dated .gameatlas files after saves, suitable for Google Drive. Those external copies are not automatically pruned.
- Restore backup accepts .gameatlas and older .json backups. It validates the database and image checksums, shows the game/image counts, and creates a complete safety backup before replacement. Full restores work offline and include image files. Legacy JSON restores preserve the current cache because JSON has no image bytes.
- Failed or interrupted restores recover the prior database/image combination, or finish cleanup if the replacement database was already committed.
- Backup files contain collection content and artwork, not machine-specific backup-folder settings, Electron browser caches, or recursively nested historical backups. Choose a backup folder again when moving to another PC.
- Installer upgrades preserve data. Uninstall does not deliberately delete the application-data directory.

Internet is required only for game lookup, uncached artwork, and opening game websites. The desktop app and the old hosted website do not synchronize.

## Development
Use Node.js 22.13 or newer on Windows.
- npm ci
- npm run build
- npm start
- npm run typecheck
- npm test
- npm run test:desktop
- npm run dist

Build outputs are ignored by Git: dist, desktop-dist, and release. The Windows installer is produced in release. Install a newer installer to update; automatic internet updates are not configured.

The renderer is sandboxed with Node integration disabled and context isolation enabled. Its limited preload interface validates the calling frame and request data. The app serves packaged assets through a local custom protocol; it does not run a local web server or depend on the hosted website.

## Migration history
The website source is preserved by the website-before-desktop Git tag. The desktop migration lives on codex/windows-desktop. Obsolete hosting configuration, API routes, D1 migrations, PWA files, and unused starter components were removed. The original personal backup remains in the ignored BACKUPS directory.
