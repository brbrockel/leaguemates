#!/usr/bin/env python3
"""Turn the league's roster sheet into people records for api/scripts/import-people.ts.

Usage:
    python3 -I tools/import/roster_people.py ROSTER.xls NICKNAMES.json OUT.json

ROSTER.xls is the league's "Roster of ... League Players" sheet (NAME, PHONE #, EMAIL,
ADDRESS columns under a header row). NICKNAMES.json maps each full name on the sheet to
the player's name in the league, e.g. {"Jerry Smith": "Jerry"}; it lives with the data in
the private leaguemates-data repository, never here. Rows without a nickname are reported and
left out, so nobody is matched by guesswork.

Needs xlrd for the old .xls format: pip install --target <dir> xlrd==2.0.1 and run with
PYTHONPATH=<dir> (without -I).
"""

import json
import sys

import xlrd


def rows(path):
    sheet = xlrd.open_workbook(path).sheet_by_index(0)
    header = None
    for r in range(sheet.nrows):
        values = [str(v).strip() for v in sheet.row_values(r)]
        upper = [v.upper() for v in values]
        if header is None:
            if 'NAME' in upper:
                header = {name: upper.index(name) for name in ('NAME', 'PHONE #', 'EMAIL', 'ADDRESS') if name in upper}
            continue
        name = values[header['NAME']]
        if not name:
            continue

        def col(key):
            i = header.get(key)
            return values[i] or None if i is not None else None

        yield {'fullName': name, 'phone': col('PHONE #'), 'email': col('EMAIL'), 'address': col('ADDRESS')}


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    roster, nicknames_path, out = sys.argv[1:]
    nicknames = json.load(open(nicknames_path))
    people, unmatched = [], []
    for row in rows(roster):
        nickname = nicknames.get(row['fullName'])
        if nickname:
            people.append({'nickname': nickname, **row})
        else:
            unmatched.append(row['fullName'])
    with open(out, 'w') as f:
        json.dump(people, f, indent=1)
        f.write('\n')
    print(f'{len(people)} people written to {out}')
    for name in unmatched:
        print(f'  no nickname for {name!r}: add it to {nicknames_path} to include them')


if __name__ == '__main__':
    main()
