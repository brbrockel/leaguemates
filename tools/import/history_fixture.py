#!/usr/bin/env python3
"""Build a test fixture of real league results from the weekly spreadsheets.

Usage:
    python3 -I tools/import/history_fixture.py ../leaguemates-data/history packages/shared/test/fixtures/history.json

For each regular season from 2021 on (the years with weekly results sheets), it
writes every week whose results line up with the next standings snapshot, plus
the final standings. The recorded outcome of each match comes from the change
in W/L/T between consecutive standings, not from the scores, so tests can check
the scoring rules against what the league actually recorded.

Sheets carry no record of absences, so the fixture can't say who was absent.
Names are replaced with "Player 01", "Player 02"... (the same person keeps the same
label in every season), so the fixture can sit in the public repository.
Standard library only (includes a minimal .xlsx reader).
"""

import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sheets import match_blocks, read_xlsx, standings, to_date  # noqa: E402

FIRST_SEASON = 2021
REGULAR_SEASON_GAMES = 15

def load(history_dir):
    snapshots, results = {}, {}
    for path in sorted(Path(history_dir).glob('*.xlsx')):
        email_date = datetime.date.fromisoformat(path.name[:10])
        year = email_date.year
        if year < FIRST_SEASON:
            continue
        for grid in read_xlsx(path).values():
            texts = [v for _, v in sorted(grid.items()) if isinstance(v, str)]
            st = standings(grid)
            if st:
                games = max(s['W'] + s['L'] + s['T'] for s in st.values())
                snapshots[(year, games)] = st  # files are sorted by email date; the latest wins
                continue
            blocks = match_blocks(grid)
            if any(re.search(r'round|final', t, re.I) for t in texts):
                continue  # playoff results
            date = next((d for t in texts if (d := to_date(t, year))), None)
            # A sheet dated after its email is stale data carried over from a previous season.
            if len(blocks) == 8 and date and date <= email_date + datetime.timedelta(days=1):
                if any(p['gross'] for b in blocks for p in b):
                    results[(year, date)] = blocks
    return snapshots, results


def build(history_dir):
    snapshots, results = load(history_dir)
    seasons, dropped = [], []
    for year in sorted({y for y, _ in snapshots}):
        final = snapshots.get((year, REGULAR_SEASON_GAMES))
        dates = sorted(d for y, d in results if y == year)
        weeks = []
        for game, date in enumerate(dates[:REGULAR_SEASON_GAMES], start=1):
            before, after = snapshots.get((year, game - 1)), snapshots.get((year, game))
            if not before or not after:
                dropped.append(f'{date}: no standings snapshot around game {game}')
                continue
            matches, ok = [], True
            for a, b in results[(year, date)]:
                if a['name'] not in after or b['name'] not in after:
                    ok = False
                    break
                da = tuple(after[a['name']][k] - before.get(a['name'], {'W': 0, 'L': 0, 'T': 0})[k] for k in 'WLT')
                db = tuple(after[b['name']][k] - before.get(b['name'], {'W': 0, 'L': 0, 'T': 0})[k] for k in 'WLT')
                outcome = {((1, 0, 0), (0, 1, 0)): 'A', ((0, 1, 0), (1, 0, 0)): 'B',
                           ((0, 0, 1), (0, 0, 1)): 'T'}.get((da, db))
                if outcome is None:
                    ok = False
                    break
                matches.append({'a': a, 'b': b, 'recorded': outcome})
            if ok:
                weeks.append({'date': date.isoformat(), 'game': game, 'matches': matches})
            else:
                dropped.append(f'{date}: results do not line up with standings')
        if final and weeks:
            seasons.append({
                'year': year,
                'finalStandings': [{'name': n, **s} for n, s in final.items()],
                'weeks': weeks,
            })
    return seasons, dropped


def anonymize(seasons):
    names = sorted({r['name'] for s in seasons for r in s['finalStandings']}
                   | {p['name'] for s in seasons for w in s['weeks'] for m in w['matches'] for p in (m['a'], m['b'])})
    label = {n: f'Player {i:02d}' for i, n in enumerate(names, 1)}
    for s in seasons:
        for r in s['finalStandings']:
            r['name'] = label[r['name']]
        for w in s['weeks']:
            for m in w['matches']:
                for p in (m['a'], m['b']):
                    p['name'] = label[p['name']]


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    seasons, dropped = build(sys.argv[1])
    anonymize(seasons)
    out = Path(sys.argv[2])
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'source': 'leaguemates-data/history (names anonymized)', 'seasons': seasons}, indent=1) + '\n')
    for s in seasons:
        n = sum(len(w['matches']) for w in s['weeks'])
        print(f"{s['year']}: {len(s['weeks'])} weeks, {n} matches")
    for d in dropped:
        print('  skipped', d)
    print(f'Wrote {out}')


if __name__ == '__main__':
    main()
