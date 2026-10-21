# Test Plan

A hands-on checklist for reviewing LeagueMates on a **phone** and on a **desktop browser** before the league uses it. Work through each section on both. Tick items off, and write down anything that fails or feels wrong, with the device, the screen and what you expected.

Site: https://teemate.bhbslp.org

## 0. Setup

- [ ] **Turn testing mode on:** sign in as yourself (site admin), then profile menu → **Site settings** → **Generate a code**. Under "New test accounts join", choose **Wednesday League**, then **Turn testing mode on**. Note the code.
- [ ] **Three browsers** let you be three people at once:
  - your normal browser: **you** (site admin, and Admin of the league)
  - a private window: **test.admin@example.com** (league Admin)
  - another device or browser: **test.user@example.com** (User)
- [ ] **Phone:** add LeagueMates to the home screen. In Safari: Share → Add to Home Screen. Open it from the icon, and check it opens full screen with the LeagueMates icon.

## 1. Sign-in

- [ ] **People → ⋯ → Get password link** for test.user: copy it and open it in a private window. It shows the email; set a password (try a short one and "qwertyuiop1" first: both refused). You're signed in.
- [ ] Open the same link again: "already used".
- [ ] Sign out, then sign in with email + password.
- [ ] Wrong password 5 times: "Try again in 15 minutes". As Admin, People shows **Locked**; **Unlock account**, then sign in works. Activity shows the lockout.
- [ ] **Account → Security:** change your password; your other browser is signed out.
- [ ] **Set up authenticator:** scan the QR code, enter the code, save the recovery codes. Sign out and in: it asks for a code. A recovery code works once.
- [ ] As site admin, **Reset authenticator** for that person.
- [ ] Testing mode (while it's on) still offers instant sign-in below the password form.

## 2. Navigation and look

- [ ] **Phone:** bottom tabs are Home, Schedule, Standings, League, People (admins only). The profile icon is top right.
- [ ] **Desktop:** the same items are across the top.
- [ ] The league switcher (top) shows full names, and switching leagues changes every screen.
- [ ] **Account:** Device / Light / Dark theme works and is remembered.
- [ ] Nothing is cut off or needs sideways scrolling at phone width.

## 3. People, members and players (Admin)

- [ ] **People → Add (site admin):** add someone with **League: Not in a league yet**. They can get a password link and sign in; Home says they're not in a league.
- [ ] **League → Members → Add member:** pick that person, role User, **Plays in this league** ticked with **New player**. They appear under Players, linked.
- [ ] Add another existing person with **Plays** unticked: a member who can sign in but isn't on rosters.
- [ ] Add someone linked to an existing player (e.g. a past player who's back).
- [ ] As a league admin (not site admin): People has no Add button, and adding a brand-new email from a league is refused with "A site admin adds new people".
- [ ] **League → Players:** add a player, edit names and handicap, untick **Still playing** (moves to Past players). A duplicate nickname is refused.
- [ ] **People:** edit details (phone, address), make Admin and back, sign out everywhere.
- [ ] **League settings → Who can see this league → Public**, save. Someone not in the league sees it in the switcher marked **Public**, can view schedules and standings, sees member names without contact details, and can't enter cards or post. Switch back to **Private**: it disappears for them.
- [ ] **Account → Your details:** save phone and address; they appear with call, text and map links on League → Members.

## 4. League settings (Admin)

- [ ] Change points, the handicap window, the first tee time and the interval, then save. Reload: the values stick.
- [ ] Invalid values (e.g. tee time 25:00) are refused.
- [ ] **Playoffs:** switch the tie-break between "Last 6/3/1" and "Par 5s first".

- [ ] **How scoring works** (League → Settings or Rules) explains gross, strokes, match net, points, absences, standings ties, playoffs and past seasons, with the league's own points.

## 5. Season setup (Admin)

- [ ] **League → Seasons → New season:** name "Test", first round next Wednesday. It starts with last season's roster (current players only).
- [ ] **Season → Roster:** add and remove players, move spots up or down, and set handicaps (an amber box means a handicap is missing). **Save roster**.
- [ ] **Generate schedule:** the report shows 120/120 pairings, foursomes mixed ≤3×, and tee order rotating.
- [ ] **Regenerate:** a different mix.
- [ ] **Swap** two players in a round: the report updates.
- [ ] **Lock schedule.** The roster is now fixed, and collapses under "Show spots and handicaps".
- [ ] **Home** (as a player with a roster spot) shows the green "This week" card: tee time, opponent, nine, group.
- [ ] **Schedule tab:** each foursome shows its tee order ("1st off · about 5:00 PM"), and names link to player pages. "My matches" filter, your matches highlighted, "Next" badge.
- [ ] **Rainout menu:** **Move back a week** shifts that round and every later one by 7 days. **Skip this round** marks it Skipped.

## 6. Scorecards (the weekly loop)

- [ ] As a player in a foursome: open the card from Home (**Open scorecard**) or from Schedule.
- [ ] Enter hole scores on the phone. The number keypad appears, totals update, and match results show live with "X gets N".
- [ ] Switch the nine (Front/Back) if the starter changed it.
- [ ] **Virtual scorecard:** the button next to the nines shows the round as a paper card: course name, tee yardages, par and handicap rows, birdies circled and eagles double-circled, bogeys boxed (doubled for double bogey or worse), no stroke dots, totals, handicaps, nets and the match results. It stays paper-colored in dark mode, scrolls sideways for 18 holes, and says when it includes unsaved changes. **Share image** on a phone opens the share sheet with a picture of the whole card (check iPhone and Android); on a computer **Save image** downloads it.
- [ ] **Course card (site admin):** on **Courses →** Timberlin, a nine's **Set up the course card**: pick the picture with that nine, tap the boxes as asked (zoom in for accuracy; **Undo** and **Skip** work), check the sample scores sit in the boxes, **Save**. On a card for that nine, **Virtual scorecard** opens on **Course card**: names and scores written in the boxes, totals in Out/In, cropped to the score area; **Drawn card** switches back, and **Share image** shares whichever is showing; **Download image** (beside it) saves it.
- [ ] **Fold-over (Timberlin back nine):** after the front nine is set up with its name column, set up the back nine on the back picture and, at the name step, choose **Names are on the Front 9 card**. The preview and a back-nine card show the front's name column beside holes 10–18 with the lines level.
- [ ] Mark a player **Absent** and add a sub's name. The match uses the absence rule ("must beat …").
- [ ] **Save**, close the app, reopen: the scores are still there.
- [ ] Type scores **without saving**, then close the app (or swipe it away) and reopen the card: "Your unsaved changes were brought back", with the scores in place. **Save** stores them; **Discard** shows the card as saved. Leaving the page in a browser with unsaved scores asks first.
- [ ] **Updates:** after a new version is deployed, an open LeagueMates shows "A new version of LeagueMates is ready" with **Reload**; it never reloads by itself.
- [ ] **Submit** with a hole missing: the Save bar says which ("Brian has no score on hole 6"), the page scrolls to it with the cursor in it, and empty holes are outlined in amber. With every hole filled, it's submitted.
- [ ] **As another player in that foursome:** the card is read-only. **Dispute** it with a note.
- [ ] **As Admin:** the disputed card shows the note. Correct a score (a reason is required), then **Approve as final**.
- [ ] **As a player outside the foursome:** can view the card but not enter it.
- [ ] **Two people editing the same card:** the second save gets "someone else saved this card".
- [ ] **Scan cards (round):** on the Schedule, each round with cards still to enter has one **Scan cards** button. Take or choose one or several card photos: each is matched to its foursome by the names on it. One card opens that scorecard filled in; several show a list to check and save each. A card that can't be matched is saved to the season's Scorecards and says so.
- [ ] **Scan the foursome’s card:** the same from inside one scorecard, or from Home's This week. The scores fill in, with doubtful ones outlined in amber. Check them, Save, then Submit. The photo appears under the season's **Scorecards**.
- [ ] **Names that don't match** (a nickname, a sub, someone from another group): use **Match the names on the card** to pick the player, **Sub for …** (marks them absent with the sub's name), or **Ignore this row**. Matching two rows to one player shows a warning.
- [ ] **Texting (on a phone):** as a site admin, the roster's message button next to a player makes a sign-in link, then **Send text** opens Messages with it filled in. As an admin, **Text everyone** on the roster and the message button on an announcement open a group text. Check on both an iPhone and an Android phone that every recipient and the message appear.
- [ ] **Rearrange (game day):** as a player in the round (or an admin), **Rearrange** on an unplayed round of a locked season: move a foursome earlier or later (the tee times stay in place), and tap a match then a match in another foursome to swap them. A foursome with a card started can't be regrouped. A member not playing that round doesn't see the button.
- [ ] **Can't make it:** on Home, **Can't make it** (optionally a sub's name) marks you out of your next round: the schedule shows "out · sub …", your foursome gets a notice, and the card starts with you absent. **I can play after all** undoes it, until the card is started. As Admin, **Rearrange → Who's out** marks anyone out or back in.
- [ ] **Scan a regrouped card:** a card with two matches from different foursomes says so after **Scan cards**; **Put them together** regroups them and opens that card filled in.
- [ ] **Practice a card scan (Account, anyone):** scan any card photo or screenshot. The reader's rows show with each name matched to a league player; change a match, choose **Leave out** for rows that aren't players, and fix misread scores (doubtful ones are amber, changed ones bold). Totals update (with each player's handicap), and two rows on one player are flagged. Nothing is saved, and it allows 10 a day.

## 7. Standings

- [ ] After submitting cards, **Standings** shows W/L/T and points, with "includes cards still open for disputes".
- [ ] Ties in points are ordered by wins, then head-to-head, then the lower total net over the rounds the tied players all played (this order also sets playoff seeds).
- [ ] Schedule shows net scores and the winner for each submitted match.

## 8. Playoffs (Admin)

Quicker with a small test season: in **League settings**, set regular-season weeks to 1 *before* creating it, with 8 players on the roster.

- [ ] Before the regular season is done: "Starts when the regular season is done".
- [ ] **Start playoffs:** round 1 is seeded 1v8, 2v7, … from the standings.
- [ ] Enter playoff cards:
  - [ ] a net tie, which should be won "on the cards"
  - [ ] an absent player, who loses
  - [ ] both absent, which should offer **Decide**
- [ ] **Next round** / **Start the Finals** appears once every match is decided.
- [ ] Finals card → **Champion** shows on the season page.
- [ ] Regular-season standings don't change because of playoffs.

## 9. Team scramble (Admin)

- [ ] **Season page → Team scramble → Set up the scramble:** pick a date and nine, untick someone who isn't playing, then **Make teams**.
- [ ] Teams are close in team handicap. **Swap players:** tap one player, then one on another team. **Rebalance** gives a new mix.
- [ ] **As a player on a team:** open your team and enter 9 scores. Gross and net update. You can't enter another team's card.
- [ ] Once a score is in, swapping and rebalancing are refused.
- [ ] With every card in, the winner gets the trophy, and equal nets show "on the cards".
- [ ] Standings and handicaps don't change.

## 10. Notices

- [ ] **Banners:** on every page, new notices show as one-line banners under the top bar, most urgent first: LeagueMates', then a rainout or skip, then ones for you or your foursome, then the league's. With more than one they sit in a stack (the top one with "+N", the edges of the rest below); tap the stack to fan them out, **Show less** to fold them back. Tap one for the full text (that marks it read); **✕** clears it for good and brings up the next.
- [ ] **How long:** an admin's league notice is a banner for a week (or what they chose under **Show as a banner**), one for a foursome or one person two days, "Until each person clears it" until you ✕ it. If an admin edits it, it comes back. Card and playoff notices never show as banners.
- [ ] **Rainout or skip:** a banner through the round's day. On the day itself it has no ✕.
- [ ] **The horn (📣) in the top bar:** the count is new notices not already showing as banners. Tap it: the league's notices, then LeagueMates'. Opening it leaves them unread: **✓** marks one read, **Mark all read** marks them all, and the count drops to match.
- [ ] **As Site admin, horn → Notice for everyone:** it shows to everyone, guests too, on every page. **Everyone must see it** removes the ✕ until it ends (it needs an end).
- [ ] **As Admin, horn → New notice:** post to **The whole league**, **One foursome** (pick the round and foursome) and **One person**. Each shows only for the people it's for (and admins); others don't see it.
- [ ] **Also email it:** recipients get it by email (the mail guard in Site settings → Email still decides). **Also text it** opens a group text on your phone.
- [ ] **Rainout or skip emails:** in the Demo league, rain out or skip a round: everyone in the league who wants notice emails gets one (with email limited to your own address, only you do). Other automatic notices (cards, absences, playoffs) are never emailed.
- [ ] **Push, on your phone:** on iPhone, Share → Add to Home Screen first and open LeagueMates from there. Account → **Notifications on this device** → tick it and allow. Rain out a Demo round: a notification arrives; tapping it opens the season. Post a Demo notice from another device: it arrives. Your own actions never notify you.
- [ ] **Push off:** untick it: nothing more arrives on that device. Card approvals and playoff updates never push.
- [ ] **Account → Email → Email me notices:** untick it, rain out another Demo round: no email comes. Sign-in and password emails still do.
- [ ] The message button on an existing notice opens a text to the people it's for.
- [ ] **Shortcuts (Admin):** on the Schedule, the small message button on a foursome opens a new notice for that foursome (the dialog says who it's for). On People, **⋯ → Send a notice** does the same for one person.
- [ ] **Automatic notices:** submit a card (the foursome gets "Round N card submitted"), dispute it, correct it as Admin with a reason, rain out or skip a round, start or advance the playoffs. Each shows as from LeagueMates, for the right people.

## 11. Photos

- [ ] **On a phone, open a scorecard → Match photos → Add photos:** pick two from the camera roll. Thumbnails appear.
- [ ] Tap one: full screen, swipe or arrow through, close.
- [ ] **League → Photos** shows every photo with a link back to its match card.
- [ ] Another member can view but not delete your photo. You (or an Admin) can delete it.
- [ ] Signed out, a copied photo link doesn't load.

- [ ] **Frame the season photo (Admin):** on a season with a chosen photo, **Adjust** on the banner: zoom with the slider and drag (or arrow keys) until the people fill the frame, **Save**. The banner shows just that part, on a phone too. **Show the whole photo** puts it back. Members don't see Adjust.

## 12. Courses (site admin)

- [ ] **League → Courses → Timberlin:** front and back nines show par, index and yards. As test.user it's view-only.
- [ ] **Edit** a nine and enter the White yardages: the total appears beside the par.
- [ ] Change a stroke index to one already used: the box turns red and Save is disabled.
- [ ] On a nine that has scorecards (lock icon), change a par: the button becomes **Save as new version**. After saving, the old one is under **Earlier versions**, and its old cards still show their results.
- [ ] **Site settings → Courses → New course:** add one, add a nine, delete it.

## 13. Handicaps

- [ ] **League → Handicaps:** the rule is described at the top. Each player shows Now and Suggested. Tap a row to see the rounds used, with the averaged ones in bold.
- [ ] Suggestions use every round since 2018 (most within a stroke of today's handicaps).
- [ ] **As Admin:** **Set X to N** for one player, then **Apply N changes**. The roster shows the new handicaps, and Activity shows "applied handicaps".
- [ ] **As test.user:** the page is visible, with no apply buttons.
- [ ] Change the rule (e.g. allowance 80%): the suggestions change and no handicap changes.

## 14. Players and stats

- [ ] Tap a name on **League → Roster** or **Standings**: the player page shows record, rounds, average and best round.
- [ ] **By season** lists each season with points and finish. **Matches** filters by season, and each row opens its scorecard.
- [ ] **Head-to-head:** tap an opponent to open their page.
- [ ] **Standings → Scoring:** rounds, average, best and net average for the season.

- [ ] **League → Stats:** each nine shows hole by hole: average, over par (with a bar), rank (1 = hardest), and the birdie/par/bogey/double mix on wider screens. The season filter changes the numbers.
- [ ] **A player's page:** the Trend chart shows each round and the average of the last five; switch Gross/Net; tap a point for its date and score; **Show as a table** lists them. Below it, **Hole by hole** compares their average with the field's.

## 15. History and the 2027 demo

- [ ] **Wednesday League → Standings:** pick each season 2018–2026. "Final standings as published", with a place number on every row.
- [ ] **Schedule** for a past season: each round shows four foursomes in tee order (Matches 1+2 first off, 3+4 second, and so on), with gross, net and a check on each winner.
- [ ] **League → Players:** Joe, Rick S and Dave (stand-in for Todd) are under Past players. Doc's page runs 2018–2026, and so do Tony's (Anthony on the old sheets) and Jarrod's (Jerod in 2018).
- [ ] **Wednesday League (Demo 2027)** (league switcher): a made-up 2027 season with 8 rounds played, to preview mid-season. Delete it when done (Season page → Delete season). The league (now **Demo**, public) also has four finished made-up seasons, 2023–2026, with playoffs, from `demo-history`.

## 16. Activity (audit log)

- [ ] **Profile menu → Activity log** (site admin): everything, including your own sign-in.
- [ ] **League → Activity**, **Season → Season activity**, **Scorecard → Card history**, and **People → ⋯ → Activity**: each shows only its part, newest first. Filter by type, and load more.
- [ ] Save a card twice, then correct it as admin with a reason: Card history shows both saves and the correction, with the reason.
- [ ] Nothing on these pages can be edited or deleted.

## 17. Clean-up and safety

- [ ] **Delete** the "Test" season (Season page → Delete season → type the name).
- [ ] **Site settings:** turn testing mode **off** when finished. Check that the sign-in page then says to ask an admin for a link.
- [ ] Nobody received any email at any point.

## Reporting problems

For each issue, note:
- the device (phone/desktop, browser)
- who you were signed in as
- the screen
- what you did, what you expected and what happened

A screenshot helps.
