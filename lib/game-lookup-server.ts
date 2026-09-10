import {
  normalizeTitle,
  plain,
  exactDate,
  parseWikipedia,
  type LookupCandidate,
  type LookupDetails,
} from './game-lookup';

const api = 'https://en.wikipedia.org/w/api.php?';
async function getJson(url: string): Promise<any> {
  // URLs are assembled here from validated IDs/search terms, never fetched from scraped links.
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'GameAtlas/1.0 (personal game collection lookup)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
    redirect: 'manual',
  });
  if (!r.ok)
    throw new Error('A source is temporarily unavailable. Try again shortly.');
  const reader = r.body?.getReader();
  if (!reader) throw new Error('The source returned an empty response.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 2500000) {
      await reader.cancel();
      throw new Error('The source response was too large.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(all));
}

export function inputQuery(input: string): { query: string; steamId?: number } {
  if (!/^https?:\/\//i.test(input)) return { query: input.trim() };
  const u = new URL(input);
  if (u.hostname === 'store.steampowered.com') {
    const id = u.pathname.match(/^\/app\/(\d+)/)?.[1];
    if (id) return { query: '', steamId: Number(id) };
  }
  if (['en.wikipedia.org', 'www.ign.com', 'ign.com'].includes(u.hostname)) {
    return {
      query: decodeURIComponent(
        u.pathname.split('/').filter(Boolean).pop() ?? '',
      )
        .replace(/[_-]/g, ' ')
        .replace(/\s+review.*$/i, '')
        .trim(),
    };
  }
  throw new Error(
    'Paste a game title, IGN link, Steam Store link, or English Wikipedia link.',
  );
}

export async function searchGames(input: string) {
  const parsed = inputQuery(input);
  if (parsed.steamId) {
    const steam = await steamDetails(parsed.steamId);
    return {
      candidates: [
        {
          name: steam.values.Title as string,
          description: 'Steam Store',
          steamId: parsed.steamId,
        },
      ],
      exact: true,
      warnings: [],
    };
  }
  const q = parsed.query;
  const results = await Promise.allSettled([
    getJson(
      api +
        new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: `${q} video game`,
          srlimit: '6',
          format: 'json',
          utf8: '1',
        }),
    ),
    getJson(
      'https://store.steampowered.com/api/storesearch/?' +
        new URLSearchParams({ term: q, l: 'english', cc: 'US' }),
    ),
  ]);
  results.forEach((r, i) => {
    if (r.status === 'rejected')
      console.warn(
        'Game lookup source unavailable',
        i === 0 ? 'Wikipedia' : 'Steam',
        r.reason instanceof Error ? r.reason.message : String(r.reason),
      );
  });
  const candidates: LookupCandidate[] = [];
  const wiki =
    results[0].status === 'fulfilled'
      ? (results[0].value.query?.search ?? [])
      : [];
  for (const w of wiki) {
    const description = plain(w.snippet ?? '');
    if (
      !/\bgame\b/i.test(description) ||
      /^(List of|Category:)|\(disambiguation\)$/.test(w.title) ||
      /fictional character|is a character|is a fictional|game series/i.test(
        description,
      )
    )
      continue;
    candidates.push({
      name: w.title,
      description: description.slice(0, 180),
      wikiId: w.pageid,
    });
  }
  const steam =
    results[1].status === 'fulfilled' ? (results[1].value.items ?? []) : [];
  for (const s of steam) {
    if (s.type !== 'app' || /soundtrack|\bDLC\b/i.test(s.name)) continue;
    const existing = candidates.find(
      (c) => normalizeTitle(c.name) === normalizeTitle(s.name),
    );
    if (existing) existing.steamId = s.id;
    else
      candidates.push({
        name: s.name,
        description: 'Steam Store · PC',
        steamId: s.id,
      });
  }
  candidates.sort(
    (a, b) =>
      Number(normalizeTitle(b.name) === normalizeTitle(q)) -
      Number(normalizeTitle(a.name) === normalizeTitle(q)),
  );
  const exact =
    candidates.filter((c) => normalizeTitle(c.name) === normalizeTitle(q))
      .length === 1 &&
    !candidates.some(
      (c) =>
        /\(\d{4} video game\)$/.test(c.name) &&
        normalizeTitle(c.name.replace(/\s*\(\d{4} video game\)$/, '')) ===
          normalizeTitle(q),
    );
  const warnings = results.flatMap((r, i) =>
    r.status === 'rejected'
      ? [`${i === 0 ? 'Wikipedia' : 'Steam'} is temporarily unavailable.`]
      : [],
  );
  if (!candidates.length && warnings.length === 2)
    throw new Error(
      'The game sources are unavailable right now. Please retry, or fill in the game manually.',
    );
  return { candidates: candidates.slice(0, 8), exact, warnings };
}

async function steamDetails(id: number): Promise<LookupDetails> {
  const j = await getJson(
    `https://store.steampowered.com/api/appdetails?appids=${id}&l=english&cc=US`,
  );
  const d = j[id]?.success && j[id].data;
  if (!d || d.type !== 'game')
    throw new Error(
      'This Steam entry is not a game. Choose a different match.',
    );
  const url = `https://store.steampowered.com/app/${id}/`;
  const values: LookupDetails['values'] = {
    Title: d.name,
    Link: url,
    Platform: ['Steam'],
  };
  if (d.developers?.length) values.Studio = d.developers.join(', ');
  if (d.genres?.length) values.Genre = d.genres.map((g: any) => g.description);
  const date = exactDate(d.release_date?.date ?? '');
  if (date) values['Release Date'] = date;
  // Steam percentages and Metacritic aggregates are not IGN's 0–10 review score.
  return {
    values,
    sources: [{ name: 'Steam', url }],
    releaseNote:
      (d.release_date?.coming_soon ? 'Upcoming · ' : 'Steam release · ') +
      (d.release_date?.date || 'Date to be announced'),
    coverUrl: d.header_image,
    description: plain(d.short_description ?? '').slice(0, 500) || undefined,
  };
}

export async function gameDetails(
  candidate: LookupCandidate,
): Promise<LookupDetails> {
  let selected = candidate;
  // A pasted Steam URL can still discover the preferred IGN review via Wikipedia citations.
  if (!selected.wikiId && selected.steamId) {
    try {
      const matches = await searchGames(selected.name);
      const exact = matches.candidates.filter(
        (c) =>
          c.wikiId && normalizeTitle(c.name) === normalizeTitle(selected.name),
      );
      if (exact.length === 1)
        selected = { ...selected, wikiId: exact[0].wikiId };
    } catch {}
  }
  const tasks: Promise<LookupDetails>[] = [];
  if (selected.wikiId)
    tasks.push(
      (async () => {
        const j = await getJson(
          api +
            new URLSearchParams({
              action: 'parse',
              pageid: String(selected.wikiId),
              prop: 'text',
              format: 'json',
              redirects: '1',
            }),
        );
        if (!j.parse?.text?.['*'])
          throw new Error('Wikipedia could not load this game.');
        return parseWikipedia(
          j.parse.text['*'],
          j.parse.title,
          `https://en.wikipedia.org/?curid=${selected.wikiId}`,
        );
      })(),
    );
  if (selected.steamId) tasks.push(steamDetails(selected.steamId));
  const results = await Promise.allSettled(tasks);
  const details = results.flatMap((r) =>
    r.status === 'fulfilled' ? [r.value] : [],
  );
  if (!details.length)
    throw new Error(
      'Could not retrieve this game’s details. Try another match or enter them manually.',
    );
  const wiki = details.find((d) =>
    d.sources.some((s) => s.name === 'Wikipedia'),
  );
  const steam = details.find((d) => d.sources.some((s) => s.name === 'Steam'));
  const values = { ...steam?.values, ...wiki?.values };
  const sources = details.flatMap((d) => d.sources);
  values.Link =
    sources.find((s) => s.name === 'IGN')?.url ??
    sources.find((s) => s.name === 'Steam')?.url ??
    sources[0].url;
  if (steam && wiki && Array.isArray(values.Platform))
    values.Platform = [
      ...new Set([
        ...values.Platform.filter(
          (p) => p !== 'Windows' && p !== 'Microsoft Windows',
        ),
        'Steam',
      ]),
    ];
  return {
    values,
    sources,
    scoreSource: wiki?.scoreSource,
    releaseNote: wiki?.releaseNote || steam?.releaseNote,
    coverUrl: wiki?.coverUrl || steam?.coverUrl,
    description: wiki?.description || steam?.description,
  };
}
