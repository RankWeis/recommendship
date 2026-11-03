// Someone arriving from a shared link can try the app before making an account.

import { expect, test } from '@playwright/test';
import { quickAdd } from './helpers';

test('the empty Put List says no account is needed, and adding works signed out', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'The Put List is empty' })).toBeVisible();
	await expect(page.getByText('No account needed to try it')).toBeVisible();

	await quickAdd(page, 'Piranesi', 'Jo');
	await expect(page.getByText('No account needed to try it')).toBeHidden();
});

// Reddit, iMessage and Slack read these tags from the HTML without running the app, so
// they're in app.html; the card image is a static file every environment serves.
test('a shared link gets a preview: description, Open Graph tags and the card image', async ({ page, request }) => {
	await page.goto('/');
	const meta = (attr: string) => page.locator(`head meta[${attr}]`).first().getAttribute('content');

	expect(await meta('name="description"')).toContain('who recommends what');
	expect(await meta('property="og:title"')).toBe('Recommendship');
	expect(await meta('name="twitter:card"')).toBe('summary_large_image');

	const image = new URL((await meta('property="og:image"'))!);
	expect(image.protocol).toBe('https:');
	const res = await request.get(image.pathname);
	expect(res.ok()).toBeTruthy();
	expect(res.headers()['content-type']).toContain('image/png');
});
