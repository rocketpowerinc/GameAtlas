export type LookupCandidate = {
  name: string;
  description: string;
  wikiId?: number;
  steamId?: number;
};
export type LookupDetails = {
  values: Record<string, string | number | string[]>;
  sources: { name: string; url: string }[];
  scoreSource?: string;
  releaseNote?: string;
  coverUrl?: string;
  coverUrls?: string[];
  description?: string;
};

export const normalizeTitle = (s: string) =>
  s
    .replace(/[™®]/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f™®]/g, '')
    .toLowerCase()
    .replace(/\s*\(video game\)$/, '')
    .replace(/[^a-z0-9]/g, '');

export function decodeHtml(s: string): string {
  return s
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => {
      const n =
        code[0].toLowerCase() === 'x'
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp|ndash|mdash);/g,
      (_, e) =>
        (
          ({
            amp: '&',
            quot: '"',
            apos: "'",
            lt: '<',
            gt: '>',
            nbsp: ' ',
            ndash: '–',
            mdash: '—',
          }) as Record<string, string>
        )[e] ?? '',
    );
}
export const plain = (s: string) =>
  decodeHtml(
    s
      .replace(/<(style|script|sup)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?\s*>|<\/li>/gi, '; ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .replace(/;\s*$/, '')
    .trim();

/**
 * Keep only complete sentences within the requested description length.
 * Scraped prose must never be saved with a character-limit fragment on the end.
 */
export function completeDescription(s: string, maxLength = 500): string {
  const text = s.trim();
  if (!text) return '';
  const clipped = text.slice(0, maxLength);
  const endings = Array.from(
    clipped.matchAll(
      /[.!?](?:["\u201d\u2019')\]]|\[\d+(?:,\s*\d+)*\])*(?=\s|$)/g,
    ),
  );
  const last = endings.at(-1);
  return last ? clipped.slice(0, last.index + last[0].length).trim() : '';
}

export function exactDate(s: string): string | undefined {
  // Never turn a year, quarter, or TBA into an invented calendar date.
  const match = s.match(
    /\b\d{4}-\d{2}-\d{2}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b|\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b/i,
  );
  if (!match) return;
  const d = new Date(match[0]);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}

export function parseWikipedia(
  html: string,
  pageTitle: string,
  wikiUrl: string,
): LookupDetails {
  if (!/class="[^"]*ib-video-game/.test(html))
    throw new Error(
      'This match is not an individual video game. Try another match.',
    );
  const info =
    html.match(
      /<table\b[^>]*class="[^"]*ib-video-game[^>]*>[\s\S]*?<\/table>/,
    )?.[0] ?? '';
  const rows = Array.from(info.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g));
  const cell = (label: RegExp) => {
    for (const row of rows) {
      const heading = row[1].match(/<th\b[^>]*>([\s\S]*?)<\/th>/)?.[1];
      if (heading && label.test(plain(heading)))
        return row[1].match(/<td\b[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? '';
    }
    return '';
  };
  const list = (s: string) =>
    plain(s)
      .split(/;\s*|,\s*/)
      .filter(Boolean);
  const values: LookupDetails['values'] = {
    Title: pageTitle.replace(/\s*\((?:\d{4} )?video game\)$/, ''),
  };
  const studio = plain(cell(/^Developers?$/i));
  if (studio) values.Studio = studio;
  const platforms = list(cell(/^Platforms?$/i));
  if (platforms.length) values.Platform = platforms;
  const genres = list(cell(/^Genres?$/i));
  if (genres.length) values.Genre = genres;
  const releaseNote = plain(cell(/^Release$/i));
  const date = exactDate(releaseNote);
  if (date) values['Release Date'] = date;
  let ignUrl = '';
  let scoreSource: string | undefined;
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g));
    if (plain(cells[0]?.[1] ?? '') !== 'IGN') continue;
    const scoreText = plain(
      cells
        .slice(1)
        .map((x) => x[1])
        .join(' '),
    );
    const scores = Array.from(
      scoreText.matchAll(/\b(\d+(?:\.\d+)?)\s*\/\s*10\b/g),
    );
    // Multi-platform reviews with different scores need manual review.
    if (scores.length && new Set(scores.map((s) => s[1])).size === 1) {
      const n = Number(scores[0][1]);
      if (n >= 0 && n <= 10) {
        values.Score = n;
        scoreSource = 'IGN (as cited by Wikipedia)';
      }
    }
    for (const ref of row[1].matchAll(/href="#([^"]+)"/g)) {
      const id = decodeHtml(ref[1]);
      for (const citation of html.matchAll(
        /<li\b[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g,
      )) {
        if (decodeHtml(citation[1]) !== id) continue;
        ignUrl = findIgnLink(citation[2]) || ignUrl;
      }
    }
    break;
  }
  // Only a game/review link actually present in the article is used.
  ignUrl ||= findIgnLink(
    html,
    true,
    pageTitle.replace(/\s*\((?:\d{4} )?video game\)$/, ''),
  );
  const cover = info.match(/<img\b[^>]*src="([^"]+)"/)?.[1];
  return {
    values,
    sources: [
      { name: 'Wikipedia', url: wikiUrl },
      ...(ignUrl ? [{ name: 'IGN', url: ignUrl }] : []),
    ],
    scoreSource,
    description: completeDescription(
      Array.from(
        html
          .slice(html.indexOf(info) + info.length)
          .matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g),
      )
        .map((m) => plain(m[1]))
        .find((s) => s.length > 50) ?? '',
    ) || undefined,
    releaseNote: releaseNote || undefined,
    coverUrl: cover
      ? decodeHtml(cover).replace(/^\/\//, 'https://')
      : undefined,
  };
}

function findIgnLink(html: string, reviewsOnly = false, gameTitle = '') {
  for (const m of html.matchAll(/href="(https?:\/\/[^" ]+)"/g)) {
    try {
      const u = new URL(decodeHtml(m[1]));
      if (
        gameTitle &&
        !normalizeTitle(decodeURIComponent(u.pathname)).includes(
          normalizeTitle(gameTitle),
        )
      )
        continue;
      if (
        (u.hostname === 'ign.com' || u.hostname === 'www.ign.com') &&
        (/^\/games\//.test(u.pathname) ||
          (/^\/articles\//.test(u.pathname) &&
            (!reviewsOnly || /review/i.test(u.pathname))))
      )
        return u.href;
    } catch {}
  }
  return '';
}

export function mapOptions(
  values: string[],
  field: 'Platform' | 'Genre',
  options: string[],
): string[] {
  const aliases: Record<string, string> =
    field === 'Platform'
      ? {
          'Nintendo Entertainment System': 'NES',
          'Super Nintendo Entertainment System': 'SNES',
          'Nintendo 64': 'N64',
          GameCube: 'Gamecube',
          'Wii U': 'Wiiu',
          'Nintendo Switch': 'Switch',
          'Nintendo Switch 2': 'Switch 2',
          'Game Boy': 'Gameboy/GameBoy Color',
          'Game Boy Color': 'Gameboy/GameBoy Color',
          'Game Boy Advance': 'Gameboy Advance',
          'Nintendo 3DS': 'Nintendo 3ds',
          PlayStation: 'Playstation 1',
          'PlayStation Portable': 'PSP',
          'PlayStation Vita': 'PS Vita',
          Xbox: 'Xbox (OG)',
          'Xbox Series X/S': 'Xbox Series X',
          Windows: 'PC',
          'Microsoft Windows': 'PC',
        }
      : {
          'Action role-playing': 'RPG',
          'Role-playing': 'RPG',
          Platformer: 'Platform',
          Simulation: 'Simulator',
          'Hack and slash': 'Hack-and-Slash',
          'Action-adventure': 'Action-Adventure',
        };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return [
    ...new Set(
      values.map((v) => {
        const alias =
          Object.entries(aliases).find(([k]) => norm(k) === norm(v))?.[1] ?? v;
        return options.find((o) => norm(o) === norm(alias)) ?? alias;
      }),
    ),
  ];
}
