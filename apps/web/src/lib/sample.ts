// A believable starter dataset so the sorting is visible before you've rated
// thirty things yourself: Sam is great at movies and bad at restaurants, Pat's
// restaurant picks disappoint, Jo's books land, Alex is a coin flip.

import { quickAdd, rateItem } from './actions';

type Sample = [title: string, category: string, who: string[], rating?: number];

const SAMPLES: Sample[] = [
	['Past Lives', 'cat-movie', ['Sam'], 4.5],
	['Aftersun', 'cat-movie', ['Sam'], 5],
	['The Holdovers', 'cat-movie', ['Sam', 'Alex'], 4],
	['Perfect Days', 'cat-movie', ['Sam'], 4.5],
	['Tár', 'cat-movie', ['Alex'], 3],
	['Saltburn', 'cat-movie', ['Alex'], 2],
	['Oppenheimer', 'cat-movie', ['Pat'], 3.5],
	['Barbie', 'cat-movie', ['Pat'], 3.5],
	['Severance', 'cat-tv', ['Sam', 'Jo'], 5],
	['The Bear', 'cat-tv', ['Alex'], 4],
	['Slow Horses', 'cat-tv', ['Pat'], 3.5],
	['Beef', 'cat-tv', ['Alex'], 2.5],
	['Piranesi', 'cat-book', ['Jo'], 5],
	['Tomorrow, and Tomorrow, and Tomorrow', 'cat-book', ['Jo'], 4.5],
	['Klara and the Sun', 'cat-book', ['Jo', 'Alex'], 4],
	['Project Hail Mary', 'cat-book', ['Sam'], 4],
	['The Covenant of Water', 'cat-book', ['Pat'], 3],
	['Lers Ros', 'cat-restaurant', ['Sam'], 2],
	['Burma Superstar', 'cat-restaurant', ['Pat'], 2.5],
	['Nopalito', 'cat-restaurant', ['Pat'], 3],
	['Tartine', 'cat-restaurant', ['Jo'], 4],
	['Zuni Café', 'cat-restaurant', ['Alex'], 4.5],
	['Hardcore History', 'cat-podcast', ['Alex'], 3.5],
	['Search Engine', 'cat-podcast', ['Jo'], 4.5],
	['Outer Wilds', 'cat-game', ['Sam'], 5],
	['Hades II', 'cat-game', ['Alex'], 3],
	// Pending: these are what the sorted list is for.
	['Anatomy of a Fall', 'cat-movie', ['Sam']],
	['The Zone of Interest', 'cat-movie', ['Alex']],
	['Poor Things', 'cat-movie', ['Pat']],
	['Shōgun', 'cat-tv', ['Sam', 'Jo']],
	['Baby Reindeer', 'cat-tv', ['Alex']],
	['James', 'cat-book', ['Jo']],
	['Intermezzo', 'cat-book', ['Pat']],
	['Kin Khao', 'cat-restaurant', ['Sam']],
	['State Bird Provisions', 'cat-restaurant', ['Alex']],
	['Flour + Water', 'cat-restaurant', ['Pat']],
	['Blue Prince', 'cat-game', ['Sam']],
	['The Rest Is History', 'cat-podcast', ['Riley']]
];

export async function loadSampleData() {
	for (const [title, categoryId, who, rating] of SAMPLES) {
		const { itemId } = await quickAdd({ title, categoryId, recommenderNames: who });
		if (rating != null) await rateItem(itemId, rating, null);
	}
}
