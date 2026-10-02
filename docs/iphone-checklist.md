# Installed iPhone check (one page)

Purpose: confirm the browser separation works in an installed home-screen app.
This check performs no passkey ceremony and proves no real login. Report only
browser, version and the status words below. No account names, no screenshots
of personal content, no credentials.

Setup: host `docs/manual/iphone-check.html` (the same file) at the community
origin and at `vault.<community>.<base>`. Use the test domains; do not use a
production community.

| # | Step | Expect | Report |
|---|------|--------|--------|
| 1 | Open the community page in Safari; tap Share, Add to Home Screen. | Installs. | yes / no |
| 2 | Open the installed app. Check "Installed home-screen app" reads yes. | yes (standalone) | yes / no |
| 3 | Tap Start the vault frame. | Vault frame: running at the vault origin | status |
| 4 | Tap Continue inside the frame. | A pop-up window opens (status popup-open) | status |
| 5 | In the pop-up tap Report success and close. | Window closes; status handed-back | status |
| 6 | Repeat 4, tap Report cancel and close. | status cancelled | status |
| 7 | Repeat 4, close the pop-up with the system control. | status closed-early | status |
| 8 | Block pop-ups for the site, repeat 4. | status blocked, nothing else happens | status |
| 9 | Origin isolation: the page origin and vault origin rows differ and the frame row names the vault origin. | differ | yes / no |
| 10 | Repeat 3 to 8 in an ordinary Safari tab, and in Chrome or Firefox on the phone if available. | same results | per browser |

Timeout: leave the pop-up open for two minutes in the real app later; this page
has no timeout.

Result to send: iOS version, Safari or installed app, and the status word for
each row. If row 4 or 5 fails in the installed app, stop and report: the
one-origin fallback is the owner's decision and is not activated automatically.
