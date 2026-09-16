import {esrbOptions,compareEsrb} from '@/lib/esrb';
import {saveTheme, type Theme} from '@/lib/theme';
import {CollectionDashboard} from '@/components/collection-dashboard';
import {ArtworkSettings} from '@/components/artwork-settings';
import {DescriptionSettings} from '@/components/description-settings';
import {BrandMark,BrandName} from '@/components/brand';
import {DesktopSettings} from '@/components/desktop-settings';
'use client';
import {desktopRequest, artworkUrl} from '@/lib/desktop';
import { useEffect, useMemo, useState, useRef } from 'react';
import {
  mapOptions,
  normalizeTitle,
  type LookupCandidate,
  type LookupDetails,
} from '@/lib/game-lookup';
import {
  Sun,
  Moon,
  Gamepad2,
  Plus,
  Search,
  Settings,
  Download,
  ImageUp,
  RefreshCw,
  Trash2,
  Heart,
  Disc3,
  Monitor,
  ArrowUpRight,
  Check,
  Pencil,
  ArrowLeft,
  Library as LibraryIcon,
  Video,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  display,
  validate,
  type Library,
  type Field,
  type Game,
} from '@/lib/library';
const title = (g: Game, fields: Field[]) =>
  display(
    g.values.Title || g.values[fields.find((f) => f.type === 'text')?.id ?? ''],
  ) || 'Untitled game';
const contains = (g: Game, key: string, value: string) =>
  Array.isArray(g.values[key])
    ? (g.values[key] as string[]).includes(value)
    : g.values[key] === value;
const safeLink = (value: unknown) => {
  try {
    const url = new URL(display(value));
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? url.href
      : '';
  } catch {
    return '';
  }
};
const youtubeSearch = (
  gameTitle: string,
  kind: 'trailer' | 'ign' | 'gameranx',
) => {
  const suffix =
    kind === 'trailer'
      ? 'official trailer'
      : kind === 'ign'
        ? 'IGN review'
        : 'Before You Buy GameRanx';
  return `https://www.youtube.com/results?${new URLSearchParams({ search_query: `"${gameTitle}" ${suffix}` })}`;
};
function GameThumbnail({ url, variant }: { url?: string; variant: 'card' | 'list' }) {
  const [failed, setFailed] = useState(false);
  useEffect(()=>setFailed(false),[url]);
  useEffect(()=>{const retry=()=>setFailed(false);window.addEventListener('artwork-updated',retry);return()=>window.removeEventListener('artwork-updated',retry);},[]);
  const src = artworkUrl(safeLink(url));
  if (!src || failed) return variant === 'card' ? <Gamepad2 size={42} strokeWidth={1.3} /> : null;
  return <img className={`game-thumbnail game-thumbnail-${variant}`} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
const scoreTone = (value: unknown) => {
  if (value === '' || value === undefined || value === null)
    return 'score-unrated';
  const score = Number(value);
  if (!Number.isFinite(score)) return 'score-unrated';
  if (score >= 9) return 'score-exceptional';
  if (score >= 8) return 'score-great';
  if (score >= 7) return 'score-good';
  if (score >= 6) return 'score-mixed';
  return 'score-poor';
};
function Pick({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (s: string) => void;
  options: string[];
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => v !== null && onChange(v)}>
      <SelectTrigger aria-label={label} className="picker">
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export default function Home() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  function toggleTheme() { const next = theme === 'dark' ? 'light' : 'dark'; saveTheme(next); setTheme(next); }
  const [data, setData] = useState<Library | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [view, setView] = useState('All games'),
    [query, setQuery] = useState(''),
    [platform, setPlatform] = useState('All platforms'),
    [genre, setGenre] = useState('All genres'),
    [status, setStatus] = useState('All statuses'),
    [esrb, setEsrb] = useState('All ESRB ratings'),
    [sort, setSort] = useState('Title A–Z'),
    [limit, setLimit] = useState(48),
    [draft, setDraft] = useState<Game | null>(null),
    [editingGame,setEditingGame] = useState(false),
    [settings, setSettings] = useState(false),
    [dashboard,setDashboard] = useState(false),
    [dashboardFilter,setDashboardFilter] = useState<{label:string;ids:string[]}|null>(null),
    [artworkOpen,setArtworkOpen] = useState(false),
    [descriptionsOpen,setDescriptionsOpen] = useState(false),
    [confirm, setConfirm] = useState<{
      title: string;
      body: string;
      run: () => Promise<void>;
    } | null>(null);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupMatches, setLookupMatches] = useState<LookupCandidate[]>([]);
  const [lookupStatus, setLookupStatus] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupRetry, setLookupRetry] = useState(0);
  const lookupAbort = useRef<AbortController | null>(null);
  const importedValues = useRef<LookupDetails['values']>({});
  const lookupPreviousQuery = useRef('');
  const [artworkGameId, setArtworkGameId] = useState<string | null>(null);
  const isNewGame = !!draft && !data?.games.some((g) => g.id === draft.id);
  const artworkLookup = !!draft && !isNewGame && artworkGameId === draft.id;
  async function lookupRequest(body: unknown, signal: AbortSignal) {
    const r = await desktopRequest('/api/game-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const result: any = await r.json();
    if (!r.ok) throw new Error(result.error || 'Could not look up this game.');
    return result;
  }
  async function fillGame(
    candidate: LookupCandidate,
    controller: AbortController,
    draftId: string,
  ) {
    setLookupBusy(true);
    setLookupStatus(`Finding details for ${candidate.name}…`);
    try {
      const result: LookupDetails = await lookupRequest(
        { action: 'details', candidate },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (!isNewGame) {
        if (!result.coverUrl && !result.description) {
          setLookupStatus(
            'No artwork or description found for this match. Try another match or link.',
          );
          return;
        }
        setDraft((current) => {
          if (!current || current.id !== draftId) return current;
          const sources = [
            ...(current.lookup?.sources ?? []),
            ...result.sources,
          ];
          return {
            ...current,
            lookup: {
              ...current.lookup,
              sources: sources.filter(
                (s, i) => sources.findIndex((x) => x.url === s.url) === i,
              ),
              coverUrl: result.coverUrl || current.lookup?.coverUrl,
              description: result.description || current.lookup?.description,
            },
          };
        });
        setLookupStatus(
          `${result.coverUrl ? 'Artwork' : 'No artwork found; description'}${result.coverUrl && result.description ? ' and description' : ''} ready. Click Save game to keep it.`,
        );
        return;
      }
      const converted: LookupDetails['values'] = {};
      for (const [id, value] of Object.entries(result.values)) {
        const field = data?.fields.find((f) => f.id === id);
        if (!field) continue;
        if (
          (id === 'Platform' || id === 'Genre') &&
          Array.isArray(value) &&
          field.type === 'multi_select'
        )
          converted[id] = mapOptions(value, id, field.options);
        else if (
          (field.type === 'number' && typeof value === 'number') ||
          ((field.type === 'text' ||
            field.type === 'url' ||
            field.type === 'date') &&
            typeof value === 'string')
        )
          converted[id] = value;
      }
      const previous = importedValues.current;
      setDraft((current) => {
        if (!current || current.id !== draftId) return current;
        const values = { ...current.values };
        // Remove old imported suggestions, but preserve everything the user has edited.
        for (const [id, old] of Object.entries(previous)) {
          if (JSON.stringify(values[id]) === JSON.stringify(old))
            values[id] = Array.isArray(old) ? [] : '';
        }
        for (const [id, value] of Object.entries(converted)) {
          const existing = values[id];
          if (
            existing === '' ||
            (id === 'ESRB' && existing === 'Unknown') ||
            existing === undefined ||
            (Array.isArray(existing) && !existing.length) ||
            (id === 'Title' &&
              normalizeTitle(display(existing)) === normalizeTitle(lookupQuery))
          )
            values[id] = value;
        }
        return {
          ...current,
          values,
          lookup: {
            sources: result.sources,
            scoreSource: result.scoreSource,
            releaseNote: result.releaseNote,
            coverUrl: result.coverUrl,
            description: result.description,
          },
        };
      });
      importedValues.current = converted;
      setLookupStatus(
        `Details found for ${candidate.name}. Review the fields below.${result.values.Score === undefined ? ' No confirmed IGN score found; score left blank.' : ''}`,
      );
    } catch (e) {
      if (!controller.signal.aborted)
        setLookupStatus(
          e instanceof Error
            ? e.message
            : 'Lookup failed. Retry or enter the details below.',
        );
    } finally {
      if (!controller.signal.aborted) setLookupBusy(false);
    }
  }
  useEffect(() => {
    lookupAbort.current?.abort();
    if (!draft) setArtworkGameId(null);
    const controller = new AbortController();
    lookupAbort.current = controller;
    setLookupMatches([]);
    setLookupBusy(false);
    setLookupStatus('');
    if (isNewGame && lookupPreviousQuery.current !== lookupQuery) {
      const previous = importedValues.current;
      const previousQuery = lookupPreviousQuery.current;
      setDraft((current) => {
        if (!current) return current;
        const values = { ...current.values };
        for (const [id, old] of Object.entries(previous)) {
          if (JSON.stringify(values[id]) === JSON.stringify(old))
            values[id] = Array.isArray(old) ? [] : '';
        }
        if (
          data?.fields.some((f) => f.id === 'Title') &&
          !/^https?:\/\//i.test(lookupQuery) &&
          (!values.Title || display(values.Title) === previousQuery)
        )
          values.Title = lookupQuery.trim();
        return { ...current, values, lookup: undefined };
      });
      importedValues.current = {};
    }
    lookupPreviousQuery.current = lookupQuery;
    if (
      (!isNewGame && !artworkLookup) ||
      !draft ||
      lookupQuery.trim().length < 2
    )
      return () => controller.abort();
    const draftId = draft.id;
    setLookupBusy(true);
    setLookupStatus('Searching for your game…');
    const timer = setTimeout(async () => {
      try {
        const result = await lookupRequest(
          { action: 'search', query: lookupQuery.trim() },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setLookupMatches(result.candidates);
        if (result.exact && result.candidates[0])
          await fillGame(result.candidates[0], controller, draftId);
        else {
          setLookupStatus(
            result.candidates.length
              ? 'Choose the correct game below.'
              : 'No matching game found. Try its full title or a Steam link, or enter the details below.',
          );
          setLookupBusy(false);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setLookupStatus(
            e instanceof Error ? e.message : 'Lookup failed. Please retry.',
          );
          setLookupBusy(false);
        }
      }
    }, 1100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [lookupQuery, lookupRetry, draft?.id, isNewGame, artworkLookup]);
  async function reload() {
    try {
      const r = await desktopRequest('/api/library', { cache: 'no-store' });
      const d: any = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setError('');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not load your collection.',
      );
    }
  }
  async function replaceArtwork(game:Game){
    setBusy(true);setError('');
    try{
      const url=await window.gameAtlas.chooseArtworkFile(game.id);
      if(!url)return;
      setDraft(current=>current?.id===game.id?{...current,lookup:{...current.lookup,sources:current.lookup?.sources??[],coverUrl:url}}:current);
      await reload();
      window.dispatchEvent(new Event('artwork-updated'));
      setNotice('Artwork replaced and saved');
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  useEffect(() => {
    const handler = (event: Event) => setError((event as CustomEvent<string>).detail);
    window.addEventListener('backup-warning', handler);
    return () => window.removeEventListener('backup-warning', handler);
  }, []);
  useEffect(() => {
    void reload();

  }, []);
  useEffect(()=>{const refresh=()=>void reload();window.addEventListener('library-updated',refresh);return()=>window.removeEventListener('library-updated',refresh);},[]);
  useEffect(() => {
    setLimit(48);
  }, [query, platform, genre, status, esrb, view, sort]);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(id);
  }, [notice]);
  async function save(next: Library) {
    setBusy(true);
    setError('');
    try {
      validate(next);
      const r = await desktopRequest('/api/library', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const saved: any = await r.json();
      if (!r.ok) throw new Error(saved.error);
      setData(saved);
      setNotice('Saved to your library');
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save. Your changes are still here.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  function addGame() {
    if (!data) return;
    setEditingGame(true);
    setLookupQuery('');
    setLookupMatches([]);
    setLookupStatus('');
    importedValues.current = {};
    setDraft({
      id: crypto.randomUUID(),
      values: Object.fromEntries(
        data.fields.map((f) => [
          f.id,
          f.type === 'multi_select'
            ? f.id === 'Ownership'
              ? [view === 'Wishlist' ? 'Wish List' : 'Physical']
              : []
            : f.type === 'checkbox'
              ? false
              : '',
        ]),
      ),
    });
  }
  function openGame(game:Game){
    setError('');
    setEditingGame(false);
    setArtworkGameId(null);
    setDraft(structuredClone(game));
  }
  useEffect(() => {
    const ctx = (document as any).modelContext;
    if (!ctx?.registerTool) return;
    const life = new AbortController();
    try {
      Promise.resolve(
        ctx.registerTool(
          {
            name: 'search_game_library',
            description: 'Filter the visible game collection by search text.',
            inputSchema: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: true },
            execute: (input: unknown) => {
              if (!input || typeof (input as any).query !== 'string')
                throw new Error('query must be a string');
              const q = (input as any).query;
              setQuery(q);
              setView('All games');
              setPlatform('All platforms');
              setGenre('All genres');
              setStatus('All statuses');setEsrb('All ESRB ratings');
              return { query: q };
            },
          },
          { signal: life.signal },
        ),
      ).catch(() => {});
    } catch {}
    return () => life.abort();
  }, []);
  const fields = data?.fields ?? [],
    games = data?.games ?? [];
  const options = (id: string) =>
    Array.from(
      new Set([
        ...(fields.find((f) => f.id === id)?.options ?? []),
        ...games.flatMap((g) =>
          Array.isArray(g.values[id]) ? (g.values[id] as string[]) : [],
        ),
      ]),
    ).sort();
  const filtered = useMemo(
    () =>
      games
        .filter(
          (g) =>
            (!dashboardFilter||dashboardFilter.ids.includes(g.id)) &&
            (view === 'All games' ||
              (view === 'Physical' && contains(g, 'Ownership', 'Physical')) ||
              (view === 'Digital' && contains(g, 'Ownership', 'Digital')) ||
              (view === 'Wishlist' && contains(g, 'Ownership', 'Wish List')) ||
              (view === 'Playing' &&
                contains(g, 'Status', 'Currently Playing'))) &&
            (platform === 'All platforms' ||
              contains(g, 'Platform', platform)) &&
            (genre === 'All genres' || contains(g, 'Genre', genre)) &&
            (status === 'All statuses' || contains(g, 'Status', status)) &&
            (esrb === 'All ESRB ratings' || (g.values.ESRB || 'Unknown') === esrb) &&
            Object.values(g.values).some((v) =>
              display(v).toLowerCase().includes(query.toLowerCase()),
            ),
        )
        .sort((a, b) =>
          sort.startsWith('ESRB:') ? compareEsrb(a.values.ESRB,b.values.ESRB,sort==='ESRB: Mature first') || title(a,fields).localeCompare(title(b,fields)) : sort === 'Highest score'
            ? Number(b.values.Score || 0) - Number(a.values.Score || 0)
            : sort === 'Newest release'
              ? display(b.values['Release Date']).localeCompare(
                  display(a.values['Release Date']),
                )
              : title(a, fields).localeCompare(title(b, fields)) *
                (sort === 'Title Z–A' ? -1 : 1),
        ),
    [data, view, query, platform, genre, status, esrb, sort,dashboardFilter],
  );
  const gamePageDetailFields=draft?fields.filter(field=>
    !['Title','Studio','Release Date','Platform','Ownership','Genre','Status','Tags','Score','ESRB','Link','Notes','Wishlist Priority'].includes(field.id)&&
    display(draft.values[field.id]).trim()!==''
  ):[];
  const gamePageSources=draft?[...new Map((draft.lookup?.sources??[]).filter(source=>safeLink(source.url)).map(source=>[safeLink(source.url),source])).values()]:[];
  return (
    <main className="atlas">
      <header className="masthead">
        <div className="brand">
          <BrandMark size={42}/><BrandName/><span>PERSONAL LIBRARY</span>
        </div>
        <div className="header-actions">
          <button className="quiet theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={20}/> : <Moon size={20}/>}<span>{theme === 'dark' ? 'Light' : 'Dark'}</span></button>
          <button className="quiet" aria-pressed={dashboard} onClick={()=>setDashboard(!dashboard)}>{dashboard?'Back to library':'Dashboard'}</button>
          <button
            className="quiet icon-button"
            aria-label="Settings"
            onClick={() => setSettings(true)}
          >
            <Settings size={20} />
          </button>
          <button
            className="primary"
            onClick={addGame}
            disabled={!data || busy}
          >
            <Plus size={18} /> Add game
          </button>
        </div>
      </header>
      {dashboard&&data?<CollectionDashboard library={data} onAdd={addGame} onGame={openGame} onBrowse={(label,selected)=>{setDashboardFilter({label,ids:selected.map(g=>g.id)});setDashboard(false);setView('All games');setQuery('');setPlatform('All platforms');setGenre('All genres');setStatus('All statuses');setEsrb('All ESRB ratings');setLimit(48);}}/>:<section className="collection">
        <div className="collection-heading">
          <div>
            <p className="eyebrow">YOUR COLLECTION, ALL TOGETHER</p>
            <h1>
              {
                {
                  'All games': 'The Grand Collection.',
                  Physical: 'On the Shelf.',
                  Digital: 'Ready to Download.',
                  Wishlist: 'The Next Adventure.',
                  Playing: 'The Current Quest.',
                }[view]
              }
            </h1>
            <p className="muted">
              {view === 'Wishlist'
                ? 'Keep the games you want within reach.'
                : 'Physical favorites. Digital discoveries. Your next adventure.'}
            </p>
          </div>
          <div className="collection-total">
            <strong>{data ? games.length : '—'}</strong>
            <span>GAMES IN YOUR ATLAS</span>
          </div>
        </div>
        {error && (
          <div className="error" role="alert">
            {error}
            <button onClick={() => void reload()} className="quiet">
              Reload latest library
            </button>
          </div>
        )}
        <Tabs value={view} onValueChange={(v) => {setView(String(v));setDashboardFilter(null);}}>
          <TabsList variant="line" className="library-tabs">
            {[
              ['All games', LibraryIcon],
              ['Physical', Disc3],
              ['Digital', Monitor],
              ['Wishlist', Heart],
              ['Playing', Gamepad2],
            ].map(([label, Icon]: any) => (
              <TabsTrigger value={label} key={label}>
                <Icon size={17} />
                {label}
                <span>
                  {label === 'All games'
                    ? games.length
                    : games.filter((g) =>
                        contains(
                          g,
                          label === 'Playing' ? 'Status' : 'Ownership',
                          label === 'Playing'
                            ? 'Currently Playing'
                            : label === 'Wishlist'
                              ? 'Wish List'
                              : label,
                        ),
                      ).length}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {dashboardFilter&&<div className="dashboard-filter" role="status"><span>Dashboard selection: <strong>{dashboardFilter.label}</strong></span><button className="quiet" onClick={()=>setDashboardFilter(null)}>Show all games</button></div>}
        <div className="library-controls">
          <div className="toolbar library-search">
            <Search size={19} />
            <input
              placeholder="Find a game, studio, or genre…"
              aria-label="Search games"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button aria-label="Clear search" onClick={() => setQuery('')}>
                ×
              </button>
            )}
          </div>
          <div className="filter-row">
          <Pick
            value={platform}
            onChange={setPlatform}
            options={['All platforms', ...options('Platform')]}
            label="Filter platform"
          />
          <Pick
            value={genre}
            onChange={setGenre}
            options={['All genres', ...options('Genre')]}
            label="Filter genre"
          />
          <Pick
            value={status}
            onChange={setStatus}
            options={['All statuses', ...options('Status')]}
            label="Filter status"
          />
          <Pick value={esrb} onChange={setEsrb} options={['All ESRB ratings',...esrbOptions]} label="Filter by ESRB rating"/>
          <Pick
            value={sort}
            onChange={setSort}
            options={[
              'Title A–Z',
              'Title Z–A',
              'Highest score',
              'ESRB: Everyone first',
              'ESRB: Mature first',
              'Newest release',
            ]}
            label="Sort games"
          />
          </div>
        </div>
        <div className="result-bar">
          <p>
            {data ? `${filtered.length} games` : 'Loading your collection…'}
            {(query ||
              platform !== 'All platforms' ||
              genre !== 'All genres' ||
              status !== 'All statuses' || esrb !== 'All ESRB ratings') && (
              <button
                className="text-button"
                onClick={() => {
                  setQuery('');
                  setPlatform('All platforms');
                  setGenre('All genres');
                  setStatus('All statuses');setEsrb('All ESRB ratings');
                }}
              >
                Clear filters
              </button>
            )}
          </p>
        </div>
        {!data ? (
          <div className="game-grid">
            {[1, 2, 3, 4].map((n) => (
              <Skeleton key={n} className="h-72 rounded-xl" />
            ))}
          </div>
        ) : !filtered.length ? (
          <Empty className="empty-state">
            <BrandMark size={48}/>
            <EmptyTitle>No games here yet</EmptyTitle>
            <EmptyDescription>
              {query ||
              platform !== 'All platforms' ||
              genre !== 'All genres' ||
              status !== 'All statuses'
                ? 'Try a different search or clear your filters.'
                : 'Add a game to start this part of your collection.'}
            </EmptyDescription>
            <button className="primary" onClick={addGame}>
              <Plus size={18} /> Add game
            </button>
          </Empty>
        ) : (
          <div className="game-grid">
            {filtered.slice(0, limit).map((g) => (
              <article className="game-card" key={g.id}>
                <button
                  className="game-card-main"
                  onClick={() => openGame(g)}
                >
                  <div className={`game-art ${scoreTone(g.values.Score)}`}>
                    <div className="card-top">
                      <span>{display(g.values.Platform) || 'NO PLATFORM'}</span>
                      {g.values.Score !== '' &&
                        g.values.Score !== undefined && (
                          <b>{display(g.values.Score)}</b>
                        )}
                    </div>
                    <GameThumbnail key={g.lookup?.coverUrl} url={g.lookup?.coverUrl} variant="card" />
                    <span>{display(g.values.Genre) || 'GAME COLLECTION'}</span>
                  </div>
                  <div className="game-info">
                    <h2>{title(g, fields).replace(/^\*\*|\*\*$/g, '')}</h2>
                    <p>{display(g.values.Studio) || 'Studio not set'}</p>
                    {display(g.values['Release Date'])&&<p className="game-release-date">Released {display(g.values['Release Date'])}</p>}
                    {contains(g, 'Status', 'Currently Playing') && (
                      <span className="playing">
                        <span />
                        Currently playing
                      </span>
                    )}
                  </div>
                </button>
                <div className="card-bottom">
                  <span>{display(g.values.Ownership) || 'Uncategorized'}<small className="esrb-badge">ESRB: {display(g.values.ESRB)||'Unknown'}</small></span>
                  {safeLink(g.values.Link) ? (
                    <a
                      className="game-link"
                      href={safeLink(g.values.Link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open website for ${title(g, fields)}`}
                    >
                      Link <ArrowUpRight size={17} />
                    </a>
                  ) : (
                    <span className="no-link">No link</span>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {filtered.length > limit && (
          <div className="load-more">
            <button className="quiet" onClick={() => setLimit(limit + 48)}>
              Show more games · {filtered.length - limit} remaining
            </button>
          </div>
        )}
        <footer>
          <span>
            <BrandMark size={22}/><BrandName/> <span className="footer-dot">•</span> Your collection,
            your way.
          </span>

        </footer>
      </section>}
      <Dialog
        open={!!draft}
        onOpenChange={(o) => {if(!o&&!busy){setDraft(null);setEditingGame(false);}}}
      >
        <DialogContent className={draft&&!isNewGame&&!editingGame?'game-page':'editor'}>
          {draft&&!isNewGame&&!editingGame ? <>
            <button className="quiet game-page-edit-top" type="button" onClick={()=>setEditingGame(true)}><Pencil size={14}/> Edit</button>
            <div className="game-page-hero">
              <div className="game-page-art"><GameThumbnail key={draft.lookup?.coverUrl} url={draft.lookup?.coverUrl} variant="card"/></div>
              <div className="game-page-intro">
                {(display(draft.values.Studio)||display(draft.values['Release Date']))&&<p className="eyebrow">{[display(draft.values.Studio),display(draft.values['Release Date'])].filter(Boolean).join(' · ')}</p>}
                <DialogTitle>{title(draft,fields).replace(/^\*\*|\*\*$/g,'')}</DialogTitle>
                <DialogDescription>{draft.lookup?.description||'No description has been added for this game yet.'}</DialogDescription>
                <div className="game-page-highlights">
                  {display(draft.values.Platform)&&<span>{display(draft.values.Platform)}</span>}
                  {display(draft.values.Ownership)&&<span>{display(draft.values.Ownership)}</span>}
                  {display(draft.values.Genre)&&<span>{display(draft.values.Genre)}</span>}
                  {display(draft.values.Status)&&<span>{display(draft.values.Status)}</span>}
                  {Array.isArray(draft.values.Tags)&&(draft.values.Tags as string[]).map(tag=><span key={tag}>{tag}</span>)}
                  {display(draft.values['Wishlist Priority'])&&<span>Priority: {display(draft.values['Wishlist Priority'])}</span>}
                  {draft.values.Score!==''&&draft.values.Score!==undefined&&<span>Score {display(draft.values.Score)} / 10</span>}
                  <span>ESRB {display(draft.values.ESRB)||'Unknown'}</span>
                </div>
                {(gamePageSources.length>1||gamePageSources.some(source=>source.name.toLowerCase()==='youtube'))&&<div className="game-page-source-links"><small>Sources</small>{gamePageSources.map(source=><a key={source.url} href={safeLink(source.url)} target="_blank" rel="noopener noreferrer">{source.name} <ArrowUpRight size={13}/></a>)}</div>}
              </div>
            </div>
            {!!gamePageDetailFields.length&&<section className="game-page-properties" aria-label="Additional game properties">
              <h2>Game details</h2>
              <dl>{gamePageDetailFields.map(f=>{
                const value=f.type==='checkbox'?(draft.values[f.id]===true?'Yes':'No'):display(draft.values[f.id]);
                const link=f.type==='url'?safeLink(draft.values[f.id]):'';
                return <div key={f.id}><dt>{f.name}</dt><dd>{link?<a href={link} target="_blank" rel="noopener noreferrer">Open link <ArrowUpRight size={14}/></a>:value}</dd></div>;
              })}</dl>
            </section>}
            {display(draft.values.Notes).trim()&&<section className="game-page-notes"><h2>Notes</h2><p>{display(draft.values.Notes)}</p></section>}
          </> : <>
          {draft&&!isNewGame&&<button type="button" className="text-button game-page-back" onClick={()=>{const original=games.find(game=>game.id===draft.id);if(original)setDraft(structuredClone(original));setEditingGame(false);}}><ArrowLeft size={16}/> Back to game page</button>}
          <DialogTitle>
            {draft && games.some((g) => g.id === draft.id)
              ? 'Edit game'
              : 'Add a game'}
          </DialogTitle>
          <DialogDescription>
            Keep every detail of your collection in one place.
          </DialogDescription>
          {draft && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (lookupBusy) return;
                if (
                  fields.some((f) => f.id === 'Title') &&
                  !display(draft.values.Title).trim()
                ) {
                  setError('Enter a game title before saving.');
                  return;
                }
                if (
                  data &&
                  (await save({
                    ...data,
                    games: games.some((g) => g.id === draft.id)
                      ? games.map((g) => (g.id === draft.id ? draft : g))
                      : [...games, draft],
                  }))
                )
                  setDraft(null);
              }}
            >
              {fields.some(field=>field.id==='Title')&&<div className="field game-title-editor">
                <label htmlFor="edit-Title">Title</label>
                <input id="edit-Title" type="text" value={display(draft.values.Title)} autoFocus onChange={event=>{
                  if(isNewGame)setLookupQuery(event.target.value);
                  setDraft({...draft,values:{...draft.values,Title:event.target.value}});
                }}/>
              </div>}
              {!isNewGame && (
                <section className="editor-artwork" aria-labelledby="editor-artwork-heading">
                  <div className="editor-artwork-preview"><GameThumbnail key={draft.lookup?.coverUrl} url={draft.lookup?.coverUrl} variant="card"/></div>
                  <div><h3 id="editor-artwork-heading">Artwork</h3><p className="muted">Find a cover online or upload your own image.</p>
                    <div className="backup-buttons">
                      <button
                        type="button"
                        className="quiet"
                        disabled={lookupBusy||busy}
                        onClick={() => {
                          setArtworkGameId(draft.id);
                          setLookupQuery(title(draft, fields));
                          setLookupRetry((n) => n + 1);
                        }}
                      >
                        <Search size={16} /> Find artwork & description
                      </button>
                      <button type="button" className="quiet" disabled={lookupBusy||busy} onClick={()=>void replaceArtwork(draft)}><ImageUp size={16}/> Upload file to replace artwork</button>
                    </div>
                  </div>
                </section>
              )}
              {(isNewGame || artworkLookup) && (
                <section
                  className="game-lookup"
                  aria-label="Automatic game lookup"
                >
                  <div className="field">
                    <label htmlFor="game-lookup">
                      Paste a game title or link
                    </label>
                    <input
                      id="game-lookup"
                      value={lookupQuery}
                      placeholder="e.g. Hades, or an IGN / Steam / Wikipedia link"
                      autoComplete="off"
                      onChange={(e) => setLookupQuery(e.target.value)}
                    />
                  </div>
                  <p className="muted">
                    {isNewGame
                      ? 'Details appear automatically. Preferred link: IGN → Steam for PC → Wikipedia. Your ownership, progress, and personal notes are yours to fill in.'
                      : 'Choose the correct game to add its artwork and short description. Save game keeps your selection.'}
                  </p>
                  <div
                    className="lookup-status"
                    role="status"
                    aria-live="polite"
                  >
                    {lookupBusy && (
                      <RefreshCw size={16} className="lookup-spinner" />
                    )}
                    <span>{lookupStatus}</span>
                  </div>
                  {lookupMatches.length > 0 && (
                    <div className="lookup-matches" aria-label="Game matches">
                      {lookupMatches.map((c) => (
                        <button
                          type="button"
                          className="lookup-match"
                          key={`${c.wikiId}-${c.steamId}`}
                          disabled={lookupBusy}
                          onClick={() => {
                            lookupAbort.current?.abort();
                            const controller = new AbortController();
                            lookupAbort.current = controller;
                            void fillGame(c, controller, draft.id);
                          }}
                        >
                          <strong>{c.name}</strong>
                          <span>{c.description}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {lookupQuery.trim().length >= 2 && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={lookupBusy}
                      onClick={() => setLookupRetry((n) => n + 1)}
                    >
                      Search again
                    </button>
                  )}
                </section>
              )}
              <div className="field game-description-editor">
                <label htmlFor="edit-game-description">Description</label>
                <textarea id="edit-game-description" rows={5} maxLength={6000} value={draft.lookup?.description??''} placeholder="Add a concise description of this game." onChange={event=>setDraft({...draft,lookup:{...draft.lookup,sources:draft.lookup?.sources??[],description:event.target.value}})}/>
              </div>
              <section className="source-editor" aria-labelledby="source-editor-heading">
                <h3 id="source-editor-heading">Sources</h3>
                <p className="muted">Add the pages you want shown on the game page. Leave a field blank to hide that source.</p>
                <div className="source-editor-grid">
                  {['IGN','Steam','Wikipedia','HowLongToBeat','YouTube'].map(name=>{
                    const source=draft.lookup?.sources.find(item=>item.name.toLowerCase()===name.toLowerCase());
                    const placeholder=name==='IGN'?'www.ign.com':name==='Steam'?'store.steampowered.com':name==='Wikipedia'?'en.wikipedia.org':name==='HowLongToBeat'?'howlongtobeat.com/game':'www.youtube.com/watch?v=';
                    return <div className={`field ${name==='YouTube'?'source-youtube':''}`} key={name}><label htmlFor={`edit-source-${name.toLowerCase()}`}>{name} URL</label><input id={`edit-source-${name.toLowerCase()}`} type="url" placeholder={`https://${placeholder}…`} value={source?.url??''} onChange={event=>{
                      const sources=(draft.lookup?.sources??[]).filter(item=>item.name.toLowerCase()!==name.toLowerCase());
                      if(event.target.value)sources.push({name,url:event.target.value});
                      setDraft({...draft,lookup:{...draft.lookup,sources}});
                    }}/>{name==='YouTube'&&<><div className="youtube-searches" aria-label="Find a YouTube video"><span><Video size={16}/> Find the best video</span><a href={youtubeSearch(title(draft,fields),'trailer')} target="_blank" rel="noopener noreferrer">1. Official trailer <ArrowUpRight size={13}/></a><a href={youtubeSearch(title(draft,fields),'ign')} target="_blank" rel="noopener noreferrer">2. IGN review <ArrowUpRight size={13}/></a><a href={youtubeSearch(title(draft,fields),'gameranx')} target="_blank" rel="noopener noreferrer">3. GameRanx Before You Buy <ArrowUpRight size={13}/></a></div><small className="muted">Open the searches in order, choose the correct video, then paste its URL above.</small></>}</div>;
                  })}
                </div>
              </section>
              <div className="field-grid">
                {fields.filter(field=>field.id!=='Title').map((f) => (
                  <div
                    className={`field ${f.type === 'multi_select' || f.id === 'Notes' ? 'wide' : ''}`}
                    key={f.id}
                  >
                    <label htmlFor={`edit-${f.id}`}>{f.name}</label>
                    {f.id === 'ESRB' ? (<><select id="edit-ESRB" value={display(draft.values.ESRB)||'Unknown'} onChange={e=>setDraft({...draft,esrb:undefined,values:{...draft.values,ESRB:e.target.value}})}>{esrbOptions.map(r=><option key={r}>{r}</option>)}</select><small className="muted">Unknown means not verified. Pre-ESRB release predates the rating system; later editions may be rated.</small>{draft.esrb&&<a className="table-link" href={safeLink(draft.esrb.url)} target="_blank" rel="noreferrer">ESRB listing · {draft.esrb.platforms.join(', ')}</a>}</>) : f.type === 'multi_select' ? (
                      <div className="choices" role="group" aria-label={f.name}>
                        {Array.from(
                          new Set([
                            ...f.options,
                            ...(Array.isArray(draft.values[f.id])
                              ? (draft.values[f.id] as string[])
                              : []),
                          ]),
                        ).map((o) => (
                          <label className="choice" key={o}>
                            <Checkbox
                              checked={
                                Array.isArray(draft.values[f.id]) &&
                                (draft.values[f.id] as string[]).includes(o)
                              }
                              onCheckedChange={(checked) => {
                                const values = Array.isArray(draft.values[f.id])
                                  ? (draft.values[f.id] as string[])
                                  : [];
                                setDraft({
                                  ...draft,
                                  values: {
                                    ...draft.values,
                                    [f.id]: checked
                                      ? [...values, o]
                                      : values.filter((v) => v !== o),
                                  },
                                });
                              }}
                            />
                            {o}
                          </label>
                        ))}
                        {!f.options.length && (
                          <span className="muted">
                            No choices are available for this property.
                          </span>
                        )}
                      </div>
                    ) : f.type === 'checkbox' ? (
                      <Checkbox
                        id={`edit-${f.id}`}
                        checked={draft.values[f.id] === true}
                        onCheckedChange={(v) =>
                          setDraft({
                            ...draft,
                            values: { ...draft.values, [f.id]: v },
                          })
                        }
                      />
                    ) : f.id === 'Notes' ? (
                      <textarea
                        id={`edit-${f.id}`}
                        rows={3}
                        value={display(draft.values[f.id])}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            values: { ...draft.values, [f.id]: e.target.value },
                          })
                        }
                      />
                    ) : (
                      <input
                        id={`edit-${f.id}`}
                        type={
                          f.type === 'number'
                            ? 'number'
                            : f.type === 'date'
                              ? 'date'
                              : f.type === 'url'
                                ? 'url'
                                : 'text'
                        }
                        step="any"
                        value={display(draft.values[f.id])}
                        onChange={(e) => {
                          if (f.id === 'Title' && isNewGame)
                            setLookupQuery(e.target.value);
                          setDraft({
                            ...draft,
                            values: {
                              ...draft.values,
                              [f.id]:
                                f.type === 'number' && e.target.value !== ''
                                  ? Number(e.target.value)
                                  : e.target.value,
                            },
                          });
                        }}
                      />
                    )}
                  </div>
                ))}
                {fields.some((f) => f.id === 'Release Date') && (
                  <div className="field">
                    <label htmlFor="end-date">
                      Release date range end (optional)
                    </label>
                    <input
                      id="end-date"
                      type="date"
                      value={draft.dateEnd?.slice(0, 10) ?? ''}
                      onChange={(e) =>
                        setDraft({ ...draft, dateEnd: e.target.value })
                      }
                    />
                  </div>
                )}
              </div>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <div className="editor-actions">
                {games.some((g) => g.id === draft.id) && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      setConfirm({
                        title: 'Remove this game?',
                        body: `Remove ${title(draft, fields)} from your library. A downloaded backup can restore it later.`,
                        run: async () => {
                          if (
                            data &&
                            (await save({
                              ...data,
                              games: games.filter((g) => g.id !== draft.id),
                            }))
                          ) {
                            setConfirm(null);
                            setDraft(null);
                          }
                        },
                      })
                    }
                  >
                    <Trash2 size={17} />
                    Remove
                  </button>
                )}
                {contains(draft, 'Ownership', 'Wish List') && (
                  <button
                    className="quiet"
                    type="button"
                    onClick={() =>
                      setDraft({
                        ...draft,
                        values: {
                          ...draft.values,
                          Ownership: Array.from(
                            new Set([
                              ...(Array.isArray(draft.values.Ownership)
                                ? draft.values.Ownership
                                : []
                              ).filter((x) => x !== 'Wish List'),
                              'Physical',
                            ]),
                          ),
                        },
                      })
                    }
                  >
                    Mark as purchased
                  </button>
                )}
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || lookupBusy}
                >
                  <Check size={18} />
                  {busy ? 'Saving…' : 'Save game'}
                </button>
              </div>
            </form>
          )}
          </>}
        </DialogContent>
      </Dialog>
      {!artworkOpen&&!descriptionsOpen&&<DesktopSettings open={settings} onOpenChange={setSettings} onReload={reload} onArtwork={()=>{setSettings(false);setArtworkOpen(true);}} onDescriptions={()=>{setSettings(false);setDescriptionsOpen(true);}}/>}
      {artworkOpen&&<ArtworkSettings onClose={()=>setArtworkOpen(false)} onReload={reload}/>}
      {descriptionsOpen&&<DescriptionSettings onClose={()=>setDescriptionsOpen(false)} onReload={reload}/>}
      <AlertDialog
        open={!!confirm}
        onOpenChange={(o) => !o && !busy && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm?.body}</AlertDialogDescription>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void confirm?.run()}
            >
              {busy ? 'Saving…' : 'Confirm'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {notice && (
        <div role="status" className="save-notice">
          <Check size={17} />
          {notice}
        </div>
      )}
    </main>
  );
}
