#!/usr/bin/env python3
"""Export every regular season in the weekly spreadsheets for the TeeMate import.

Usage:
    python3 -I tools/import/history_export.py ../teemate-data/history ../teemate-data/history-export.json

For each season it rebuilds the regular-season rounds from the schedule and
results sheets:
- a date counts as a round only if the standings moved forward across it, so
  rained-out dates and playoff dates are dropped;
- pairings, handicaps and gross scores come from the results sheet when there
  is one, otherwise from the schedule sheet (no scores);
- the official result of each match comes from the change in W/L/T between
  the standings before and after that round (only when exactly one round lies
  between two standings sheets);
- the final standings of the season are taken as printed.

Anything that can't be rebuilt is listed in the report printed at the end and
stored with each season. Standard library only.
"""

import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sheets import match_blocks, read_xlsx, serial_date, standings, to_date  # noqa: E402

# The same player listed under two names within a season.
ALIASES = {(2026, 'Richie'): 'Richie Jr'}


def name_of(year, raw):
    return ALIASES.get((year, raw), raw)


def sheet_date(texts, year, skip_standings):
    for t in texts:
        if skip_standings and 'Standings' in t:
            continue
        d = to_date(t, year)
        if d:
            return d
    return None


def read_season_sheets(history_dir):
    """Per year: standings snapshots and dated pairings (schedule or results)."""
    years = {}
    for path in sorted(Path(history_dir).glob('*.xlsx')):
        email_date = datetime.date.fromisoformat(path.name[:10])
        year = email_date.year
        y = years.setdefault(year, {'snapshots': {}, 'schedule': {}, 'results': {}})
        seen_standings = set()  # tabs prepared in advance repeat the same standings
        for grid in read_xlsx(path).values():
            texts = [v for _, v in sorted(grid.items()) if isinstance(v, str)]
            if any(re.search(r'\bround\b|final', t, re.I) for t in texts if 'Standings' not in t):
                playoff = True
            else:
                playoff = False
            blocks = match_blocks(grid)
            st = standings(grid)
            if st:
                title = next((t for t in texts if 'Standings' in t), '')
                date = sheet_date(texts, year, skip_standings=True) or serial_date(grid, year)
                # Standings on a sheet cover every round played before the round it schedules.
                # Printed titles sometimes lag a week, and finals sheets are often undated, so
                # prefer the scheduled date, then the title, then the email date.
                as_of = date or to_date(title, year) or email_date
                # Most players have played every round; a late joiner has fewer, and a typo
                # can give one row an extra game (2025's July 2 sheet), so take the most common.
                counts = [s['W'] + s['L'] + s['T'] for s in st.values()]
                games = max(set(counts), key=lambda n: (counts.count(n), n))
                rows = [{'name': name_of(year, n), **s} for n, s in st.items()]
                fingerprint = json.dumps(rows, sort_keys=True)
                if fingerprint not in seen_standings:
                    seen_standings.add(fingerprint)
                    y['snapshots'][as_of] = {'games': games, 'rows': rows}  # later emails win
                date = date or as_of
                if blocks and date and not playoff:
                    y['schedule'][date] = blocks
            elif blocks and not playoff:
                date = sheet_date(texts, year, skip_standings=False) or serial_date(grid, year)
                # A results tab dated after its email is stale data copied from an older sheet.
                if date and date <= email_date + datetime.timedelta(days=1) and any(p['gross'] for b in blocks for p in b):
                    y['results'][date] = blocks
    return years


def side(year, p):
    """One player in a match. A decimal "score" is an average typed in for an absent
    player, not a round, so it counts as no score."""
    gross = p['gross']
    if not isinstance(gross, int) or gross <= 0:
        gross = None
    handicap = p['handicap']
    return {
        'name': name_of(year, p['name']),
        'handicap': round(handicap) if isinstance(handicap, (int, float)) else None,
        'gross': gross,
    }


def pairing_key(blocks, year):
    return frozenset(frozenset(name_of(year, p['name']) for p in b) for b in blocks)


def export_season(year, data):
    snaps = sorted(data['snapshots'].items())  # (as_of, snapshot)
    if not snaps:
        return None
    final_games = max(s['games'] for _, s in snaps)
    final = max((s for _, s in snaps if s['games'] == final_games), key=lambda s: len(s['rows']))
    roster_size = len(final['rows'])

    def before(d):
        prior = [(a, s) for a, s in snaps if a <= d]
        return prior[-1] if prior else None

    def after(d):
        later = [(a, s) for a, s in snaps if a > d]
        return later[0] if later else None

    # Candidate dates: results first (they have scores), then schedule-only dates.
    candidates = {}
    for d, blocks in data['schedule'].items():
        if len(blocks) == roster_size // 2:
            candidates[d] = ('schedule', blocks)
    for d, blocks in data['results'].items():
        if len(blocks) == roster_size // 2:
            candidates[d] = ('results', blocks)

    played, notes = [], []
    for d in sorted(candidates):
        b, a = before(d), after(d)
        games_before = b[1]['games'] if b else 0
        if games_before >= final_games:
            continue  # after the regular season: playoffs
        if a and a[1]['games'] == games_before:
            continue  # standings didn't move: rained out (the pairings were played later)
        if not a and candidates[d][0] != 'results':
            continue
        played.append(d)

    # A pairing set is played once; a rainout repeats it on a later date. Keep the
    # date with scores if there is one, otherwise the latest date.
    best = {}
    for d in played:
        key = pairing_key(candidates[d][1], year)
        has_scores = candidates[d][0] == 'results'
        if key not in best or (has_scores, d) > (candidates[best[key]][0] == 'results', best[key]):
            best[key] = d
    rounds = sorted(best.values())

    weeks = []
    for i, d in enumerate(rounds):
        source, blocks = candidates[d]
        b, a = before(d), after(d)
        games_before = b[1]['games'] if b else 0
        single = bool(a and b and a[1]['games'] == games_before + 1)
        before_rows = {r['name']: r for r in (b[1]['rows'] if b else [])}
        after_rows = {r['name']: r for r in (a[1]['rows'] if a else [])}

        def delta(n):
            x, y0 = after_rows.get(n), before_rows.get(n, {'W': 0, 'L': 0, 'T': 0})
            return tuple(x[k] - y0[k] for k in 'WLT') if x else None

        matches = []
        for block in blocks:
            pa, pb = (side(year, p) for p in block)
            if source != 'results':
                pa['gross'] = pb['gross'] = None
            recorded = None
            if single:
                recorded = {((1, 0, 0), (0, 1, 0)): 'A', ((0, 1, 0), (1, 0, 0)): 'B', ((0, 0, 1), (0, 0, 1)): 'T'}.get(
                    (delta(pa['name']), delta(pb['name']))
                )
            matches.append({'a': pa, 'b': pb, 'recorded': recorded})
        weeks.append({'round': games_before + 1 if single else None, 'date': d.isoformat(), 'source': source, 'matches': matches})

    # Rounds without a single-step standings change get numbers by date order.
    used = {w['round'] for w in weeks if w['round']}
    next_free = iter(n for n in range(1, final_games + 1) if n not in used)
    for w in sorted(weeks, key=lambda w: w['date']):
        if w['round'] is None:
            w['round'] = next(next_free, None)
    weeks = [w for w in weeks if w['round']]
    weeks.sort(key=lambda w: w['round'])

    missing = sorted(set(range(1, final_games + 1)) - {w['round'] for w in weeks})
    n_matches = sum(len(w['matches']) for w in weeks)
    report = {
        'rounds': final_games,
        'roundsFound': len(weeks),
        'roundsMissing': missing,
        'matches': n_matches,
        'matchesWithScores': sum(1 for w in weeks for m in w['matches'] if m['a']['gross'] or m['b']['gross']),
        'matchesWithOfficialResult': sum(1 for w in weeks for m in w['matches'] if m['recorded']),
        'notes': notes,
    }
    return {
        'year': year,
        'regularSeasonRounds': final_games,
        'finalStandings': final['rows'],
        'weeks': weeks,
        'report': report,
    }


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    years = read_season_sheets(sys.argv[1])
    seasons = [s for s in (export_season(y, years[y]) for y in sorted(years)) if s]
    out = Path(sys.argv[2])
    out.write_text(json.dumps({'source': 'teemate-data/history', 'seasons': seasons}, indent=1) + '\n')
    for s in seasons:
        r = s['report']
        print(
            f"{s['year']}: {r['roundsFound']}/{r['rounds']} rounds, {r['matches']} matches "
            f"({r['matchesWithScores']} with scores, {r['matchesWithOfficialResult']} with official result)"
            + (f"; missing rounds {r['roundsMissing']}" if r['roundsMissing'] else '')
        )
    print(f'Wrote {out}')


if __name__ == '__main__':
    main()
