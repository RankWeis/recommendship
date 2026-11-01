// Finding the real movie, show or book behind a typed title, through our API (see
// apps/server/src/lookup.ts). Lookup is a nice-to-have: offline, signed out, or with
// the provider down, it quietly returns nothing and the title is saved as typed.

import type { ExternalSource } from '@recommendship/schema';
import { account } from './sync.svelte';

export type LookupKind = 'movie' | 'tv' | 'book';

/** A provider's record of the thing, as stored on an item. */
export interface Match {
	source: Exclude<ExternalSource, 'NONE'>;
	id: string;
	title: string;
	year: number | null;
	creator: string | null;
	imageUrl: string | null;
}

const KIND: Partial<Record<ExternalSource, LookupKind>> = { TMDB_MOVIE: 'movie', TMDB_TV: 'tv', OPEN_LIBRARY: 'book' };

/** Which lookup a category uses, if any is available right now. */
export function lookupKind(categorySource: ExternalSource | undefined): LookupKind | null {
	const kind = categorySource ? KIND[categorySource] : undefined;
	if (!kind || !account.me || !account.config.lookup?.[kind]) return null;
	return kind;
}

export async function searchTitles(kind: LookupKind, q: string, signal?: AbortSignal): Promise<Match[]> {
	try {
		const res = await fetch(`/api/lookup?${new URLSearchParams({ kind, q: q.trim() })}`, { signal });
		if (!res.ok) return [];
		return ((await res.json()) as { results: Match[] }).results;
	} catch {
		return [];
	}
}

/** A film's director or a show's creators, which search results leave out. */
export async function lookupCreator(source: Match['source'], id: string): Promise<string | null> {
	try {
		const res = await fetch(`/api/lookup/details?${new URLSearchParams({ source, id })}`);
		return res.ok ? ((await res.json()) as { creator: string | null }).creator : null;
	} catch {
		return null;
	}
}
