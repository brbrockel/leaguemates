"""Reading the league's weekly .xlsx spreadsheets (standard library only).

Shared by history_fixture.py (test data) and history_export.py (the import).
"""

import datetime
import re
import zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'
MONTHS = {m: i for i, m in enumerate(
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}


def read_xlsx(path):
    """Return {sheet name: {(row, col): value}} using cached cell values."""
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    shared = []
    if 'xl/sharedStrings.xml' in names:
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        shared = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in root.findall(NS + 'si')]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheets = {}
    for sh in ET.fromstring(z.read('xl/workbook.xml')).iter(NS + 'sheet'):
        target = rels[sh.get(REL)].lstrip('/')
        target = target if target.startswith('xl/') else 'xl/' + target
        grid = {}
        for c in ET.fromstring(z.read(target)).iter(NS + 'c'):
            v = c.find(NS + 'v')
            if c.get('t') == 'inlineStr':
                val = ''.join(x.text or '' for x in c.iter(NS + 't'))
            elif v is None:
                continue
            elif c.get('t') == 's':
                val = shared[int(v.text)]
            elif c.get('t') in ('str', 'e', 'b'):
                val = v.text
            else:
                f = float(v.text)
                val = int(f) if f.is_integer() else f
            if isinstance(val, str):
                val = val.strip()
            if val in ('', None):
                continue
            m = re.match(r'([A-Z]+)(\d+)', c.get('r'))
            col = 0
            for ch in m.group(1):
                col = col * 26 + ord(ch) - 64
            grid[(int(m.group(2)), col)] = val
        sheets[sh.get('name')] = grid
    return sheets


def to_date(text, year):
    m = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})', str(text), re.I)
    return datetime.date(year, MONTHS[m.group(1)[:3].lower()], int(m.group(2))) if m else None


def serial_date(grid, year):
    """A date typed as a date, which the sheet stores as an Excel serial number (days since
    1899-12-30), in the title rows. Only a date in the season's year counts."""
    for (r, _), v in sorted(grid.items()):
        if r <= 8 and isinstance(v, int) and 40000 < v < 60000:
            d = datetime.date(1899, 12, 30) + datetime.timedelta(days=v)
            if d.year == year:
                return d
    return None


def num(v):
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str) and re.fullmatch(r'-?\d+(\.\d+)?', v):
        return float(v) if '.' in v else int(v)
    return None


def match_blocks(g):
    """Find 'Match N' blocks: label cell followed by a 'Handicap' header, players below."""
    blocks = []
    for (r, c), v in g.items():
        if isinstance(v, str) and v.startswith('Match') and str(g.get((r, c + 1), '')).startswith('Handicap'):
            players, rr = [], r + 1
            while isinstance(g.get((rr, c)), str) and not str(g.get((rr, c + 1), '')).startswith('Handicap'):
                players.append({'name': g[(rr, c)], 'handicap': num(g.get((rr, c + 1))),
                                'gross': num(g.get((rr, c + 3))) or 0})
                rr += 1
            if len(players) == 2:
                blocks.append((r, players))
    return [p for _, p in sorted(blocks, key=lambda b: b[0])]


def standings(g):
    for (r, c), v in g.items():
        if v == 'Name' and g.get((r, c + 1)) == 'W':
            rows, rr = {}, r + 1
            while isinstance(g.get((rr, c)), str):
                w, l, t, p = (num(g.get((rr, c + i))) or 0 for i in (1, 2, 3, 4))
                rows[g[(rr, c)]] = {'W': w, 'L': l, 'T': t, 'points': p}
                rr += 1
            return rows
    return None
