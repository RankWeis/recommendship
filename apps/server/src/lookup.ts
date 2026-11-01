// Title lookup for Quick Add: movies and TV from TMDB, books from Open Library.
// Phones ask this API rather than the providers, so the TMDB token stays on the
// server. Results are trimmed to what an item stores and kept in memory for a day:
// the same titles get searched again and again, and the API runs on one machine.

export type LookupKind = 'movie' | 'tv' | 'book';
export type LookupSource = 'TMDB_MOVIE' | 'TMDB_TV' | 'OPEN_LIBRARY';

export interface LookupResult {
	source: LookupSource;
	id: string;
	title: string;
	year: number | null;
	/** Author for books. Directors and showrunners need a second call (details). */
	creator: string | null;
	imageUrl: string | null;
}

/** The provider isn't set up or didn't answer; the app then saves the title as typed. */
export class LookupUnavailable extends Error {}

const TTL_MS = 24 * 60 * 60_000;
const MAX_ENTRIES = 2_000;
const TIMEOUT_MS = 5_000;

const year = (date: unknown) => (typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null);
const names = (list: { name?: unknown }[] | undefined, max = 2) =>
	(list ?? [])
		.map((p) => p.name)
		.filter((n): n is string => typeof n === 'string' && !!n)
		.slice(0, max)
		.join(', ') || null;

export function createLookup({ tmdbToken, contact, fetch: get = fetch }: { tmdbToken?: string; contact: string; fetch?: typeof fetch }) {
	const cache = new Map<string, { at: number; value: unknown }>();

	async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
		const hit = cache.get(key);
		if (hit && Date.now() - hit.at < TTL_MS) {
			// Map keeps insertion order: re-adding marks it recently used.
			cache.delete(key);
			cache.set(key, hit);
			return hit.value as T;
		}
		const value = await load();
		cache.set(key, { at: Date.now(), value });
		if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
		return value;
	}

	async function json(url: string, headers: Record<string, string>) {
		let res: Response;
		try {
			res = await get(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
		} catch {
			throw new LookupUnavailable(`${new URL(url).host} didn't answer`);
		}
		if (!res.ok) throw new LookupUnavailable(`${new URL(url).host} answered ${res.status}`);
		return res.json() as Promise<Record<string, unknown>>;
	}

	function tmdb(path: string, params: Record<string, string> = {}) {
		if (!tmdbToken) throw new LookupUnavailable('movie and TV lookup is not set up');
		const qs = new URLSearchParams({ language: 'en-US', ...params });
		return json(`https://api.themoviedb.org/3${path}?${qs}`, { authorization: `Bearer ${tmdbToken}` });
	}

	// Open Library asks callers to identify themselves with a contact.
	const openLibrary = (path: string, params: Record<string, string>) =>
		json(`https://openlibrary.org${path}?${new URLSearchParams(params)}`, { 'user-agent': `Recommendship (${contact})` });

	async function search(kind: LookupKind, query: string): Promise<LookupResult[]> {
		const q = query.trim();
		return cached(`search:${kind}:${q.toLowerCase()}`, async () => {
			if (kind === 'book') {
				const body = await openLibrary('/search.json', { q, limit: '8', fields: 'key,title,author_name,first_publish_year,cover_i' });
				return ((body.docs ?? []) as Record<string, unknown>[]).flatMap((d) =>
					typeof d.key === 'string' && typeof d.title === 'string'
						? [
								{
									source: 'OPEN_LIBRARY' as const,
									id: d.key.replace('/works/', ''),
									title: d.title,
									year: typeof d.first_publish_year === 'number' ? d.first_publish_year : null,
									creator: Array.isArray(d.author_name) ? d.author_name.slice(0, 2).join(', ') || null : null,
									imageUrl: typeof d.cover_i === 'number' ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null
								}
							]
						: []
				);
			}
			const body = await tmdb(`/search/${kind}`, { query: q, include_adult: 'false', page: '1' });
			return ((body.results ?? []) as Record<string, unknown>[]).slice(0, 8).flatMap((r) => {
				const title = kind === 'movie' ? r.title : r.name;
				if (typeof r.id !== 'number' || typeof title !== 'string') return [];
				return [
					{
						source: kind === 'movie' ? ('TMDB_MOVIE' as const) : ('TMDB_TV' as const),
						id: String(r.id),
						title,
						year: year(kind === 'movie' ? r.release_date : r.first_air_date),
						creator: null,
						imageUrl: typeof r.poster_path === 'string' ? `https://image.tmdb.org/t/p/w185${r.poster_path}` : null
					}
				];
			});
		});
	}

	/** Who made it, when the search result didn't say: a film's director, a show's creators. */
	async function details(source: LookupSource, id: string): Promise<{ creator: string | null }> {
		return cached(`details:${source}:${id}`, async () => {
			if (source === 'TMDB_MOVIE') {
				const body = await tmdb(`/movie/${encodeURIComponent(id)}/credits`);
				const crew = (body.crew ?? []) as { job?: unknown; name?: unknown }[];
				return { creator: names(crew.filter((p) => p.job === 'Director')) };
			}
			if (source === 'TMDB_TV') {
				const body = await tmdb(`/tv/${encodeURIComponent(id)}`);
				return { creator: names(body.created_by as { name?: unknown }[] | undefined) };
			}
			const body = await openLibrary(`/works/${encodeURIComponent(id)}.json`, {});
			// Works list author keys, not names; the search result already had the names.
			return { creator: typeof body.by_statement === 'string' ? body.by_statement : null };
		});
	}

	return { search, details, available: { movie: !!tmdbToken, tv: !!tmdbToken, book: true } };
}

export type Lookup = ReturnType<typeof createLookup>;
