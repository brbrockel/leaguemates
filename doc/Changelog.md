# Changelog

What changed in each release. Versions follow [semantic versioning](https://semver.org/); the
git tag is `vX.Y.Z` and the running version shows on problem reports.

## Unreleased

- **Virtual scorecard** (EH-019): a button on the scorecard shows the round drawn as a paper card, with the course's yardage, par and handicap rows, birdies circled, bogeys boxed and stroke dots. **Share image** sends it from a phone (Messages, email, …); elsewhere **Save image** downloads it.

## 1.1.0 (2026-10-18)

- **Notices panel:** opening it no longer marks everything read; ✓ marks one, **Mark all read** marks them all.
- **Notice emails:** rainouts and skipped rounds are emailed to the league; each person can turn notice emails off on Account.
- **Push notifications** (EH-013 done): turned on per phone or computer on Account. Rainouts and skips, admin notices, your foursome's news (who can't make it, a card to check) and TeeMate's notices. Never for your own actions.

## 1.0.0 (2026-10-17)

The first release. TeeMate replaces the league spreadsheet, and the homelab deployment at
https://teemate.bhbslp.org is now production.

- **Accounts and leagues:** passwords with admin-sent sign-in links, lockouts and optional
  authenticator codes; several leagues with Admin and User roles, private or public; a
  read-only guest view of public leagues.
- **Courses and seasons:** courses and layouts with versioned par and stroke index; the season
  schedule generator with swaps, locks, rainouts (slide or skip) and "This week" on Home.
- **Scoring:** hole-by-hole scorecards with absences and subs, live match results,
  submit/dispute/approve and audited corrections; scorecard photo scan (always reviewed before
  saving); match photos.
- **Results:** standings, player history, calculated handicaps (rule awaiting the league's
  confirmation), playoffs with card tie-breaks, the post-season team scramble, and stats
  (averages, head-to-head, how each hole plays, each player's trend).
- **History:** every season from 2018 to 2026 imported into Wednesday League.
- **People:** player profiles with phone, address and nickname, with call, text and map links
  for league members.
- **Notices:** to the league, a foursome or one person, plus automatic ones for cards,
  rainouts and playoffs; shown as a stack of banners on every page with a horn for the full
  list; site-wide notices from site admins; group texts sent from an admin's own phone.
- **Running it:** league and site activity logs, "Report a problem" filed as GitHub issues,
  nightly database and photo backups, and email kept off unless the owner switches it on.
- **Version:** shown at the bottom of the profile menu and on `/api/health`.

Not in 1.0.0: push notifications (EH-013), one net score for everyone (EH-018).
