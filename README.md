# GameAtlas for Windows

GameAtlas is a private, offline-first Windows desktop game library. It keeps the original cards, list, score colours, filters, property editor, wishlist, game descriptions, and game lookup.

## Install
Run the GameAtlas Setup executable from the release folder. The installer can create a desktop shortcut. Node.js and a web browser are not required. This initial build is unsigned, so Windows may show an unknown-publisher notice.

The first launch imports the bundled 509-game snapshot, including the subsequent 315-description backfill. Existing installations are never replaced by this seed. If the website has newer changes, export its GameAtlas JSON and use Properties & backups > Restore backup in the desktop app.

## Storage and backups
The live SQLite database is stored in the Windows user's application-data directory for GameAtlas (normally %APPDATA%/GameAtlas). It is independent of the source repository and installer.
- Each save creates a snapshot of the previous collection; the latest 100 save snapshots are retained.
- A daily snapshot is created on launch; daily snapshots are retained.
- Save backup exports a compatible GameAtlas JSON through a native Windows dialog.
- Choose backup folder creates an additional dated JSON after each save, suitable for Google Drive. If that location is unavailable, the app warns while retaining the successful local save.
- Open automatic backups reveals snapshots; use Restore backup to select one. Restoring also snapshots the current collection.
- Artwork is downloaded gradually and cached locally. Cached covers work offline. Failed downloads are retried on display or next launch. JSON exports preserve image URLs, not image bytes; include the artwork folder in a full offline archive.
- For a complete manual archive, close GameAtlas and copy its entire application-data directory. Keep the live database outside cloud-synced folders.
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
