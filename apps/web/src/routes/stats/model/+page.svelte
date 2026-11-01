<script lang="ts">
	// Hidden page (§4.5): grade the model with leave-one-out and try other k
	// values against your own data. Nothing here is saved; the app keeps using
	// the defaults in #lib/scoring.ts until they are changed in code.
	import { evaluate, type Evaluation, type ScoreInput } from '@recommendship/score';
	import { liveQuery } from '#lib/db/live.svelte.ts';
	import { loadScoreInput, SCORE_CONFIG } from '#lib/scoring.ts';

	let config = $state({ ...SCORE_CONFIG });
	let input = $state<ScoreInput | null>(null);

	// Reload the data whenever ratings change.
	const version = liveQuery<{ n: number; s: number | null }>(() => ({
		sql: `SELECT count(*) AS n, sum(rating) AS s FROM item WHERE status = 'TRIED'`
	}));
	$effect(() => {
		void version.rows[0];
		void loadScoreInput().then((x) => (input = x));
	});

	const result = $derived<Evaluation | null>(input ? evaluate(input, $state.snapshot(config)) : null);
	const lift = $derived(result && result.n ? 1 - result.rmseModel / result.rmseMuC : 0);
	const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '–');

	const KNOBS = [
		{ key: 'kC', label: 'k_c (category mean → global)' },
		{ key: 'kR', label: 'k_r (recommender offset)' },
		{ key: 'kRc', label: 'k_rc (recommender × category)' },
		{ key: 'kConf', label: 'k (confidence / weights)' },
		{ key: 'agreementBonus', label: 'agreement bonus', step: 0.05 }
	] as const;
</script>

<main class="page">
	<h1 class="section-title">Model check · leave-one-out</h1>
	{#if result}
		{#if result.n < 2}
			<p class="muted">Rate a few things first. This needs at least two rated items.</p>
		{:else}
			<p class="muted small">
				Each of your {result.n} ratings is predicted from all the others, then compared with what you actually gave it. Lower is better.
			</p>
			<table class="data">
				<thead><tr><th>Predictor</th><th class="r">RMSE</th></tr></thead>
				<tbody>
					<tr><td>Always your global mean (μ)</td><td class="r num">{fmt(result.rmseMu)}</td></tr>
					<tr><td>Always your category mean (μ_c)</td><td class="r num">{fmt(result.rmseMuC)}</td></tr>
					<tr>
						<td><b>Model</b> (μ_c + b_r + b_rc)</td>
						<td class="r num"><b class:pos={lift > 0} class:neg={lift < 0}>{fmt(result.rmseModel)}</b></td>
					</tr>
				</tbody>
			</table>
			<p class="small">
				{#if lift > 0}
					Recommender track records cut the error by <b>{Math.round(lift * 100)}%</b> versus just knowing the category.
				{:else}
					Not beating the category baseline yet. That's normal with little data; the shrinkage keeps it close to μ_c.
				{/if}
			</p>
		{/if}

		<h2 class="section-title">Try other settings</h2>
		<div class="knobs">
			{#each KNOBS as k (k.key)}
				<label>
					<span class="small">{k.label}</span>
					<input class="field num" type="number" min="0" step={'step' in k ? k.step : 0.5} bind:value={config[k.key]} />
				</label>
			{/each}
		</div>
		<button class="btn" onclick={() => (config = { ...SCORE_CONFIG })}>Reset to defaults</button>
	{/if}
</main>

<style>
	.knobs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.6rem;
		margin-bottom: 0.8rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	p {
		margin: 0.6rem 0;
	}
</style>
