// What a valid row looks like, by snake_case column name (as PowerSync sends them).
// The server's write handler enforces these on every upload; the web app checks
// backup files against the same rules before importing, so nothing it writes is
// later rejected.

import { z } from 'zod';
import { CHANNELS, EXTERNAL_SOURCES, ITEM_STATUSES } from './index';

/** Most changes one upload request may carry. Bigger local transactions are refused, so imports write in smaller ones. */
export const MAX_OPS_PER_BATCH = 500;

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) => z.string().max(max).nullish();
const iso = z
	.string()
	.max(40)
	.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'expected an ISO-8601 timestamp');
export const rowId = z.string().min(1).max(64);

export const columns = {
	category: z.object({
		name: text(80),
		icon: text(16),
		external_source: z.enum(EXTERNAL_SOURCES).optional(),
		sort_order: z.number().int().min(0).max(10_000).optional()
	}),
	recommender: z.object({
		name: text(120),
		notes: optText(2_000),
		created_at: iso
	}),
	item: z.object({
		category_id: rowId,
		title: text(300),
		year: z.number().int().min(0).max(3000).nullish(),
		creator: optText(300),
		external_source: z.enum(EXTERNAL_SOURCES).nullish(),
		external_id: optText(100),
		image_url: z.string().url().max(1_000).nullish(),
		metadata: optText(10_000),
		status: z.enum(ITEM_STATUSES),
		rating: z
			.number()
			.min(1)
			.max(5)
			.refine((x) => Number.isInteger(x * 2), 'ratings go in half steps')
			.nullish(),
		rated_at: iso.nullish(),
		review: optText(5_000),
		added_at: iso,
		tried_at: iso.nullish()
	}),
	recommendation: z.object({
		item_id: rowId,
		recommender_id: rowId,
		received_at: iso,
		channel: z.enum(CHANNELS).nullish(),
		enthusiasm: z.number().int().min(1).max(3).nullish(),
		note: optText(2_000)
	})
} as const;
