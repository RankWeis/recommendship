// Per-person predictor with shrinkage.
//
//   predicted(i) = start + b_r + b_rc
//
// start is a fixed middle-of-the-road rating (3.5 on a 1–5 scale); b_r is how
// much better or worse r's picks have run for you than that; b_rc is r's extra
// adjustment within category c. Every term's denominator carries k phantom
// ratings at offset 0 ("assume middling until proven otherwise"), so a
// recommender's reputation only moves once there is real evidence.
//
// A prediction rests only on the ratings of its own recommenders' picks: rating
// Jeff's movie changes Jeff's predictions and nobody else's. (The model used to
// start from your average rating, so every rating nudged every prediction.)
//
// Everything here is pure: the app feeds in rows from local SQLite and writes
// the results back to its derived tables.

export interface ScoreConfig {
	/** Shrinkage of b_r toward 0. */
	kR: number;
	/** Shrinkage of b_rc toward 0, harder because it rests on even less data. */
	kRc: number;
	/** k in confidence = n_eff / (n_eff + k), in the multi-recommender weights, and in each person's spread. */
	kConf: number;
	scaleMin: number;
	scaleMax: number;
	/** How far off a prediction is assumed to be, in stars, before a person's ratings say otherwise. */
	sigma0: number;
	/** Added per extra recommender on one item. 0 keeps v1 pure. */
	agreementBonus: number;
	agreementCap: number;
	/** z in the "Safe bets" lower bound. */
	z: number;
	/** A rating at or above this counts as a hit. */
	hitThreshold: number;
}

export const DEFAULT_CONFIG: ScoreConfig = {
	kR: 3,
	kRc: 5,
	kConf: 3,
	scaleMin: 1,
	scaleMax: 5,
	sigma0: 1,
	agreementBonus: 0,
	agreementCap: 0.3,
	z: 1,
	hitThreshold: 4
};

export type Status = 'TO_TRY' | 'TRIED' | 'DISMISSED';

export interface ScoreItem {
	id: string;
	categoryId: string;
	status: Status;
	rating: number | null;
}

export interface ScoreRecommendation {
	itemId: string;
	recommenderId: string;
}

export interface ScoreInput {
	items: ScoreItem[];
	recommendations: ScoreRecommendation[];
}

export interface Model {
	config: ScoreConfig;
	/** Where every prediction starts: the scale's midpoint plus half a star. */
	start: number;
	bR: Map<string, number>;
	nR: Map<string, number>;
	bRc: Map<string, number>;
	nRc: Map<string, number>;
	/** How far off each recommender's predictions run, pulled toward sigma0 until there's evidence. */
	sigmaR: Map<string, number>;
}

export interface RecommenderTerm {
	recommenderId: string;
	bR: number;
	bRc: number;
	nR: number;
	nRc: number;
	weight: number;
}

export interface Explanation {
	categoryId: string;
	start: number;
	recommenders: RecommenderTerm[];
	agreementBonus: number;
}

export interface Prediction {
	itemId: string;
	predicted: number;
	confidence: number;
	lowerBound: number;
	explanation: Explanation;
}

export interface StatRow {
	recommenderId: string;
	/** null = overall. */
	categoryId: string | null;
	n: number;
	meanRaw: number | null;
	/** Overall: b_r. Per category: b_r + b_rc. */
	offsetShrunk: number;
	hitRate: number | null;
	pending: number;
}

const rcKey = (r: string, c: string) => `${r}\u0000${c}`;

function isRated(i: ScoreItem): i is ScoreItem & { rating: number } {
	return i.status === 'TRIED' && i.rating != null;
}

function add(m: Map<string, number>, k: string, v: number) {
	m.set(k, (m.get(k) ?? 0) + v);
}

/** Recommender ids per item, deduped. */
function recommendersByItem(recs: ScoreRecommendation[]): Map<string, string[]> {
	const out = new Map<string, Set<string>>();
	for (const r of recs) {
		let s = out.get(r.itemId);
		if (!s) out.set(r.itemId, (s = new Set()));
		s.add(r.recommenderId);
	}
	return new Map([...out].map(([k, v]) => [k, [...v]]));
}

export const startingPoint = (config: ScoreConfig) => (config.scaleMin + config.scaleMax) / 2 + 0.5;

export function fit(input: ScoreInput, config: ScoreConfig = DEFAULT_CONFIG): Model {
	const { kR, kRc, kConf, sigma0 } = config;
	const start = startingPoint(config);
	const rated = input.items.filter(isRated);
	const byItem = recommendersByItem(input.recommendations);

	// b_r: shrunk mean of r's picks against the starting point.
	const sumR = new Map<string, number>();
	const nR = new Map<string, number>();
	for (const i of rated) {
		for (const r of byItem.get(i.id) ?? []) {
			add(sumR, r, i.rating - start);
			add(nR, r, 1);
		}
	}
	const bR = new Map<string, number>();
	for (const [r, n] of nR) bR.set(r, (sumR.get(r) ?? 0) / (n + kR));

	// b_rc: what's left within each category once b_r is accounted for.
	const sumRc = new Map<string, number>();
	const nRc = new Map<string, number>();
	for (const i of rated) {
		for (const r of byItem.get(i.id) ?? []) {
			const k = rcKey(r, i.categoryId);
			add(sumRc, k, i.rating - start - (bR.get(r) ?? 0));
			add(nRc, k, 1);
		}
	}
	const bRc = new Map<string, number>();
	for (const [k, n] of nRc) bRc.set(k, (sumRc.get(k) ?? 0) / (n + kRc));

	// Spread of r's ratings around the model, with kConf phantom ratings at sigma0
	// so two lucky ratings don't make someone look certain.
	const sqR = new Map<string, number>();
	for (const i of rated) {
		for (const r of byItem.get(i.id) ?? []) {
			const fitted = start + (bR.get(r) ?? 0) + (bRc.get(rcKey(r, i.categoryId)) ?? 0);
			add(sqR, r, (i.rating - fitted) ** 2);
		}
	}
	const sigmaR = new Map<string, number>();
	for (const [r, n] of nR) sigmaR.set(r, Math.sqrt(((sqR.get(r) ?? 0) + kConf * sigma0 ** 2) / (n + kConf)));

	return { config, start, bR, nR, bRc, nRc, sigmaR };
}

/**
 * Predict one item from its recommenders: offsets are combined as a
 * confidence-weighted mean, not summed, so two recommenders don't double-count.
 */
export function predict(model: Model, item: Pick<ScoreItem, 'id' | 'categoryId'>, recommenderIds: string[]): Prediction {
	const { config, start } = model;
	const c = item.categoryId;

	let wSum = 0;
	let offSum = 0;
	let nEff = 0;
	const sigmas: number[] = [];
	const terms: RecommenderTerm[] = [];
	for (const r of new Set(recommenderIds)) {
		const nR = model.nR.get(r) ?? 0;
		const nRc = model.nRc.get(rcKey(r, c)) ?? 0;
		const bR = model.bR.get(r) ?? 0;
		const bRc = model.bRc.get(rcKey(r, c)) ?? 0;
		const n = nRc + 0.5 * nR;
		const weight = n / (n + config.kConf);
		wSum += weight;
		offSum += weight * (bR + bRc);
		nEff += n;
		sigmas.push(model.sigmaR.get(r) ?? config.sigma0);
		terms.push({ recommenderId: r, bR, bRc, nR, nRc, weight });
	}

	const offset = wSum > 0 ? offSum / wSum : 0;
	const bonus = Math.min(config.agreementBonus * Math.max(terms.length - 1, 0), config.agreementCap);
	const clamp = (x: number) => Math.min(config.scaleMax, Math.max(config.scaleMin, x));
	const predicted = clamp(start + offset + bonus);
	const sigma = sigmas.length ? sigmas.reduce((a, b) => a + b, 0) / sigmas.length : config.sigma0;

	return {
		itemId: item.id,
		predicted,
		confidence: nEff / (nEff + config.kConf),
		lowerBound: clamp(predicted - (config.z * sigma) / Math.sqrt(nEff + 1)),
		explanation: { categoryId: c, start, recommenders: terms, agreementBonus: bonus }
	};
}

/** Fit the model and produce every derived row: per-recommender stats and predictions for pending items. */
export function recompute(input: ScoreInput, config: ScoreConfig = DEFAULT_CONFIG) {
	const model = fit(input, config);
	const byItem = recommendersByItem(input.recommendations);

	const predictions = input.items
		.filter((i) => i.status === 'TO_TRY')
		.map((i) => predict(model, i, byItem.get(i.id) ?? []));

	type Acc = { n: number; sum: number; hits: number; pending: number };
	const acc = new Map<string, Acc>();
	const bump = (key: string, i: ScoreItem) => {
		let a = acc.get(key);
		if (!a) acc.set(key, (a = { n: 0, sum: 0, hits: 0, pending: 0 }));
		if (isRated(i)) {
			a.n++;
			a.sum += i.rating;
			if (i.rating >= config.hitThreshold) a.hits++;
		} else if (i.status === 'TO_TRY') {
			a.pending++;
		}
	};
	for (const i of input.items) {
		for (const r of byItem.get(i.id) ?? []) {
			bump(rcKey(r, ''), i);
			bump(rcKey(r, i.categoryId), i);
		}
	}

	const stats: StatRow[] = [...acc].map(([key, a]) => {
		const [recommenderId = '', c = ''] = key.split('\u0000');
		const bR = model.bR.get(recommenderId) ?? 0;
		return {
			recommenderId,
			categoryId: c || null,
			n: a.n,
			meanRaw: a.n ? a.sum / a.n : null,
			offsetShrunk: c ? bR + (model.bRc.get(key) ?? 0) : bR,
			hitRate: a.n ? a.hits / a.n : null,
			pending: a.pending
		};
	});

	return { model, stats, predictions };
}

export interface Evaluation {
	n: number;
	rmseModel: number;
	/** Always the starting point. */
	rmseStart: number;
	/** Always your average of the other ratings, for comparison. */
	rmseMean: number;
}

/**
 * Leave-one-out: predict each rated item from all the other data and compare
 * with the real rating, against the naive "always the starting point" and
 * "always your average".
 */
export function evaluate(input: ScoreInput, config: ScoreConfig = DEFAULT_CONFIG): Evaluation {
	const byItem = recommendersByItem(input.recommendations);
	const rated = input.items.filter(isRated);
	const total = rated.reduce((a, i) => a + i.rating, 0);
	let seModel = 0;
	let seStart = 0;
	let seMean = 0;
	for (const held of rated) {
		const items = input.items.map((i) => (i.id === held.id ? { ...i, status: 'TO_TRY' as const, rating: null } : i));
		const model = fit({ items, recommendations: input.recommendations }, config);
		const p = predict(model, held, byItem.get(held.id) ?? []);
		const mean = rated.length > 1 ? (total - held.rating) / (rated.length - 1) : model.start;
		seModel += (p.predicted - held.rating) ** 2;
		seStart += (model.start - held.rating) ** 2;
		seMean += (mean - held.rating) ** 2;
	}
	const n = rated.length;
	const rmse = (se: number) => (n ? Math.sqrt(se / n) : NaN);
	return { n, rmseModel: rmse(seModel), rmseStart: rmse(seStart), rmseMean: rmse(seMean) };
}
