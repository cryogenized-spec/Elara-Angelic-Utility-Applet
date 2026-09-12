# Android device validation — media hand-off

**Protocol created: 2026-09-12.** This is the evidence artifact for physical-device
validation of the YouTube media feature. It is a checklist for a person holding an
Android phone; it cannot be automated, and no result on this page may be filled in
from anything other than the device itself.

**Honest status at creation: no device run has been recorded yet.** Every
"Actual" field below is intentionally blank. Until someone completes this run,
the correct claim about the app on Android is: *implemented and CI-verified at the
URI/browser level; device behaviour unverified.*

**Why this document exists:** a browser — including CI's Chromium — can verify the
hand-off URI shape, the card, the cache, and the failure paths. It cannot observe
Android's own decision of whether to show the app chooser or jump straight to a
single default handler. That decision belongs to the phone, made from the set of
installed apps.

Time budget: under 10 minutes. Record Actuals inline (or reply with them and they
will be transcribed here, dated).

---

## 0. Setup — install the applet from its shipped deployment

1. On the Android phone, open Chrome and go to:
   `https://cryogenized-spec.github.io/Elara-Angelic-Utility-Applet/`
   (this is the GitHub Pages deployment, built from `main` — the way the repo
   actually ships, base path `/Elara-Angelic-Utility-Applet/`).
2. Menu (⋮) → **Add to Home screen** → install.
3. Note for the record: until this document existed the applet had only ever been
   exercised through CI's headless browser, a local dev server, and desktop
   previews. This install is its first contact with a physical device.

- Expected: the app installs and opens from its home-screen icon.
- Actual:

## 1. Lockbox on device

1. Open the app → sidebar → **Open settings** → **Lockbox**.
2. Create a PIN Lockbox. Save your Gemini API key. Save your YouTube Data API key.
3. Fully close the app (swipe it out of Recents) and reopen it.
4. Unlock the Lockbox with the PIN. Check Settings → Lockbox status.

- Expected: the key survives the close/reopen; after unlocking, Lockbox reports
  the same armed/unlocked status it reported before the close; the YouTube key is
  still present.
- Actual:

## 2. Music ask — "play some lo-fi"

1. Ask: `play some lo-fi`
2. Expect a media card labelled **Listen** (subtitle "in your music app"). No
   embedded player, no audio inside the applet — the card is only a link.
3. Tap the card **in Chrome** first (not the installed PWA), then record exactly
   which one happened:

   - [ ] Android's app **chooser** listing several apps
   - [ ] **one app opened directly** (name it: ______)
   - [ ] the **browser** opened the YouTube page
   - [ ] **nothing** happened

4. Now tap a **Listen** card from inside the **installed PWA** (home-screen icon)
   and record the same four-way choice. (The PWA's standalone context is the case
   most likely to skip the chooser and fall back to opening a browser tab — that
   is precisely what this step exists to learn.)
5. In both cases confirm: **no audio ever played inside the applet itself** — no
   sound before the hand-off, no player UI in the chat.

- Expected: no in-app playback, ever. The chooser-vs-direct outcome is Android's
  decision based on installed handlers — **either outcome is acceptable and is
  recorded, not judged.** If one app opened directly and a choice was expected,
  that is documented platform behaviour, accepted by design; the fix is never to
  pin a package name (that kills the chooser for everyone else).
- Actual (Chrome tab):
- Actual (installed PWA):
- In-app playback observed? (must be no):

## 3. Video ask — "find a video of …"

1. Ask: `find a video of the Artemis launch`
2. Expect a card labelled **Watch** (subtitle "on YouTube"). Tap it.
3. Record the same four-way outcome as in step 2 (chooser / one app / browser /
   nothing). Expected destination: YouTube, or the chooser offering it.

- Actual:

## 4. Cache re-tap — the second identical ask is free

1. Open `chrome://inspect` on a desktop, attach the phone by USB, and start a
   remote-devtools session on the applet's page (Network panel), or open devtools
   on-device.
2. Ask the **same** music or video question twice.
3. Count the requests to `googleapis.com/youtube/v3/search`.

- Expected: exactly **one** search request across the two asks; the second answer
  comes from the local cache (positive cache lives 7 days). More than one request
  for a repeated identical query is a defect.
- Actual (number of search requests for two identical asks):

## 5. Failure states

1. In Settings → Lockbox, remove the YouTube API key. Ask: `play some jazz`.
   - Expected: the assistant explains in plain language that no YouTube API key
     is configured and one should be added in Settings — it must **not** pretend
     anything played and must **not** show a media card.
   - Actual:
2. Restore the key (unlock, re-save). Ask for something with no results, e.g.
   `play the private unreleased demo tape of zqxj`
   - Expected: no card; an honest "nothing found" style answer (unfound queries
     are negatively cached for 10 minutes, so an immediate repeat should not
     trigger a new network search either).
   - Actual:

## 6. Quota guard — 12 searches, then it says so

The allowance is **12 network searches per page session** (cached answers are
free and never spend it). To reach the cap you need 12 *distinct* queries, then a
13th.

1. Ask 13 distinct music/video questions (e.g. `play Mozart`, `play Amapiano`,
   `find a video of …` …).
2. Watch the 13th.

- Expected: the app stops issuing searches after the 12th and says so in plain
  language — its message is: *"This session has used its YouTube search
  allowance. Cached results still work; reload to reset the allowance."*
  Reloading the page restores the allowance (a fresh session).
- Actual (did it stop at 12; exact behaviour of the 13th):

## Not verified before this document existed

**Everything in this file.** As of 2026-09-12 no physical Android device had ever
run this applet — its entire verified history was unit tests, CI's headless
Chromium, and desktop browser sessions. The fields above are blank for exactly
that reason. This section will list anything the run found broken, with
reproduction steps; if the run finds nothing broken, this section will say so
explicitly, dated.
