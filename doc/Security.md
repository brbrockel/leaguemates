# Sign-in and account security

LeagueMates signs people in itself, with an email address and password. Nothing depends on Google or any other outside service, and no email is needed.

## Passwords

- Stored only as **Argon2id** hashes (19 MiB, 2 passes: OWASP's recommended minimum). The password itself is never stored or logged.
- **Rules (NIST SP 800-63B):** at least 10 characters (up to 128), and no forced symbols or scheduled changes. Refused: about 2,300 common or breached passwords of 10+ characters, the person's own email address, and one character repeated.
- Changing your password signs you out on your other devices.

## Invites and resets

There's no email, so admins hand out links:

1. An admin adds the person on **People**.
2. **⋯ → Get password link** gives a single-use link, valid for 72 hours. It's stored only as a hash.
3. The admin sends it by text or however they usually reach the person.
4. The person opens it, sees which email it's for, and sets a password. They're signed in, and the link is used up. If the account has authenticator codes on, they also enter a code before they're signed in, so a link alone can't get past the authenticator.

Site admins can instead email the link from a season's roster (the mail button next to anyone with an account), or text it from their own phone (the message button: it opens Messages with the link filled in; LeagueMates itself sends no texts). The mail guard still applies: until mail is fully on, it only goes to addresses on the allowlist, and the button says when an email was held back.

A league admin can get links for, edit, unlock and sign out only people whose every league is one they run. Adding someone to your league doesn't give you their account: for a person who is also in another league, or who is an admin anywhere, ask a site admin.

A forgotten password works the same way: an admin gets a **password reset link**. Opening a link doesn't use it up, so a phone previewing the link can't spoil it; saving the password does.

The first site admin on a new server, or anyone if every admin is locked out:

```bash
docker exec $(docker ps -qf name=leaguemates_leaguemates) node dist/scripts/sign-in-link.js you@example.com
```

## Guessing and lockouts

- **Per account:** after 5 wrong passwords (or authenticator codes), the account cools down for 15 minutes. Each lockout in a row doubles it (30 minutes, an hour, and so on up to 24 hours). A successful sign-in resets the count.
  - Lockouts are temporary on purpose: a permanent lock would let anyone lock a player out by typing wrong passwords.
- **Per network address:** 30 password attempts every 15 minutes across all accounts. The real visitor address comes from Cloudflare.
- **What admins see:** every lockout is in **Activity**. Admins see "Locked until…" on **People** and can **Unlock account**.
- **Messages:** "Email or password is incorrect" either way, so the sign-in form can't be used to find out who is a member.

## Authenticator codes (optional)

- **Setup:** **Account → Security → Set up authenticator** works with Google Authenticator, Microsoft Authenticator, 1Password and similar apps. It uses 6-digit codes that change every 30 seconds (RFC 6238), and each code works once.
- **Recommended for admins:** an admin account controls the league.
- **Storage:** the app's key is encrypted with AES-256-GCM using the server's `APP_SECRET`, a Docker secret in production.
- **Recovery codes:** 8 one-time codes are shown once when the app is set up. Each can stand in for a code if the phone is lost.
- **Turning it off:** you need your password. A site admin can also **Reset authenticator** for someone who lost their phone, which signs them out everywhere.

## Sessions

- **Cookies:** random 256-bit session tokens, stored only as hashes, in a secure, HTTP-only, SameSite=Lax cookie. They last 30 days.
- **Every change** needs the session's CSRF token.
- **Signing out:** admins can sign someone out everywhere, and changing a password does it automatically.

## Audit log

Every change is recorded: who did it, when, what it was before and after, and a reason where one is required, such as an admin correcting a submitted card. Sign-ins and sign-outs, lockouts, password links and authenticator changes are all included.

- **Permanent:** nobody can change or delete an entry through the app. The database also refuses any `UPDATE` or `DELETE` on `audit_log`, through the `audit_log_no_update_delete` trigger. Entries outlive deleted leagues and accounts.
- **Who sees what:**
  - **Site admins** see everything: profile menu → **Activity log**.
  - **League admins** see:
    - Their league: League → **Activity**.
    - A season: Season page → **Season activity**.
    - One scorecard: scorecard → **Card history**.
    - A person in their league: People → ⋯ → **Activity**, which includes that person's sign-ins.

## Scorecard photos

**Scan paper card** sends the photo of a filled-in card to Anthropic's API (Claude) to read the scores; the owner agreed to this. Anthropic doesn't train models on API data. The key is the Docker secret `leaguemates_anthropic_api_key`. Without a key, or if the call fails, cards are read on the server with tesseract.js, and nothing leaves the homelab. Card photos are stored like match photos: re-encoded without metadata, and members only.

## Still possible to add

- **Passkeys:** Face ID or fingerprint sign-in, with no password to steal or phish.
- **Emailed password resets,** if email is ever turned on, with the owner's consent.
