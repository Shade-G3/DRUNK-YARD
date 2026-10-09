# Drunk Yard 2.0

Anonymous video rooms for **2 to 6 people**, with party games, cheers, and virtual drink gifting.
React + TypeScript frontend, Node + TypeScript + Socket.IO backend, WebRTC mesh video.

> The old v1 code (vanilla JS) is kept in `_old_v1/` for reference. Delete it when you're happy.

## Run it locally

You need Node 18.18+ (Node 20 or 22 recommended).

```bash
npm run setup          # installs Server + Client dependencies
npm run dev:server     # terminal 1 → http://localhost:3000 (API + sockets)
npm run dev:client     # terminal 2 → http://localhost:5173 (open this one)
```

Open http://localhost:5173 in two different browsers (or one normal + one incognito window) to match with yourself.
Camera works on `localhost`. To test on your phone over Wi-Fi you need **HTTPS** (browsers block cameras on plain `http://192.168…`) — easiest is to deploy, or use a tunnel like `cloudflared tunnel --url http://localhost:5173`.

## Deploy (one service on Render)

1. Push this folder to GitHub.
2. Render → New → **Web Service** → pick the repo.
3. Build command: `npm run build` · Start command: `npm start`
4. Environment variables (see `Server/.env.example`):
   - `NODE_ENV=production`
   - `TRUST_PROXY_HOPS=1` (needed so IP limits use the real client IP)
   - `ALLOWED_ORIGINS=https://<your-app>.onrender.com`
   - `TURN_URLS` + `TURN_SECRET` once you have a TURN server (see below)
5. Use at least the **Starter** instance. The free tier sleeps, so the first visitor waits ~50s and sees nobody.

The Node server serves the built React app, so there's only one URL and no CORS setup.
`render.yaml` has the same settings if you create the service as a Render Blueprint.

## TURN (needed for video on mobile networks)

Without TURN, two people on different networks (especially Jio/Airtel mobile data) often match but
their video stays on "Connecting…". The server logs `⚠ No TURN server configured` at startup until you set one.

**Easiest — Cloudflare Realtime TURN** (generous free tier, pay per GB after):
1. dash.cloudflare.com → **Realtime** → **TURN Server** → *Create* → copy the **Turn Token ID** and **API Token**.
2. In Render → Environment add `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN`, then redeploy.
3. Check `https://<your-app>.onrender.com/api/ice` — it should now list `turn:` URLs with a username/credential.

Alternatives: Metered.ca (`METERED_TURN_URL` = full credentials URL with `apiKey`) or your own coturn
(`TURN_URLS` + `TURN_SECRET`). Credentials are short-lived and generated on the server.

## CI (GitHub Actions)

`.github/workflows/ci.yml` runs on every PR and push to `main`:
build (same command as Render) → typecheck → `npm audit` (high+) → start the server in production mode →
smoke test (`Client/scripts/smoke.mjs`: two fake users match, chat, send a drink, leave).

Deploy only after CI passes (optional): in Render, copy **Settings → Deploy Hook** URL, add it as the
GitHub secret `RENDER_DEPLOY_HOOK_URL`, and turn **Auto-Deploy off**. Dependabot opens weekly update PRs.

## What's inside

```
Server/src/
  index.ts          HTTP + Socket.IO setup, CSP/helmet, real-IP logic, /api/ice (TURN creds)
  hub.ts            matchmaking (2–6), rooms, signaling relay, chat, games, gifts, cheers, reports
  games.ts          server-authoritative game engine (timers, votes, scores)
  gameContent.ts    prompt decks (PG-13; nothing rewards actually drinking)
  store.ts          coins, bar shelf, bans, mutual cheers — IN MEMORY (see "Before real launch")
  limiter.ts        token-bucket rate limits per event + per-IP connection window
  shared/protocol.ts  types + catalogs shared with the client (vibes, drinks, tiers, games)
Client/src/
  state.ts          app state (zustand) + all socket event handling
  lib/rtc.ts        WebRTC mesh (one offerer per pair, bitrate caps by room size)
  components/       Lobby, Searching, Room, Game, Sheets (gift/report/chat/games), Fx, Recap
  styles.css        design tokens: dark, light, and 5 bar themes (whisky/rum/vodka/wine/beer)
```

### Features
- **Rooms of 2–6.** Pick a size; groups stay open until full. 1-on-1 auto-finds the next person when your partner leaves.
- **Bar mode.** Pick a drink and the whole UI changes to that drink’s theme. Sober = classic dark/light with a toggle.
- **Games (7):** This or That, Who’s Most Likely To, Never Have I Ever, Two Truths & a Lie, Red Flag/Green Flag, Would You Rather, Truth or Dare (spicy pack only in Flirty rooms).
- **Send a drink.** 6 categories × 5 tiers (Red → Black → Green → Gold → Blue). Bottles fly between tiles; Gold = gold dust + shout-out; Blue = full-screen moment for the room. “Round for the table”, and **Clink!** when two people send each other a drink within 3 seconds. Received drinks go on your bar shelf.
- **Cheers.** Give cheers in the room or on the recap screen; mutual cheers let you call that person again for 24h.
- **Safety.** 18+ confirmation, report → never matched again, 3 distinct reports in 24h → ban (device + short IP ban).

### Security fixes vs v1
- Real client IP from the right-most trusted `X-Forwarded-For` hop (v1 trusted the first, spoofable value).
- Rate limits on **every** socket event (v1 only limited chat; `join` spam could pin the CPU).
- Signaling payloads whitelisted and size-capped; origin check on sockets; strict CSP; HSTS in production.
- No hard-coded public TURN passwords; short-lived HMAC TURN credentials from `/api/ice`.
- Online count/queue stats are throttled instead of broadcast to everyone on every connect.
- Fixed v1 group bug where 3+ people forming a room at once couldn’t see each other.
- Personal email removed from the page; `/stats` endpoint removed.

## Before a real launch (not done yet — needs accounts/money)

1. **TURN server** (coturn on a small VPS, or Cloudflare/Twilio/Metered TURN). Without it some users on strict mobile networks can't connect video.
2. **Persistence:** `store.ts` is in memory — coins, shelves and bans reset on every deploy. Move to Postgres/Redis; add the Socket.IO Redis adapter before running 2+ instances.
3. **Moderation:** wire an automated nudity check (sample a frame every ~10–15s client-side → moderation API) and a human review queue for reports. Publish a Grievance Officer contact (IT Rules 2021) and a privacy policy (DPDP Act 2023).
4. **Payments:** coins are free demo coins. Add Razorpay purchases later; don’t let users cash out received coins.
5. **Device IDs** are stored in the browser and can be reset — bans are best-effort until you add phone/OTP or another login.
6. **Groups of 5–6 on mesh** are heavy for phones (each person uploads 4–5 streams). Bitrate is capped automatically; move to an SFU (LiveKit) when groups get popular — only `Client/src/lib/rtc.ts` and the signaling in `hub.ts` need to change.
7. **Legal:** drink names are made up on purpose (no real brands). Real liquor brands in-app can count as surrogate advertising in India — get legal sign-off before any brand partnership.
