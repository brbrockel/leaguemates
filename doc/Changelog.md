# Changelog

What changed in each release. Versions follow [semantic versioning](https://semver.org/); the
git tag is `vX.Y.Z` and the running version shows on problem reports.

## Unreleased

- **New icon.** An L and M monogram: the L's stem is the flagpole, flying a waving swallowtail pennant, on the same green. The home-screen icon on iPhone no longer has a white border, and Android's round or squircle icon is cut from a green ground instead of white.

## 1.2.0 (2026-10-21)

- **New address: leaguemates.bhbslp.org.** The old teemate.bhbslp.org address forwards there, links already sent keep working, and an app installed from the old address moves itself over. Sign in once on the new address and add it to the home screen again.
- **TeeMate is now LeagueMates.** The new name is on every page, the home screen icon, emails, texts and notifications. The address and sign-ins stay the same.
- **Virtual scorecard** (EH-019): a button on the scorecard shows the round drawn as a paper card, with the course's yardage, par and handicap rows, birdies and eagles circled, bogeys boxed. **Share image** sends it from a phone (Messages, email, …); elsewhere **Save image** downloads it.
- **Course cards:** a site admin marks where the scores go on a picture of the club's card (a few taps per nine, with a preview); the virtual scorecard then writes the round on the real card in pen, with a switch to the drawn card.
- **Fold-over cards:** a nine printed on a flap with no name column (Timberlin's back nine) takes the name column from another nine's card, shown beside it as when the card is folded.
- **Download image** beside **Share image**, so a phone can save the card as well as send it.
- The card's legend explains the eagle's double circle when the card has one.
- **Fix: unsaved scores were lost when the app reloaded.** TeeMate updated itself by reloading the page, and phones also reload apps left in the background, wiping scores typed but not saved. Unsaved scores are now kept on the device and brought back (with **Discard** to drop them); leaving the page with unsaved scores asks first; and an update no longer reloads the app: **A new version of TeeMate is ready → Reload** lets you choose when.
- **Fix: correcting a submitted card on a phone.** The reason box and any save error sat below the card, hidden under the Save bar, so Save seemed to do nothing. Both are now in the bar, and Save waits until a reason is given.
- **Errors go to the problem:** Submit with an empty hole (or a missing handicap or reason) says what's missing in the Save bar, scrolls to it and puts the cursor there, outlining every empty hole; nothing is sent until it's fixed. A refusal from the server does the same where the form can tell what it's about.
- **Frame the season photo:** on a season's banner, admins tap **Adjust**, zoom and drag so the people fill a wide banner. The photo itself isn't changed; **Show the whole photo** undoes it, and choosing a different photo starts unframed.
- **People:** each league's nickname on a person's card opens their player page (stats, trend, head-to-head).

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
