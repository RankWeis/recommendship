/**
 * Fixed-window limiter kept in memory. Each call spends `cost` (default 1) from the
 * key's budget for the window. Fine while the API runs on one machine; move it to
 * Postgres or Redis before scaling out.
 */
export function rateLimiter({ limit, windowMs }: { limit: number; windowMs: number }) {
	const hits = new Map<string, { count: number; resetAt: number }>();
	return (key: string, cost = 1, now = Date.now()): boolean => {
		const h = hits.get(key);
		if (!h || now >= h.resetAt) {
			hits.set(key, { count: cost, resetAt: now + windowMs });
			if (hits.size > 10_000) for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
			return cost <= limit;
		}
		h.count += cost;
		return h.count <= limit;
	};
}
