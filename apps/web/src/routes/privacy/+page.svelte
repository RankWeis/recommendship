<svelte:head>
	<title>Privacy · Recommendship</title>
</svelte:head>

<main class="page prose">
	<h1>Privacy policy</h1>
	<p class="muted small">Last updated 1 November 2026</p>
	<p>
		Recommendship is run by Kian Samii, one person, not a company. This page says what the app stores, where, who else gets any of it,
		and how to get it back or deleted. Questions: <a href="mailto:kian.samii@gmail.com">kian.samii@gmail.com</a>.
	</p>

	<h2>What's stored</h2>
	<h3>When you sign in with Google</h3>
	<ul>
		<li>Your name, email address and Google account ID, from Google.</li>
		<li>The sign-in tokens Google issues, used only to sign you in.</li>
		<li>For each signed-in session: when it started, the network (IP) address and the browser it came from.</li>
	</ul>
	<h3>What you log</h3>
	<ul>
		<li>Items, the people who recommended them, how hyped they were, notes, ratings, reviews, your own categories, and when each was added or changed.</li>
		<li>
			People are just names you type. They aren't linked to anyone's account, and nobody but you sees them. Please don't put anything
			sensitive about other people in notes.
		</li>
	</ul>
	<h3>To keep the service running</h3>
	<ul>
		<li>How many changes your account makes each day, for the usage limits.</li>
		<li>
			Server logs of each request's address, result and timing (not what you logged). The hosting provider keeps these for a short time.
		</li>
	</ul>
	<h3>On your device</h3>
	<ul>
		<li>A copy of your data in your browser's storage, so the app works offline. Signing out removes it.</li>
		<li>One sign-in cookie, and a few app preferences (like the last category you used).</li>
	</ul>

	<h2>What isn't done with it</h2>
	<ul>
		<li>No ads, no analytics, no tracking scripts.</li>
		<li>Nothing is sold, and nothing is shared beyond the services below.</li>
	</ul>

	<h2>Services involved</h2>
	<ul>
		<li><b>Google</b>: sign-in.</li>
		<li><b>Fly.io</b>: runs the servers.</li>
		<li><b>Neon</b>: hosts the database.</li>
		<li>
			<b>TMDB</b> and <b>Open Library</b>: when you search for a title, the text you typed is sent to them from our server, not from your
			device. Posters and covers then load straight from their servers, so they see your network address when an image loads.
		</li>
	</ul>
	<p>The syncing software (PowerSync) runs on our own servers, with its usage statistics turned off.</p>

	<h2>Who can see your data</h2>
	<p>
		Only you, in the app. As the person running it, I can see each account's email, name and how much it stores (to spot abuse), and I can
		technically reach the database. I only look at what you've logged when that's needed to run the service, for example to fix a bug you
		report or to deal with abuse.
	</p>

	<h2>Getting it back, or deleting it</h2>
	<ul>
		<li><b>Download:</b> Account → Your data → Download backup (everything) or Download spreadsheet.</li>
		<li><b>Delete things:</b> any item or person can be deleted in the app, and the deletion syncs.</li>
		<li>
			<b>Delete your account:</b> email <a href="mailto:kian.samii@gmail.com">kian.samii@gmail.com</a> from the address you sign in with,
			and your account and everything in it will be deleted within 30 days. Database backups expire on their own shortly after.
		</li>
	</ul>
	<p>Accounts that are suspended for abuse may be deleted.</p>

	<h2>Children</h2>
	<p>Recommendship isn't meant for children under 13, and doesn't knowingly store data from them.</p>

	<h2>Changes</h2>
	<p>If this policy changes, the date at the top changes. Big changes will be pointed out in the app.</p>

	<p class="small muted"><a href="/about">About</a> · <a href="/terms">Terms</a></p>
</main>
