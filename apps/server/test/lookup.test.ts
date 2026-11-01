// Lookup against stand-ins for TMDB and Open Library: what's kept from their answers,
// the cache, and how failures surface.

import { describe, expect, it, vi } from 'vitest';
import { createLookup, LookupUnavailable } from '../src/lookup';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(routes: Record<string, unknown>) {
	return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
		const u = new URL(String(url));
		const body = routes[u.pathname];
		return body === undefined ? reply({}, 404) : reply(body);
	});
}

describe('lookup', () => {
	it('finds movies on TMDB with the token, keeping title, year and poster', async () => {
		const f = fakeFetch({
			'/3/search/movie': {
				results: [
					{ id: 693134, title: 'Dune: Part Two', release_date: '2024-02-27', poster_path: '/p2.jpg' },
					{ id: 438631, title: 'Dune', release_date: '2021-09-15', poster_path: null },
					{ id: 1, title: 'Unreleased', release_date: '' }
				]
			}
		});
		const lookup = createLookup({ tmdbToken: 'tok', contact: 'https://recommendship.app', fetch: f });
		expect(await lookup.search('movie', ' Dune ')).toEqual([
			{ source: 'TMDB_MOVIE', id: '693134', title: 'Dune: Part Two', year: 2024, creator: null, imageUrl: 'https://image.tmdb.org/t/p/w185/p2.jpg' },
			{ source: 'TMDB_MOVIE', id: '438631', title: 'Dune', year: 2021, creator: null, imageUrl: null },
			{ source: 'TMDB_MOVIE', id: '1', title: 'Unreleased', year: null, creator: null, imageUrl: null }
		]);
		const [url, init] = f.mock.calls[0]!;
		expect(new URL(String(url)).searchParams.get('query')).toBe('Dune');
		expect((init?.headers as Record<string, string>).authorization).toBe('Bearer tok');
	});

	it('finds shows and books, and gets a director or creators on request', async () => {
		const f = fakeFetch({
			'/3/search/tv': { results: [{ id: 95396, name: 'Severance', first_air_date: '2022-02-17', poster_path: '/s.jpg' }] },
			'/search.json': { docs: [{ key: '/works/OL1W', title: 'Piranesi', author_name: ['Susanna Clarke'], first_publish_year: 2020, cover_i: 42 }] },
			'/3/movie/693134/credits': { crew: [{ job: 'Producer', name: 'X' }, { job: 'Director', name: 'Denis Villeneuve' }] },
			'/3/tv/95396': { created_by: [{ name: 'Dan Erickson' }] }
		});
		const lookup = createLookup({ tmdbToken: 'tok', contact: 'test', fetch: f });
		expect((await lookup.search('tv', 'severance'))[0]).toMatchObject({ source: 'TMDB_TV', id: '95396', title: 'Severance', year: 2022 });
		expect(await lookup.search('book', 'piranesi')).toEqual([
			{
				source: 'OPEN_LIBRARY',
				id: 'OL1W',
				title: 'Piranesi',
				year: 2020,
				creator: 'Susanna Clarke',
				imageUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg'
			}
		]);
		expect(await lookup.details('TMDB_MOVIE', '693134')).toEqual({ creator: 'Denis Villeneuve' });
		expect(await lookup.details('TMDB_TV', '95396')).toEqual({ creator: 'Dan Erickson' });
	});

	it('remembers answers, ignoring case and spaces', async () => {
		const f = fakeFetch({ '/3/search/movie': { results: [] } });
		const lookup = createLookup({ tmdbToken: 'tok', contact: 'test', fetch: f });
		await lookup.search('movie', 'Dune');
		await lookup.search('movie', ' dune');
		expect(f).toHaveBeenCalledTimes(1);
	});

	it("says when it can't help: no token, or the provider fails", async () => {
		const noToken = createLookup({ contact: 'test', fetch: fakeFetch({}) });
		expect(noToken.available).toEqual({ movie: false, tv: false, book: true });
		await expect(noToken.search('movie', 'Dune')).rejects.toBeInstanceOf(LookupUnavailable);

		const down = createLookup({ tmdbToken: 'tok', contact: 'test', fetch: vi.fn(async () => reply({}, 500)) });
		await expect(down.search('tv', 'x')).rejects.toThrow('api.themoviedb.org answered 500');
		const offline = createLookup({ contact: 'test', fetch: vi.fn(async () => Promise.reject(new TypeError('fetch failed'))) });
		await expect(offline.search('book', 'x')).rejects.toThrow("openlibrary.org didn't answer");
	});
});
