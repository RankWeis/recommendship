#!/usr/bin/env node
// Renders the PNG app icons from apps/web/static/icon.svg (run after changing it):
//   node scripts/make-icons.mjs
// iPhones ignore SVG for home-screen icons and add their own rounded corners, so
// apple-touch-icon is a full-bleed square; Android gets 192/512 plus a full-bleed
// "maskable" 512 it can crop to any shape.

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dir = 'apps/web/static';
const svg = readFileSync(`${dir}/icon.svg`, 'utf8');
const square = svg.replace(/rx="[^"]*"/, 'rx="0"');

const outputs = [
	['apple-touch-icon.png', 180, square],
	['icon-192.png', 192, svg],
	['icon-512.png', 512, svg],
	['icon-maskable-512.png', 512, square]
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, source] of outputs) {
	await page.setViewportSize({ width: size, height: size });
	const sized = source.replace('<svg ', `<svg width="${size}" height="${size}" `);
	await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
	await page.locator('svg').screenshot({ path: `${dir}/${name}`, omitBackground: true });
	console.log(`${dir}/${name}`);
}
await browser.close();
