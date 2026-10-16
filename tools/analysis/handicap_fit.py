"""Tests handicap formulas against the handicaps the league actually used (doc/Handicaps.md).

Export the history league's rounds first (dev database):

  docker exec teemate-dev-postgres-1 psql -U teemate -d teemate -AtF, -c "
    select p.display_name, s.name, w.date, w.round, coalesce(w.playoff_round,0), cr.handicap,
           cr.attendance, cr.gross
    from card_rounds cr join scorecards sc on sc.id=cr.scorecard_id join groups g on g.id=sc.group_id
    join weeks w on w.id=g.week_id join seasons s on s.id=w.season_id join leagues lg on lg.id=s.league_id
    join players p on p.id=cr.player_id
    where lg.slug='wednesday-league-history' order by p.display_name, w.date" > rounds.csv

  python3 -I tools/analysis/handicap_fit.py rounds.csv

For each regular-season round with a recorded handicap, a candidate rule is applied to the
player's earlier gross scores and compared with the handicap on the sheet.
"""
import csv
import math
import sys
from collections import defaultdict

rows = list(csv.reader(open(sys.argv[1])))
by = defaultdict(list)
for name, season, date, rnd, playoff, hcp, att, gross, *_ in rows:
    by[name].append(dict(season=season, po=int(playoff), h=int(hcp) if hcp else None,
                         att=att, g=int(gross) if gross else None))


def run(n, best, allowance, base, rounding=math.floor, cap=18):
    per = defaultdict(lambda: [0, 0, 0])  # rounds, exact, within one
    for rs in by.values():
        for i, r in enumerate(rs):
            if r['h'] is None or r['po']:
                continue
            prior = [x['g'] for x in rs[:i] if x['g'] is not None and x['att'] == 'played']
            last = prior[-n:]
            if len(last) < n:
                continue
            use = sorted(last)[:best] if best else last
            c = min(max(rounding(allowance * (sum(use) / len(use) - base) + 1e-9), 0), cap)
            for k in (r['season'], 'all'):
                p = per[k]
                p[0] += 1
                p[1] += c == r['h']
                p[2] += abs(c - r['h']) <= 1
    return per


OPTIONS = [
    ('avg of last 5, 80% over par', 5, None, 0.8, 36),
    ('avg of last 10, 80% over par', 10, None, 0.8, 36),
    ('best 5 of last 10, 80% over par', 10, 5, 0.8, 36),
    ('best 8 of last 20, 80% over par', 20, 8, 0.8, 36),
    ('best 10 of last 20, 75% over 35 (default)', 20, 10, 0.75, 35),
]
seasons = sorted({r[1] for r in rows})
print('%-44s %-16s %s' % ('rule', 'exact / ±1', ' '.join(seasons)))
for label, n, best, allowance, base in OPTIONS:
    p = run(n, best, allowance, base)
    a = p['all']
    by_season = ' '.join('%3.0f%%' % (100 * p[s][1] / p[s][0]) if p[s][0] else '  - ' for s in seasons)
    print('%-44s %3.0f%% / %3.0f%%    %s' % (label, 100 * a[1] / a[0], 100 * a[2] / a[0], by_season))
