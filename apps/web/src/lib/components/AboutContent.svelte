<script lang="ts">
	// What Recommendship is: shown in the ? panel from the header and on /about (which
	// Google's sign-in screen and shared links point at). In the panel, links close it.
	let { onclose }: { onclose?: () => void } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions (only closes the panel when a link inside is followed) -->
<div class="prose" onclick={(e) => onclose && (e.target as HTMLElement).closest('a') && onclose()}>
	<h1 class="about-title">Remember who told you what, and whose picks you actually like</h1>
	<p class="lead">
		Friends, coworkers and podcasts tell you to watch, read, eat and play things all the time. Recommendship keeps track of who said it, and
		once you've tried a few, it learns whose suggestions land for you.
	</p>

	<h2>How it works</h2>
	<ol>
		<li><b>Log it.</b> “Jo says watch Severance.” Tap ＋, type the title and who said it. Movies, shows and books are matched as you type.</li>
		<li><b>It goes on the Put List,</b> the things you mean to get to.</li>
		<li><b>Try it, then rate it,</b> half a star at a time.</li>
		<li>
			<b>See how much you'll like the rest.</b> Each person gets a score from how your ratings of their picks compare with your usual ones.
			With only a few ratings their score stays near neutral, so one lucky pick doesn't make someone a guru. The dots next to a prediction
			show how sure it is.
		</li>
	</ol>

	<h2>Your data stays yours</h2>
	<ul>
		<li>Everything lives on your device first, so the app works with no signal.</li>
		<li>Sign in with Google to back it up and see it on your phone and computer.</li>
		<li>No ads, no tracking. You can download all of it, or the spreadsheet version, from the Account page any time.</li>
	</ul>
	<p>The details are in the <a href="/privacy">privacy policy</a>.</p>

	<h2>Getting it on your phone</h2>
	<p>It's a web app, so there's nothing to download from a store:</p>
	<ul>
		<li><b>iPhone:</b> open recommendship.app in Safari, tap Share, then Add to Home Screen.</li>
		<li><b>Android:</b> open it in Chrome, tap the ⋮ menu, then Install app or Add to Home screen.</li>
	</ul>

	<h2>Good to know</h2>
	<ul>
		<li>It's free. Each account can hold up to 10,000 items, 10,000 people and 10,000 recommendations.</li>
		<li>Sign-ups open a few at a time. If yours is waiting, you can use the app on your device meanwhile.</li>
		<li>Movie and TV details and posters come from TMDB, books from Open Library.</li>
		<li>The code is open: <a href="https://github.com/RankWeis/recommendship" target="_blank" rel="noopener">github.com/RankWeis/recommendship</a>.</li>
	</ul>

	{#if onclose}
		<p class="cta"><button class="btn primary" onclick={onclose}>Got it</button></p>
	{:else}
		<p class="cta"><a class="btn primary" href="/">Open the Put List</a></p>
	{/if}

	<p class="small muted">
		Made by Kian Samii · <a href="mailto:kian.samii@gmail.com">kian.samii@gmail.com</a> · <a href="/privacy">Privacy</a> ·
		<a href="/terms">Terms</a>
	</p>
</div>

<style>
	.about-title {
		margin-top: 0.25rem;
	}

	.lead {
		font-size: 1.1rem;
	}

	.cta {
		margin: 2rem 0;
	}
</style>
