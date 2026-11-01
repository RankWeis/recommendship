/** App-wide sheet state, so any screen can open Quick Add or the rating sheet. */
export const ui = $state({
	quickAddOpen: false,
	rateItemId: null as string | null,
	aboutOpen: false
});

// Per-device conveniences (§5.1). Storage can be unavailable (private mode), so every access is guarded.
const STICKY_MS = 10 * 60 * 1000;

function read<T>(key: string): T | null {
	try {
		const s = localStorage.getItem(key);
		return s ? (JSON.parse(s) as T) : null;
	} catch {
		return null;
	}
}

function write(key: string, value: unknown) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Not worth surfacing: these are only defaults.
	}
}

/** The recommender stays filled in for 10 minutes, for when Sam is reeling off five shows. */
export function getStickyRecommender(): string {
	const s = read<{ who: string; at: number }>('rs.sticky');
	return s && Date.now() - s.at < STICKY_MS ? s.who : '';
}

export function setStickyRecommender(who: string) {
	write('rs.sticky', { who, at: Date.now() });
}

export const getLastCategory = () => read<string>('rs.lastCategory') ?? 'cat-movie';
export const setLastCategory = (id: string) => write('rs.lastCategory', id);
