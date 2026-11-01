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
 * Sam with three movies (4.5, 5, 4) and one restaurant (2), plus ratings of
 * other people's picks, which must not matter to Sam's predictions.
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

describe('worked example', () => {
	const { model, predictions } = recompute(workedExample());
	const byId = new Map(predictions.map((p) => [p.itemId, p]));

	it('starts from the middle of the scale, not your average', () => {
		expect(model.start).toBe(3.5);
	});

	it("computes Sam's offsets", () => {
		// (1 + 1.5 + 0.5 − 1.5) / (4 + 3)
		expect(model.bR.get('sam')).toBeCloseTo(0.214, 3);
		expect(model.bRc.get('sam\u0000movie')).toBeCloseTo(0.295, 3);
		expect(model.bRc.get('sam\u0000restaurant')).toBeCloseTo(-0.286, 3);
	});

	it("predicts Sam's new movie ≈ 4.01", () => {
		expect(byId.get('sam-new-movie')?.predicted).toBeCloseTo(4.01, 2);
	});

	it("predicts Sam's new restaurant ≈ 3.43", () => {
		expect(byId.get('sam-new-restaurant')?.predicted).toBeCloseTo(3.43, 2);
	});

	it('is more confident about the movie than the restaurant', () => {
		expect(byId.get('sam-new-movie')!.confidence).toBeGreaterThan(byId.get('sam-new-restaurant')!.confidence);
	});
});

describe('per person', () => {
	const jeffMovie = tried('movie', 3, 'jeff-1');
	const input = (jeffRating: number): ScoreInput => ({
		items: [{ ...jeffMovie, rating: jeffRating }, tried('movie', 4, 'jona-1'), pending('movie', 'jona-new'), pending('movie', 'kim-new')],
		recommendations: [
			{ itemId: 'jeff-1', recommenderId: 'jeff' },
			{ itemId: 'jona-1', recommenderId: 'jona' },
			{ itemId: 'jona-new', recommenderId: 'jona' },
			{ itemId: 'kim-new', recommenderId: 'kim' }
		]
	});

	it("rating one person's pick leaves everyone else's predictions alone", () => {
		const before = recompute(input(3)).predictions;
		const after = recompute(input(5)).predictions;
		for (const id of ['jona-new', 'kim-new']) {
			const b = before.find((p) => p.itemId === id)!;
			const a = after.find((p) => p.itemId === id)!;
			expect(a).toEqual(b);
		}
	});

	it('leaves someone with no rated picks at the starting point', () => {
		const kim = recompute(input(5)).predictions.find((p) => p.itemId === 'kim-new')!;
		expect(kim).toMatchObject({ predicted: 3.5, confidence: 0 });
	});
});

describe('edge cases', () => {
	it('uses the starting point with no ratings', () => {
		const { predictions } = recompute({ items: [pending('movie', 'a')], recommendations: [{ itemId: 'a', recommenderId: 'sam' }] });
		expect(predictions[0]).toMatchObject({ predicted: 3.5, confidence: 0 });
	});

	it('follows the rating scale', () => {
		const config = { ...DEFAULT_CONFIG, scaleMin: 0, scaleMax: 10 };
		expect(fit({ items: [], recommendations: [] }, config).start).toBe(5.5);
	});

	it('gives an item without a recommender the starting point and zero confidence', () => {
		const p = predict(fit(workedExample()), { id: 'x', categoryId: 'movie' }, []);
		expect(p.predicted).toBe(3.5);
		expect(p.confidence).toBe(0);
	});

	it('averages two recommenders instead of summing them', () => {
		const model = fit(workedExample());
		const sam = predict(model, { id: 'x', categoryId: 'movie' }, ['sam']).predicted;
		const both = predict(model, { id: 'x', categoryId: 'movie' }, ['sam', 'sam-twin']).predicted;
		// The unknown second recommender has weight 0, so it neither adds nor dilutes.
		expect(both).toBeCloseTo(sam, 5);
		expect(both - model.start).toBeLessThan(2 * (sam - model.start));
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

	it("doesn't call two identical ratings a sure thing", () => {
		const items = [tried('movie', 5, 'a'), tried('movie', 5, 'b')];
		const model = fit({ items, recommendations: items.map((i) => ({ itemId: i.id, recommenderId: 'sam' })) });
		expect(model.sigmaR.get('sam')).toBeGreaterThan(0.5);
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
		expect(movies.offsetShrunk).toBeCloseTo(0.214 + 0.295, 3);
	});
});

describe('leave-one-out evaluation', () => {
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
		expect(e.rmseModel).toBeLessThan(e.rmseStart);
		expect(e.rmseModel).toBeLessThan(e.rmseMean);
	});

	it('returns NaN with nothing rated', () => {
		expect(evaluate({ items: [], recommendations: [] }).rmseModel).toBeNaN();
	});
});
