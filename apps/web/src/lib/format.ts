import type { Explanation } from '@recommendship/score';

export const fmtRating = (x: number | null | undefined) => (x == null ? '–' : x.toFixed(1));

export const fmtOffset = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`;

export const fmtPct = (x: number | null | undefined) => (x == null ? '–' : `${Math.round(x * 100)}%`);

/** 0–1 confidence as three dots: ○○○ means no evidence at all. */
export function confidenceDots(c: number | null | undefined): { filled: number; label: string } {
	const v = c ?? 0;
	const filled = v <= 0 ? 0 : v < 0.34 ? 1 : v < 0.67 ? 2 : 3;
	return { filled, label: ['No track record yet', 'Low confidence', 'Medium confidence', 'High confidence'][filled]! };
}

/** "★★★½" for a 1–5 rating with half steps. */
export function stars(x: number): string {
	const full = Math.floor(x);
	return '★'.repeat(full) + (x - full >= 0.5 ? '½' : '');
}

export function relativeDate(iso: string): string {
	const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
	if (days < 1) return 'today';
	if (days === 1) return 'yesterday';
	if (days < 7) return `${days} days ago`;
	if (days < 60) return `${Math.round(days / 7)} wk ago`;
	return `${Math.round(days / 30)} mo ago`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The one-line "why this number" (§5.2), e.g.
 * "Your movie average 3.6 · Sam's movies run +0.5 for you (3 rated)."
 */
export function explain(e: Explanation, categoryName: string, nameOf: (id: string) => string): string {
	const cat = categoryName.toLowerCase();
	const parts = [`Your ${cat} average ${e.muC.toFixed(1)}${e.nC ? '' : ' (no ratings yet)'}`];
	if (!e.recommenders.length) parts.push('no recommender, so no adjustment');
	for (const r of e.recommenders) {
		const name = nameOf(r.recommenderId);
		if (r.nR === 0) {
			parts.push(`${name} has no rated picks yet`);
		} else if (r.nRc > 0) {
			parts.push(`${name}'s ${cat} picks run ${fmtOffset(r.bR + r.bRc)} for you (${r.nRc} rated)`);
		} else {
			parts.push(`${name}'s picks run ${fmtOffset(r.bR)} overall (${plural(r.nR, 'rating')}, none in ${cat})`);
		}
	}
	if (e.agreementBonus) parts.push(`${fmtOffset(e.agreementBonus)} for agreement`);
	return parts.join(' · ') + '.';
}

/** Where "Send feedback" goes: an email to the person running Recommendship. */
export const FEEDBACK = 'mailto:kian.samii@gmail.com?subject=Recommendship%20feedback';
