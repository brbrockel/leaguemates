# Historical Import

How to collect old league spreadsheets from Gmail for EH-012. The files go in `history/` of the private **leaguemates-data** repository (github.com/brbrockel/leaguemates-data), cloned next to this one as `~/repos/leaguemates-data`. They hold members' names, scores and contact details, so they never go in this repository.

All three options below read only the Gmail label `Golf League`. They keep spreadsheets and PDFs (`xlsx`, `xlsm`, `xls`, `csv`, `ods`, `pdf`) and save each file only once, even if it was forwarded several times. Files are named `<email date>_<short hash>_<original name>`, and `manifest.csv` records the subject and sender of the email each file came from.

## Option A: App password and IMAP (fastest)

Script: [`tools/import/gmail_attachments.py`](../tools/import/gmail_attachments.py). It runs locally and logs in to Gmail read-only.

1. Make sure IMAP is on: Gmail → Settings → **See all settings** → **Forwarding and POP/IMAP** → **Enable IMAP**.
2. Create an app password at https://myaccount.google.com/apppasswords. This needs 2-Step Verification turned on. Name it `LeagueMates import`.
3. Run the script **in your own terminal**, so the password never appears in a chat or log:

   ```bash
   python3 -I tools/import/gmail_attachments.py imap you@gmail.com ../leaguemates-data/history
   ```

   Paste the app password when prompted.
4. **Revoke the app password** at the same page when you've finished. It gives full access to your mailbox, not just the label.

## Option B: Apps Script

Script: [`tools/import/gmail-export.gs`](../tools/import/gmail-export.gs)

1. Go to https://script.google.com, click **New project** and replace the contents with the script.
2. Save the project, select `exportGolfLeagueAttachments` and click **Run**.
3. Approve the permission prompt. Google asks for Gmail and Drive access. The script only reads mail and writes to one Drive folder.
4. If the log says **Paused**, click **Run** again. Repeat until it says **Done**.
5. In Google Drive, right-click the **LeagueMates Golf League Export** folder, choose **Download**, and unzip it into `../leaguemates-data/history/`.
6. Delete the Apps Script project when you've finished.

## Option C: Google Takeout (no script or password)

Script: [`tools/import/gmail_attachments.py`](../tools/import/gmail_attachments.py)

1. Go to https://takeout.google.com and click **Deselect all**. Select **Mail**, open **All Mail data included**, and choose only the `Golf League` label.
2. Create the export. Google emails a download link, which can take from a few minutes to a few hours.
3. Unzip the export and run:

   ```bash
   python3 -I tools/import/gmail_attachments.py mbox "path/to/Golf League.mbox" ../leaguemates-data/history
   ```

   If the export contains more than one label, add `--label "Golf League"`.
4. Delete the Takeout zip once the files have been extracted.

## Afterwards

The EH-012 importer parses `../leaguemates-data/history/`. It reports, for each season:
- the players, weeks played and rainouts
- any gaps where weeks are missing
- any results that don't match the standings

That report sets the default season length.


## Merged into the live league (2026-10-15)

History now lives in **Wednesday League** itself. `api/scripts/import-history.ts` loads it there, and `--drop-old` removes the earlier separate "Wednesday League (History)" league.

- **Rosters per season:** each imported season's roster is its published standings, in finishing order.
- **Names:** the sheets' names are mapped to the league's (confirmed with the league):
  - Anthony is Tony, and Jerod is Jarrod.
  - "Dave" is Doc, except from round 6 of 2021. From then, Doc appears under his own name and a second Dave (handicap 5) took over Todd's spot: he is **Dave (stand-in for Todd)**. Todd played rounds 1–5; the stand-in played from round 6, and his line in 2021's published standings (the "Dave" row) includes Todd's record before that.
  - Joe, Rick S and Dave (stand-in for Todd) are past players.
- **Foursomes:** the sheets list Match 1–8 in order. Matches 1 and 2 played together and teed off first, 3 and 4 second, and so on. Tee times weren't recorded.

## Fixing one season (2026-10-16)

After a fix to the exporter, rebuild just that season in place. Its rounds, roster and published standings are replaced; the season itself, and anything linked to it, is kept. It refuses if photos are attached to that season's cards.

```bash
python3 -I tools/import/history_export.py ../leaguemates-data/history ../leaguemates-data/history-export.json
docker exec -i $(docker ps -qf name=teemate_teemate) node dist/scripts/import-history.js - --season 2025 < ../leaguemates-data/history-export.json
```

**2025 rounds 11–13.** Three sheets (emails of July 1, 4 and 14) have their dates typed as dates, which the sheet stores as numbers, so the exporter couldn't read them. On the July 2 sheet, Jerry's row also shows one game too many (12; everyone else has 11). Together these dropped round 12 (July 2) and left rounds 11 and 13 without scores. The exporter now reads those dates and takes the most common games count on a standings sheet. Jerry's matches in rounds 11 and 12 have no official result (his standings line can't be compared), so the app scores them from gross and handicap. Every 2025 record then matches the published final standings.

## People from the roster sheet (2026-10-16)

The league's roster sheet ("Roster of … League Players", in `leaguemates-data/history/`) has each player's full name, phone, email and address. `tools/import/roster_people.py` turns it into people records, using `leaguemates-data/people-nicknames.json` to map each full name to the player's name in the league (a name with no entry is reported and left out). `api/scripts/import-people.ts` then gives each player their full name and an account with that email, phone and address, linked to their spot and added to the league as a User.

```bash
pip install --target /tmp/pylib xlrd==2.0.1     # the sheet is the old .xls format
PYTHONPATH=/tmp/pylib python3 tools/import/roster_people.py \
  "../leaguemates-data/history/<date>_<hash>_Roster of J&J League Players 2026.xls" \
  ../leaguemates-data/people-nicknames.json ../leaguemates-data/people-2026.json
docker exec -i $(docker ps -qf name=teemate_teemate) node dist/scripts/import-people.js - --dry-run < ../leaguemates-data/people-2026.json
docker exec -i $(docker ps -qf name=teemate_teemate) node dist/scripts/import-people.js - < ../leaguemates-data/people-2026.json
```

Nothing is emailed. It only fills in blanks, keeps a player's existing account, and can be run again safely. Site admins then send each person a sign-in link from the season roster.

2026: all 16 players matched (the matches are in `people-nicknames.json`; Dickie confirmed by the league). Jerry's email is typed `…@yahoo,com` on the sheet; `people-2026.json` has it corrected to `yahoo.com`.
