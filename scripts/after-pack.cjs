const fs = require("node:fs");
const path = require("node:path");

const ENGLISH_LOCALES = new Set(["en-GB.pak", "en-US.pak"]);

/**
 * GameAtlas currently ships an English-only interface. Electron includes more
 * than 50 Chromium language packs by default, so remove the unused packs after
 * the Windows application has been assembled.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") {
    return;
  }

  const localesDirectory = path.join(context.appOutDir, "locales");
  if (!fs.existsSync(localesDirectory)) {
    return;
  }

  for (const entry of fs.readdirSync(localesDirectory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".pak") && !ENGLISH_LOCALES.has(entry.name)) {
      fs.rmSync(path.join(localesDirectory, entry.name));
    }
  }
};
