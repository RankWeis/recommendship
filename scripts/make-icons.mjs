#!/usr/bin/env node
// Renders the PNG app icons and the link-preview card from apps/web/static/icon.svg
// (run after changing it):
//   node scripts/make-icons.mjs
// iPhones ignore SVG for home-screen icons and add their own rounded corners, so
// apple-touch-icon is a full-bleed square; Android gets 192/512 plus a full-bleed
// "maskable" 512 it can crop to any shape. og-image.png is the 1200×630 card that
// Reddit, iMessage and Slack show under a shared link (see app.html).
//
// CHROMIUM=/path/to/chromium uses that browser instead of the one Playwright installed.

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dir = 'apps/web/static';
const svg = readFileSync(`${dir}/icon.svg`, 'utf8');
const square = svg.replace(/rx="[^"]*"/, 'rx="0"');

const icons = [
	['apple-touch-icon.png', 180, square],
	['icon-192.png', 192, svg],
	['icon-512.png', 512, svg],
	['icon-maskable-512.png', 512, square]
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage();
for (const [name, size, source] of icons) {
	await page.setViewportSize({ width: size, height: size });
	const sized = source.replace('<svg ', `<svg width="${size}" height="${size}" `);
	await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
	await page.locator('svg').screenshot({ path: `${dir}/${name}`, omitBackground: true });
	console.log(`${dir}/${name}`);
}

// The card: brand colours from app.css, the header's wordmark, the manifest's tagline.
await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`<!doctype html>
<html><head><style>
	body { margin: 0; width: 1200px; height: 630px; background: #1f6f5c; color: #f7f5f0;
		font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
	.card { display: flex; align-items: center; gap: 64px; height: 100%; padding: 0 96px; box-sizing: border-box; }
	.icon { flex: none; width: 240px; height: 240px; border-radius: 52px; background: #f7f5f0; overflow: hidden;
		box-shadow: 0 24px 64px rgb(0 0 0 / 25%); }
	.icon svg { display: block; width: 240px; height: 240px; }
	h1 { margin: 0 0 20px; font-size: 92px; line-height: 1; font-weight: 800; letter-spacing: -0.03em; }
	h1 span { color: #f2b84b; }
	p { margin: 0; font-size: 38px; line-height: 1.3; opacity: 0.92; max-width: 720px; }
	.url { position: absolute; left: 96px; bottom: 56px; font-size: 26px; opacity: 0.7; letter-spacing: 0.01em; }
</style></head>
<body>
	<div class="card">
		<div class="icon">${svg}</div>
		<div>
			<h1>Recommend<span>ship</span></h1>
			<p>Track who recommends what, and learn whose picks you love.</p>
		</div>
	</div>
	<div class="url">recommendship.app</div>
</body></html>`);
await page.screenshot({ path: `${dir}/og-image.png`, clip: { x: 0, y: 0, width: 1200, height: 630 } });
console.log(`${dir}/og-image.png`);

await browser.close();
