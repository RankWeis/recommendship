/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// Makes the app shell load with no signal: the built JS/CSS/WASM and static
// files are precached per version, and any navigation falls back to the SPA
// shell. The data itself already lives on the device (OPFS), so nothing else
// needs caching.

import { assets, immutable } from '$app/manifest';
import { version } from '$app/env';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `recommendship-${version}`;
const SHELL = '/';
const PRECACHE = [SHELL, ...immutable.map((f) => f.path), ...assets.map((f) => f.path)];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== sw.location.origin) return;

	if (request.mode === 'navigate') {
		// Network first so a new deploy shows up, falling back to the cached shell offline.
		event.respondWith(fetch(request).catch(async () => (await caches.match(SHELL)) ?? Response.error()));
		return;
	}

	event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request)));
});
