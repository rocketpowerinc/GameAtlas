# GameAtlas for Windows

![GameAtlas Atlas Library emblem](public/icon-512.png)

GameAtlas is an offline-first Windows collection app for games and related collection items, with compact and standard game cards, score colours, filters, wishlists, descriptions, and online game lookup.

## Install and first run
Each release provides two Windows downloads. Run `GameAtlas.Setup.VERSION.exe` for the normal installed edition, or place `GameAtlas.Portable.VERSION.exe` in a writable folder and run it without installing. Node.js is not required. Both executables are unsigned, so Windows may show an unknown-publisher notice.

The installed edition keeps its collection in `%APPDATA%/GameAtlas`, as before. The portable edition creates a `GameAtlas Data` folder beside its executable and keeps its database, artwork, settings, backups, and first-run state there. Keep the portable executable and that data folder together when moving it to another computer or drive. Replacing only the portable executable with a newer version preserves the adjacent data folder.

A fresh installation contains **zero games**. The first-run wizard lets you:
1. Start an empty library with the standard game fields, or import a complete .gameatlas backup or legacy JSON export.
2. Choose a local backup folder.
3. Choose backups after each library change, once a day, or manual only.

Existing installations retain their database and artwork. Upgrades do not clear a collection or replace it with the empty starter. Existing backup-folder preferences are retained; older installations default to backups after changes.

Use the cog beside Add game to reopen Settings. The footer shortcut and all property-definition editors have been removed. Game values remain editable. Imported libraries retain their existing fields; users cannot add, delete, rename, or change field definitions in the editor.

## Backup scheduling
- After changes: creates a complete local backup after a game or hardware item is added, modified, or deleted.
- Once a day: runs while the app is open, checked once per minute, using the local calendar date. If the app is closed, it catches up on the next launch.
- Manual only: creates no scheduled backups. Use Save complete backup.
- Settings remain changeable at any time. Automatic modes make an initial baseline when setup/settings are saved.
- The chosen folder may be a Google Drive folder. GameAtlas writes locally; your cloud-sync software handles uploading.
- Restore always creates a safety backup in the app's internal backups folder, including in manual mode.
- Backups contain all game and hardware collection records plus each unique thumbnail currently used by the collection. Replaced artwork and unused search previews are removed automatically and are not restored later.
- The newest 10 automatic and safety backups are kept in total across the selected folder and internal backups folder. Cleanup runs on launch and after backups; recognized backups from previous versions count toward the limit. Manual exports, unrelated files, and previously selected folders are left untouched.
- Backup failures are reported after saving a game or in Settings; the game remains saved locally.

## Collection dashboard
Use Dashboard at the top of the app for collection totals: All Games, Owned Physical, Owned Digital, Completed, Playing, Must Play, Replay, Wish List, and Upcoming. Upcoming includes every library entry with a valid full release date later than the current local date. Must Play and Replay come directly from Status, and each summary opens its matching games.

The dashboard includes completion progress, owned platform/genre breakdowns and the five highest-rated owned games. Click totals or chart rows to browse those games, or a ranked game to open its details. Dashboard figures ignore active library search filters and update when your library changes.

The dashboard also highlights highest-rated owned backlog games, the five most represented Studio credits with average scores, and wishlist priorities with released/upcoming/undated groups. Combined Studio credits stay as entered. Wishlist date groups use saved dates, not live release checks; multi-priority games appear in each selected priority.

## Hardware collection
Use **Hardware** at the top of the app to browse Consoles, Emulation Consoles, VR, Controllers, Mobile, Peripherals, Books, Headphones, and Misc in separate sections. Mobile follows Controllers for phone-focused controllers and accessories, while Headphones appears immediately before Misc. Cards show saved artwork, model information, and quantity when you own more than one. Opening a card shows a clean read-only page with a larger image, description, manufacturer, model or variant, quantity, release date, and notes. Choose **Edit** to update those details, upload replacement artwork, or remove the item. Use **Add hardware** to record another collection item.

Fresh installations start with an empty hardware collection. Complete backups and restores carry every hardware record, quantity, and cached artwork with the games.

## Missing thumbnails
Settings > Check for missing artwork opens a dedicated window and closes Settings. Find artwork automatically retries missing downloads and looks up games without artwork. Only a single exact title match is applied automatically. Ambiguous or unavailable results remain in Choose artwork for the rest, where you can search another title or game link, preview a downloaded match with automatic source fallback, choose an image file, or leave the game missing for now.

The scan shows progress and can stop after the current request. It changes only artwork, preserving all game properties and descriptions. A safety backup is created before a batch; successful artwork changes follow your backup schedule. Locally selected images are copied into the library and included in complete backups. Existing downloaded artwork is skipped.

## Complete backups and restore
Save complete backup creates one .gameatlas file containing a consistent SQLite snapshot and cached thumbnail bytes, preserving all game metadata, hardware details and quantities, descriptions, notes, fields, choices, scores, links, and artwork references.

Manual backup first attempts missing linked images. If some remain unavailable, the app reports them and lets you cancel or explicitly save with missing thumbnails. Scheduled backups include what is cached at that moment and record missing images.

Restore validates the database and image checksums, creates a safety copy, and restores the collection and images together. Interrupted restores have recovery support. Older JSON imports remain supported, but have no embedded images.

Machine-specific settings and nested backup histories are not included in a library backup. Choose the backup location/schedule on the new PC during setup.

## Storage
The installed edition's live database and image cache live in `%APPDATA%/GameAtlas`, separately from this repository and the installer. The portable edition uses its adjacent `GameAtlas Data` folder. Installer upgrades preserve installed data; uninstall does not deliberately remove it.

Internet is required only for lookup, uncached artwork, opening external links, and checking for application updates.

## Branding
The Atlas Library emblem uses the existing lime (#c7f464) and charcoal palette. public/brand-mark.svg is the scalable master used in the app. Run npm run build:branding to regenerate the Windows icon and PNG from that master. The icon includes sizes from 16 through 256 pixels for Windows, plus a 512-pixel PNG.

## Development
Use Node.js 22.13 or newer on Windows:
- npm ci
- npm run build
- npm run typecheck
- npm test
- npm run test:desktop
- npm start
- npm run dist (builds both the installer and portable executable)

Generated outputs are ignored by Git. `npm run dist` clears previous generated builds and PDF previews before packaging, then keeps only the current installer and portable executable in `release`. Use `npm run clean:generated` to remove `release`, `output`, `dist`, and `desktop-dist` manually without touching `node_modules`. Test fixtures contain generic sample games and are not packaged.

The renderer uses a sandbox, context isolation, and a limited validated preload interface. No local HTTP server is used.
The repository contains the Windows application. React, HTML, CSS, and Vite build its embedded Electron interface; they are required desktop components. There is no hosted application, deployment configuration, or web server in this source tree. The `BACKUPS` folder and `.gameatlas` files are ignored by Git and must remain outside this public repository. The app does not synchronize personal backups with GitHub.

## Application updates
Settings > Check for updates uses the public GitHub latest-release API. A newer stable Windows release is shown with its GitHub release notes. Choose Install update to download and verify the matching installer or portable executable against its GitHub SHA-256 digest and size, then update after a complete safety backup. Not now postpones it without downloading or installing. GameAtlas closes, updates the same edition, and relaunches it. No GitHub account or token is needed.

Updates preserve the library and settings. No background update checks run without pressing the button. Releases must contain matching `GameAtlas.Setup.VERSION.exe` and `GameAtlas.Portable.VERSION.exe` files with GitHub asset digests. Missing assets, rate limits, offline access, failed verification, and launch errors are shown in Settings.

Use the sun/moon button beside Settings to switch between light and dark themes. Your choice is remembered on this computer between launches.

ESRB ratings appear on game cards and in list view. Use the ESRB filter or sort from Everyone first / Mature first. Unknown, pending, and unrated entries remain at the end. Ratings can be edited in game details; verified imported ratings link to the ESRB listing and its platforms. Some original releases predate ESRB. A rating for one edition should not be assumed to cover every port.

Use **Settings > Create Collection PDF** to export either the games you own physically or your entire game library. Both printable catalogs keep the cover focused on console and physical-game totals. Each non-empty hardware category and the games catalog begin on separate pages, use independent numbering, and are grouped chronologically by release year. Emulation Consoles follow Consoles, then VR, Controllers, Mobile, and the remaining hardware sections, with Headphones immediately before Misc. Hardware entries include cached artwork, manufacturer, model, quantity, release date, description, and notes. Game entries retain their pertinent details, notes, clickable website links, and page numbers.

Open any existing game and choose **Upload file to replace artwork** to use your own PNG, JPG, WebP, GIF, or AVIF image. GameAtlas stores a safe local copy with the library, so it is included in complete backups and restores.

Game descriptions can be edited directly in the game editor. Online descriptions are shortened only at complete sentence boundaries, so a character limit cannot leave a broken sentence. Use **Settings > Find missing descriptions** to review games that show the missing-description message, search online for a suggested description, then review and save the text. The library defaults to a dense compact view with only cover art and title; its card accents retain the review-score colours. The Standard view keeps the detailed cards and release dates, and GameAtlas remembers the selected view.

Opening a game first shows a clean, read-only game page with larger artwork, its description, and pertinent information as compact badges. Empty properties stay hidden. A single source is not repeated; when a game has multiple distinct sources, compact labeled links such as IGN and Steam appear near the top. Personal notes appear in a full-width Notes box at the bottom. Use the compact **Edit** button beside the close button when you want to change information or artwork, and **Back to game page** to leave the editor without keeping unsaved property changes.

The source editor also accepts a YouTube video URL. Ordered shortcuts help find an official trailer first, then an IGN review, then a GameRanx **Before You Buy** video. The user reviews the search result and pastes the exact video URL, which prevents an unrelated video from being attached automatically.

The game editor includes URL fields for YouTube, IGN, Steam, Wikipedia, HowLongToBeat, and PriceCharting. Add the exact game page when one exists and it will appear with the other labeled links on the read-only game page. GameAtlas stores only these links; it does not scrape completion-time or pricing data from them.

The retired Link, Target Price, and release-date range-end fields are removed from existing libraries during upgrade. A valid legacy Link is first copied into Sources when needed. Wishlist Priority offers Must have and Someday; the retired Want Soon choice is removed. The card shortcut uses the first available saved source in this order: IGN, YouTube, Wikipedia, then HowLongToBeat.

Each game keeps at most one URL for a given source label. When an older source and the previously vetted Link use the same label, the vetted Link wins, preventing duplicate links such as two Wikipedia buttons on the game page.

Available source links display as YouTube, IGN, Steam, Wikipedia, HowLongToBeat, and PriceCharting. The editor presents the same order with one full-width URL field per row. Library upgrades decode stored HTML character entities in descriptions and recognize existing PriceCharting links by their domain.
