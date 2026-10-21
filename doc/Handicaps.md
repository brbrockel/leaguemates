# Handicaps

How LeagueMates suggests handicaps, and the evidence behind the default rule. **The rule needs the league's confirmation:** the spreadsheets hold the handicaps that were used, but not how they were worked out.

## What the app does

- Each week's scorecard uses the player's handicap at that time. Handicaps change only when an admin changes them.
- **League → Handicaps** shows each player's current handicap, the suggested one, and the scores behind it. An admin applies the suggestions, all at once or one player at a time. Every change is in the Activity log.
- The rule is set in **League settings → Handicaps**. Its default is the rule that best matches the league's history:

> **Best 10 of the player's last 20 rounds. Take 75% of their average over 35, round down, at most 18.**
> With fewer than 20 rounds, the better half of what there is counts. With fewer than 5, the handicap stays as it is.

- Rounds are 9-hole gross scores from submitted cards. A sub's round never counts, and nor does an absent player's.
- **Also count rounds from** lets the live league use the History league's rounds, matched by nickname. Then 2027 handicaps start from real 2026 scores, not from nothing. The admin must belong to both leagues.

## How the default was chosen

The History league holds 1,935 rounds from 2018 to 2026, each with the handicap used that week. For 1,217 regular-season rounds there are enough earlier scores to test a rule: take the player's earlier gross scores, apply the rule, and compare with the handicap on the sheet.

| Rule | Exact | Within 1 stroke |
|---|---|---|
| Average of last 5, 80% over par | 16% | 45% |
| Average of last 10, 80% over par | 13% | 44% |
| Best 5 of last 10, 80% over par | 46% | 88% |
| Best 8 of last 20, 80% over par | 50% | 91% |
| **Best 10 of last 20, 75% over 35** | **56%** | **97%** |

Findings:

- **The sheets use each player's best rounds, not a plain average.** Averaging all recent rounds matches only 13–16% of the time.
- Handicaps in the sheets top out at **18** and change in only about 1 week in 10, often by one stroke. This suggests someone updated them by hand from time to time, not every week, so no rule matches exactly.
- Against the current roster (with the History league's rounds counted), the default reproduces **11 of 16** handicaps exactly and **15 of 16** within one stroke. Jerry is the outlier: 7 on the sheet, 5 by the rule.

Re-run the comparison with `tools/analysis/handicap_fit.py` (instructions in the file).

## To confirm with the league

1. Is it the best rounds of recent rounds (best 10 of 20), or a plain average of the last 5 or 10?
2. What percentage (allowance), and over what score: par 36, or something else?
3. Is there a maximum (18 in the sheets)?
4. When are handicaps updated: every week, or every few weeks?
5. Do the previous season's rounds count at the start of a new season?

Each answer maps to a setting, so no code changes are needed.
