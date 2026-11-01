import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, evaluate, fit, predict, recompute, type ScoreInput, type ScoreItem } from './index';

let seq = 0;
const tried = (categoryId: string, rating: number, id = `i${++seq}`): ScoreItem => ({
	id,
	categoryId,
	status: 'TRIED',
	rating
});
const pending = (categoryId: string, id: string): ScoreItem => ({ id, categoryId, status: 'TO_TRY', rating: null });

/**
 * The design sketch's worked example (§4.4): global μ = 3.5, 10 movies with
 * mean 3.6, and Sam with three movies (4.5, 5, 4) and one restaurant (2)
 * against a restaurant baseline of 3.5.
 */
function workedExample(): ScoreInput {
	const samPicks = [tried('movie', 4.5, 'sam-m1'), tried('movie', 5, 'sam-m2'), tried('movie', 4, 'sam-m3'), tried('restaurant', 2, 'sam-r1')];
	const otherMovies = [3, 3, 3, 3, 3.5, 3.5, 3.5].map((x) => tried('movie', x));
	const otherRestaurants = [tried('restaurant', 5)];
	const books = [tried('book', 3), tried('book', 3)];
	return {
		items: [...samPicks, ...otherMovies, ...otherRestaurants, ...books, pending('movie', 'sam-new-movie'), pending('restaurant', 'sam-new-restaurant')],
		recommendations: [...samPicks.map((i) => i.id), 'sam-new-movie', 'sam-new-restaurant'].map((itemId) => ({ itemId, recommenderId: 'sam' }))
	};
}

describe('worked example (§4.4)', () => {
	const { model, predictions } = recompute(workedExample());
	const byId = new Map(predictions.map((p) => [p.itemId, p]));

	it('computes the baselines', () => {
		expect(model.mu).toBeCloseTo(3.5, 5);
		expect(model.muC.get('movie')).toBeCloseTo(3.58, 2);
		expect(model.muC.get('restaurant')).toBeCloseTo(3.5, 5);
	});

	it("computes Sam's offsets", () => {
		expect(model.bR.get('sam')).toBeCloseTo(0.18, 2);
		expect(model.bRc.get('sam\u0000movie')).toBeCloseTo(0.28, 2);
		expect(model.bRc.get('sam\u0000restaurant')).toBeCloseTo(-0.28, 2);
	});

	it("predicts Sam's new movie ≈ 4.04", () => {
		expect(byId.get('sam-new-movie')?.predicted).toBeCloseTo(4.04, 2);
	});

	it("predicts Sam's new restaurant ≈ 3.40", () => {
		expect(byId.get('sam-new-restaurant')?.predicted).toBeCloseTo(3.4, 2);
	});

	it('is more confident about the movie than the restaurant', () => {
		expect(byId.get('sam-new-movie')!.confidence).toBeGreaterThan(byId.get('sam-new-restaurant')!.confidence);
	});
});

describe('edge cases', () => {
	it('uses the prior with no ratings', () => {
		const { predictions } = recompute({ items: [pending('movie', 'a')], recommendations: [{ itemId: 'a', recommenderId: 'sam' }] });
		expect(predictions[0]).toMatchObject({ predicted: 3.5, confidence: 0 });
	});

	it('uses the prior until there are enough ratings', () => {
		const model = fit({ items: [tried('movie', 5), tried('movie', 5)], recommendations: [] });
		expect(model.mu).toBe(3.5);
	});

	it('gives an item without a recommender μ_c and zero confidence', () => {
		const p = predict(fit(workedExample()), { id: 'x', categoryId: 'movie' }, []);
		expect(p.predicted).toBeCloseTo(3.58, 2);
		expect(p.confidence).toBe(0);
	});

	it('averages two recommenders instead of summing them', () => {
		const model = fit(workedExample());
		const sam = predict(model, { id: 'x', categoryId: 'movie' }, ['sam']).predicted;
		const both = predict(model, { id: 'x', categoryId: 'movie' }, ['sam', 'sam-twin']).predicted;
		const muC = model.muC.get('movie')!;
		// The unknown second recommender has weight 0, so it neither adds nor dilutes.
		expect(both).toBeCloseTo(sam, 5);
		expect(both - muC).toBeLessThan(2 * (sam - muC));
	});

	it('adds the agreement bonus only when configured, capped', () => {
		const config = { ...DEFAULT_CONFIG, agreementBonus: 0.1, agreementCap: 0.3 };
		const model = fit(workedExample(), config);
		const p = predict(model, { id: 'x', categoryId: 'movie' }, ['sam', 'a', 'b', 'c', 'd', 'e']);
		expect(p.explanation.agreementBonus).toBeCloseTo(0.3, 5);
	});

	it('ignores dismissed items', () => {
		const input = workedExample();
		const base = fit(input);
		input.items.push({ id: 'meh', categoryId: 'movie', status: 'DISMISSED', rating: 1 });
		input.recommendations.push({ itemId: 'meh', recommenderId: 'sam' });
		expect(fit(input).bR.get('sam')).toBe(base.bR.get('sam'));
	});

	it('clamps predictions to the scale', () => {
		const items = Array.from({ length: 30 }, () => tried('movie', 5));
		items.push(...Array.from({ length: 30 }, () => tried('movie', 1)));
		const great = items.slice(0, 30);
		const recommendations = great.map((i) => ({ itemId: i.id, recommenderId: 'sam' }));
		const p = predict(fit({ items, recommendations }), { id: 'x', categoryId: 'movie' }, ['sam']);
		expect(p.predicted).toBeLessThanOrEqual(5);
		expect(p.lowerBound).toBeLessThanOrEqual(p.predicted);
	});
});

describe('recommender stats', () => {
	const { stats } = recompute(workedExample());
	const overall = stats.find((s) => s.recommenderId === 'sam' && s.categoryId === null)!;
	const movies = stats.find((s) => s.recommenderId === 'sam' && s.categoryId === 'movie')!;

	it('counts rated and pending', () => {
		expect(overall).toMatchObject({ n: 4, pending: 2 });
		expect(movies).toMatchObject({ n: 3, pending: 1 });
	});

	it('reports raw mean and hit rate', () => {
		expect(movies.meanRaw).toBeCloseTo(4.5, 5);
		expect(movies.hitRate).toBe(1);
		expect(overall.hitRate).toBe(0.75);
	});

	it('reports the full per-category offset', () => {
		expect(movies.offsetShrunk).toBeCloseTo(0.18 + 0.28, 2);
	});
});

describe('leave-one-out evaluation (§4.5)', () => {
	it('beats the naive baselines when recommenders are consistent', () => {
		const items: ScoreItem[] = [];
		const recommendations = [];
		for (let k = 0; k < 15; k++) {
			const good = tried('movie', k % 2 ? 4.5 : 5);
			const bad = tried('movie', k % 2 ? 2 : 1.5);
			items.push(good, bad);
			recommendations.push({ itemId: good.id, recommenderId: 'sam' }, { itemId: bad.id, recommenderId: 'pat' });
		}
		const e = evaluate({ items, recommendations });
		expect(e.n).toBe(30);
		expect(e.rmseModel).toBeLessThan(e.rmseMu);
		expect(e.rmseModel).toBeLessThan(e.rmseMuC);
	});

	it('returns NaN with nothing rated', () => {
		expect(evaluate({ items: [], recommendations: [] }).rmseModel).toBeNaN();
	});
});
