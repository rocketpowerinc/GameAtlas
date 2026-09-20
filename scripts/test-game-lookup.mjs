import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const transpile = async (path) =>
  ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const uri = (code) =>
  'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const sharedUri = uri(await transpile('../lib/game-lookup.ts'));
const {
  normalizeTitle,
  exactDate,
  parseWikipedia,
  mapOptions,
  completeDescription,
} = await import(sharedUri);
const serverUri = uri(
  (await transpile('../lib/game-lookup-server.ts')).replace(
    "'./game-lookup'",
    JSON.stringify(sharedUri),
  ),
);
const { searchGames, gameDetails, inputQuery } = await import(serverUri);

assert.equal(normalizeTitle('Hades (video game)'), normalizeTitle('HADES™'));
assert.notEqual(normalizeTitle('Hades II'), normalizeTitle('Hades'));
assert.notEqual(
  normalizeTitle('Doom (1993 video game)'),
  normalizeTitle('Doom (2016 video game)'),
);
for (const date of ['2027', 'Q4 2027', 'Coming soon', 'To be announced'])
  assert.equal(exactDate(date), undefined);
assert.equal(exactDate('Sep 17, 2020'), '2020-09-17');
assert.deepEqual(
  mapOptions(['PlayStation 5', 'Nintendo Switch', 'Windows'], 'Platform', [
    'Playstation 5',
    'Switch',
    'Steam',
  ]),
  ['Playstation 5', 'Switch', 'PC'],
);
assert.throws(
  () => inputQuery('https://localhost/private'),
  /Paste a game title/,
);
assert.equal(
  inputQuery('https://store.steampowered.com/app/1145360/Hades/').steamId,
  1145360,
);
assert.equal(
  completeDescription(
    'The first sentence is complete. The second sentence is also complete. This trailing sentence is cut',
    82,
  ),
  'The first sentence is complete. The second sentence is also complete.',
);
assert.equal(completeDescription('Only an unfinished fragment'), '');
assert.equal(
  completeDescription('A cited sentence.[1][2] A trailing fragment'),
  'A cited sentence.[1][2]',
);

const fixture = (score = '9/10') =>
  `<table class="infobox ib-video-game"><tr><th>Developer</th><td>A Studio</td></tr><tr><th>Release</th><td>Q4 2027</td></tr></table><table><tr><td><a>IGN</a></td><td>${score}<sup><a href="#cite_note-ign-1">1</a></sup></td></tr></table><li id="cite_note-ign-1"><a href="https://www.ign.com/articles/a-game-review">Review</a></li>`;
const detail = parseWikipedia(
  fixture(),
  'A Game',
  'https://en.wikipedia.org/wiki/A_Game',
);
assert.equal(detail.values.Score, 9);
assert.equal(detail.values.Link, undefined);
assert.equal(
  detail.sources.find((source) => source.name === 'IGN')?.url,
  'https://www.ign.com/articles/a-game-review',
);
assert.equal(detail.values.Studio, 'A Studio');
assert.equal(detail.values['Release Date'], undefined);
assert.equal(
  parseWikipedia(
    fixture('PC: 9/10; PS5: 8/10'),
    'A Game',
    'https://en.wikipedia.org/wiki/A_Game',
  ).values.Score,
  undefined,
);
assert.throws(
  () => parseWikipedia('<p>A game series</p>', 'Series', ''),
  /not an individual/,
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  if (String(url).includes('storesearch'))
    return Response.json({
      items: [{ name: 'Future Game', id: 123, type: 'app' }],
    });
  if (String(url).includes('appdetails'))
    return Response.json({
      123: {
        success: true,
        data: {
          name: 'Future Game',
          type: 'game',
          developers: ['Future Studio'],
          genres: [{ description: 'Action' }],
          release_date: { coming_soon: true, date: '2027' },
          metacritic: { score: 90 },
        },
      },
    });
  return Response.json({ query: { search: [] } });
};
try {
  const found = await searchGames('Future Game');
  assert.equal(found.exact, true);
  const upcoming = await gameDetails(found.candidates[0]);
  assert.equal(upcoming.values.Link, undefined);
  assert.equal(upcoming.sources[0].url, 'https://store.steampowered.com/app/123/');
  assert.equal(upcoming.values.Score, undefined);
  assert.equal(upcoming.values['Release Date'], undefined);
  assert.match(upcoming.releaseNote, /Upcoming/);
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  'PASS: title disambiguation, complete description boundaries, partial release dates, IGN citation/score pairing, Steam fallback, score scale protection, and URL restrictions.',
);

if (process.argv.includes('--live')) {
  for (const query of [
    'Hades',
    'Grand Theft Auto VI',
    'https://store.steampowered.com/app/1145360/',
  ]) {
    const found = await searchGames(query);
    assert.ok(found.candidates.length, `No matches for ${query}`);
    const result = await gameDetails(found.candidates[0]);
    assert.ok(result.values.Title && result.sources.length);
    console.log(
      JSON.stringify({
        query,
        exact: found.exact,
        values: result.values,
        sources: result.sources,
        release: result.releaseNote,
      }),
    );
    if (query === 'Hades') {
      assert.ok(result.coverUrl?.startsWith('https://'));
      assert.match(result.description, /Hades/);
      assert.ok(result.description.length <= 500);
      assert.equal(result.values.Score, 9);
      assert.ok(result.sources.some((source) => /ign\.com/.test(source.url)));
    }
  }
}
