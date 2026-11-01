# Sample backups

Ready-made Recommendship backups to import and play with. Each file name says what it
adds to an empty account, or that the app will refuse it.

**To try one:** download the file (open it on GitHub, then the download button), and
in the app go to **Account → Your data → Import a backup**. Importing adds to what you
already have and never overwrites it: people match by name and items by title and
type, so importing the same file twice adds nothing the second time.

**Start with the demo.** The rest are for testing how the app copes with big, odd or
broken files.

| File | Adds | What it's for |
| --- | --- | --- |
| `01-demo-friend-group-41-items-6-people.json` | 41 items, 6 people | A small friend group with real titles and clear track records. See below. |
| `02-empty-0-items.json` | nothing | A valid backup with nothing in it. The app says there's nothing new. |
| `03-tiny-1-item-1-person.json` | 1 item, 1 person | The smallest real list: Piranesi, from Sam. |
| `04-heavy-user-2000-items-250-people.json` | 2,000 items, 250 people | A very heavy user: about 3,200 recommendations, every type and status. Takes a few minutes to finish syncing. |
| `05-odd-text-18-items-10-people.json` | 18 items, 10 people | Emoji, right-to-left and Japanese text, the longest allowed title and note, quotes, commas, line breaks, and text that looks like spreadsheet formulas or HTML. |
| `06-duplicates-adds-7-items-3-people.json` | 7 items, 3 people | Lookalikes that should merge (Sam, sam and " SAM "; Severance twice; two Dunes with the same TMDB id), your own types, and links to things missing from the file. The file holds 9 items and 5 people. |
| `07-too-big-10001-items-refused.json` | nothing (refused) | One item past the 10,000 limit. The app refuses it up front and writes nothing. |
| `08-broken-bad-rating-refused.json` | nothing (refused) | A rating of 4.3 (ratings go in half stars). |
| `09-broken-newer-version-refused.json` | nothing (refused) | Made by a "newer" Recommendship. |
| `10-broken-not-a-backup-refused.json` | nothing (refused) | Some other JSON file. |

## The demo friend group

Six friends whose past picks you've already rated, so the Put List has something to go on:

- **Alice:** her movies always land (4.5–5 stars). Her next ones rank near the top.
- **Ben:** great restaurants, terrible TV. His restaurant picks rank high and his TV picks low.
- **Chris:** solid on books.
- **Dana:** middling podcasts and TV.
- **Fran:** all over the place, from 5 stars to 1.
- **Eli:** new, with nothing tried yet, so Eli's picks start at a neutral 3.5.

Things to try: open a pick to see why it got its number, rate something from the Put
List and watch that person's other picks move, or check the People page.

## Big files are hard to undo

The heavy-user file adds thousands of rows. Import it into a throwaway account, or be
ready to clear it with **Select → Select all → Delete** on the Put List and Tried pages.
Deleting your account removes everything at once.

## Making them again

The files come from [`scripts/sample-backups.mjs`](../../scripts/sample-backups.mjs):

```
node scripts/sample-backups.mjs
```

It writes the same files every run. The names are worked out from the data, and
[`sample-backups.test.ts`](../../apps/web/src/lib/sample-backups.test.ts) imports each
file and checks that it adds what its name says.
