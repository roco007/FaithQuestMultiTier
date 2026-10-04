# FaithQuest — Frontend / Backend Architecture Migration Plan

> **STATUS: PLAN — produced after a full inspection of the existing repository, before any
> structural change.** Phases are executed in the order given in §8 (MIGRATION PLAN).
>
> **ADDENDUM (database engine):** this plan was written against PostgreSQL 14+ and the
> migrations were executed that way. The datasource has since moved to **MySQL 8 (Aiven-hosted)**
> via `prisma/schema.prisma` (`provider = "mysql"`) and `@prisma/adapter-mariadb`; where the
> sections below still say PostgreSQL, read MySQL 8. Nothing else in the design changed — UUID
> primary keys, the Prisma module/service, cascades and the entity list are all as written.

---

## 1. CURRENT ARCHITECTURE

The existing app is a **single, self-contained Next.js 16 (App Router) + React 19 + TypeScript**
web application with **no backend, no database and no authentication**. All game state lives in the
browser.

```
                Next.js 16 App Router (single app, no server of its own except 1 proxy route)
                                        │
     ┌──────────────────────────────────┼────────────────────────────────────┐
     │                                  │                                    │
  app/ (routes)                  context/ (state)                    services/ (persistence)
  /            quest map        GameProvider   ─ XP/level/badges      localGameRepository
  /games       hunts            HuntProvider   ─ hunts/route/keys      → localStorage
  /creator     authoring        LocationProvider ─ one GPS watch       (hunts + progress)
  /inventory   backpack                                                        │
  /profile     badges/stats     hooks/ (GPS, sensors, radar)                   │
     │                                                                        │
  components/ (map, AR/three.js, HUD, modals)                            data/church_nodes.json
     │                                                                   (6 static quest nodes)
  utils/ (geo, arPlacement, keys, huntRoute, huntQuestions, sound, storage)
```

### Facts established by inspection

| Area | Where | What it does today |
| --- | --- | --- |
| Routes | `app/page.tsx`, `app/games/page.tsx`, `app/creator/page.tsx`, `app/inventory/page.tsx`, `app/profile/page.tsx` | 5 screens, all `'use client'` |
| Quest data | `data/church_nodes.json` (6 nodes), read statically by `GameContext` | 3 puzzle types: `mcq`, `unscramble`, `camera_qr` |
| XP / level | `context/GameContext.tsx` `solveNode()` + `RANKS` table | 5 named ranks (300/450/600/800/1000 XP), then `Archon Level N` at `round(prev*1.3)` |
| Badges | `utils/storage.ts` `INITIAL_PLAYER_PROGRESS.badges` (6 badges), unlocked by `node.reward.badgeId` | 4 categories: exploration, wisdom, speed, mastery |
| Inventory | `types/inventory.ts`, unlocked by `node.reward.itemId`, rendered in `app/inventory/page.tsx` | 4 rarities |
| Quest completion | `context/GameContext.tsx` `solveNode()` → `utils/storage.ts` `savePlayerProgress()` | **client-authoritative**: XP, level, badge, item, completion all computed in the browser |
| Hunts | `context/HuntContext.tsx`, `services/gameRepository.ts`, `utils/huntRoute.ts`, `utils/huntFile.ts` | Authored on device, shared as a **self-contained base64 share code** + `#join=` deep link; integer hunt ids allocated per device |
| Hunt gameplay | `components/HuntARCamera.tsx`, `components/HuntPlay.tsx` | Deal-on-publish route (`dealPublishedRoute`), per-stop key gate (`utils/keys.ts`), fuzzy question gate (`utils/huntQuestions.ts`), treasure stop last, opening "meeting", end-of-hunt character |
| Hunt persistence | `services/gameRepository.ts` (`GameRepository` interface + `localGameRepository`) | `@faithquest:hunt_games`, `@faithquest:hunt_progress`, `@faithquest:active_hunt_game_id` |
| Progress persistence | `utils/storage.ts` | `@faithquest:player_progress` |
| GPS | `hooks/useLocationTracker.ts`, `context/LocationContext.tsx`, `hooks/useDeviceOrientation.ts` | one app-wide `watchPosition`, device orientation for AR |
| Map | `components/GoogleGameMap.tsx` / `LeafletGameMap.tsx` (via `components/GameMap.tsx`), `utils/mapConfig.ts` | Google Maps when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` set, else keyless Leaflet |
| AR / 3D | `components/HuntARCamera.tsx`, `components/ar/*`, `utils/arPlacement.ts`, `public/characters/*` | `getUserMedia` + plain WebGL three.js 0.162.x |
| Auth | **none** | no users, no sessions, no roles |
| API calls | only `app/api/places-search/route.ts` (same-origin proxy to Google Places) | no game API |
| Env | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_MAP_ID`, `GOOGLE_MAPS_API_KEY` | no `.env.example` committed |
| Tests | `npm test` → `scripts/manifest.test.mjs` + `scripts/route.test.ts` (tsx) | route engine + character manifest only |

### Storage classification (required by rule #14)

| localStorage key | Classification | Target |
| --- | --- | --- |
| `@faithquest:player_progress` | **SERVER DATA** (XP, level, rank, completed node ids, badges, inventory, streak) | PostgreSQL via `PlayerProgress` / `QuestCompletion` / `UserBadge` / `UserInventory`; localStorage becomes a read-through cache |
| `@faithquest:hunt_games` | **SERVER DATA** (authored hunts, keys, questions, answers) | `Hunt` / `HuntNode`; kept locally as the offline cache + share-code fallback |
| `@faithquest:hunt_progress` | **SERVER DATA** (joined hunt, route, discovered stops, completion) | `HuntParticipant`; kept locally as the offline cache |
| `@faithquest:active_hunt_game_id` | **CLIENT STATE** (which hunt this device is showing) | stays local |

New client-only key introduced by the migration: `@faithquest:auth` (JWT access + refresh tokens).

### What absolutely must be preserved (rule #1 / #29)

* the 5 screens, `globals.css`, the map/AR/three.js implementation, GPS hooks, haptics/sound;
* the `ChurchNode` JSON shape consumed by `ClueModal` / `RadarHUD` / `XPProgressBar`;
* the `HuntCharacter` / `HuntGame` shapes, the deal-on-publish route, key gate, fuzzy question gate
  and share-code join flow (they are gameplay, and they are also the offline story);
* `npm test`, `npm run dev`, `npm run build` must keep working with **no backend configured** —
  the app stays fully playable as it is today.

---

## 2. PROPOSED ARCHITECTURE

Two deployables, one logical product. Modular monolith backend. No microservices, no queue, no
cache layer, no GraphQL/CQRS (rule #27).

```
                        FAITH QUEST
                             │
              ┌──────────────┴───────────────┐
              │                              │
      NEXT.JS FRONTEND                 NESTJS BACKEND
      (existing app, in place)         (new: backend/)
              │                              │
      React / TypeScript               REST API  /api/v1
      Maps / GPS                       JWT auth (access + refresh)
      Three.js / AR                    Users / Progress
      Game UI / HUD                    Quests / Hunts
      client state                     XP / Levels / Badges
      localStorage cache               Inventory / Leaderboard
      (read-through, offline)                │
                                       Prisma 7
                                             │
                                       PostgreSQL 14+
```

Integration contract:

* `GameContext` and `HuntContext` keep their **existing public APIs**; only their internals change.
* Two adapters are added, behind interfaces the codebase already has (or trivially gains):
  1. `api/*.api.ts` — the typed REST client (no raw `fetch` inside components).
  2. `services/remoteGameRepository.ts` — an implementation of the existing `GameRepository`
     interface, whose own doc comment says it was written to be "swapped in a
     Firebase/Supabase/REST implementation later without touching any UI code".
* **Offline-first:** every remote call is wrapped so that a network failure or a logged-out session
  falls back to today's local behaviour. Nothing regresses; the server wins only when reachable.

---

## 3. FILES THAT STAY FRONTEND (unchanged or only lightly touched)

**Unchanged** — `app/globals.css`, `app/layout.tsx`, `app/page.tsx`, `app/creator/page.tsx`,
`app/inventory/page.tsx`, `app/api/places-search/route.ts`, `components/**` (all 26 files incl.
`HuntARCamera.tsx`, `HuntPlay.tsx`, `CameraQRPuzzle.tsx`, `ar/**`, `mapPins.ts`), `hooks/**`,
`utils/geo.ts`, `utils/arPlacement.ts`, `utils/sound.ts`, `utils/huntRoute.ts`,
`utils/huntQuestions.ts`, `utils/keys.ts`, `utils/mapConfig.ts`, `utils/placeSearch.ts`,
`utils/googleMapsLoader.ts`, `services/huntFile.ts`, `services/shareGame.ts`,
`services/characterAssets.ts`, `services/sponsorBanners.ts`, `types/**`, `public/**`,
`characters/**`, `scripts/**`.

**Lightly modified** (behaviour preserved, new code paths additive):

| File | Change |
| --- | --- |
| `context/GameContext.tsx` | `solveNode()` calls the API when an API base URL + session exist, else keeps today's local logic; boot loads server progress with a local cache. Public context type unchanged. |
| `context/HuntContext.tsx` | selects `remoteGameRepository` when API + session exist, else `localGameRepository`. No other change. |
| `components/Providers.tsx` | adds `AuthProvider` around the existing three providers. |
| `app/profile/page.tsx` | adds a small "Account" card (sign in / create account / sign out) and swaps the hard-coded `LEADERBOARD_DATA` for the leaderboard API when available (falls back to the sample rows). |
| `package.json` (frontend) | `test` script gains the new API-layer test. |
| `.env.example` (new, frontend) | documents `NEXT_PUBLIC_API_URL`. |

**Frontend keeps responsibility for:** GPS acquisition, map rendering, user-location display,
compass/orientation, AR, three.js/GLB, animations, all UI/game screens/HUD, client navigation,
temporary UI state, offline cache, and *optimistic proximity for UI only* (rule #10).

---

## 4. FILES / LOGIC THAT MOVE BACKEND (rule #11)

| Logic today | Frontend file | Moves to |
| --- | --- | --- |
| Account identity, sessions, roles | *(does not exist)* | `backend/src/auth`, `users`, `common/guards` |
| XP awarding, level & rank calculation | `context/GameContext.tsx` (`solveNode`, `RANKS`) | `quests/services/xp.service.ts` |
| Quest completion + radius validation | `context/GameContext.tsx` (`solveNode`) + `utils/geo.ts` | `quests/services/quest-completion.service.ts`, `distance.service.ts` |
| Badge unlock evaluation | `context/GameContext.tsx` (badgeId match) | `quests/services/badge-evaluator.service.ts` + `badges` module |
| Inventory awarding | `context/GameContext.tsx` (`reward.itemId`) | `quests/services/inventory-award.service.ts` + `inventory` module |
| Persistent player progress / streak | `utils/storage.ts` | `progress` module + `PlayerProgress` table |
| Quest catalogue | `data/church_nodes.json` (static import) | `QuestNode` table, seeded from that file, served by `quests` module |
| Hunt creation/list/delete/publish/join/progress | `context/HuntContext.tsx`, `services/gameRepository.ts` | `hunts` module + `Hunt` / `HuntNode` / `HuntParticipant` |
| Leaderboard | `app/profile/page.tsx` (hard-coded) | `leaderboard` module (paginated) |

`utils/geo.ts`, `utils/huntRoute.ts`, `utils/huntQuestions.ts` and `utils/keys.ts` **stay** in the
frontend (AR/UI maths and the offline fallback) and are **re-implemented server-side** where the
server must be authoritative (distance, key normalisation, question matching). That is the one
deliberate, documented duplication: the server copy is the authority, and the shared rule constants
(`EARTH_RADIUS_METERS = 6371000`, 80 % answer similarity, the unambiguous key alphabet) are stated
in both places with a comment pointing at the other.

---

## 5. DATABASE ENTITIES (Prisma + PostgreSQL, UUID PKs, timestamps, cascades)

`User`, `PlayerProgress`, `Hunt`, `HuntParticipant`, `HuntNode`, `QuestNode`, `QuestCompletion`,
`Badge`, `UserBadge`, `InventoryItem`, `UserInventory` — with exactly the relationships in the brief
(`User 1—1 PlayerProgress`; `User 1—n QuestCompletion / UserBadge / UserInventory / Hunt(created) /
HuntParticipant`; `Hunt 1—n HuntNode / HuntParticipant`; `QuestNode 1—n HuntNode / QuestCompletion`;
`Badge 1—n UserBadge`; `InventoryItem 1—n UserInventory`).

**Adaptations forced by the existing application** (rule #29 — adapt the architecture, do not delete
the feature):

1. `QuestNode` gains `subtitle`, `clueHint`, `category`, `iconName`, nullable `rewardBadgeId` /
   `rewardItemId` FKs, so the seeded `church_nodes.json` round-trips into the frontend's existing
   `ChurchNode` shape. `puzzle` stays `Json` and holds the puzzle payload verbatim (`funFact`,
   `scriptureRef`, options, scrambled letters, QR value…), so `ClueModal` renders it untouched.
   `type` is the `QuestType` enum, extended with the app's third puzzle kind `CAMERA_QR` alongside
   `LOCATION` / `PUZZLE` / `QUIZ` / `AR`.
2. `HuntNode` carries the **hunt-stop presentation fields** the existing `HuntCharacter` needs:
   `characterType`, `characterAssetId`, `sponsorBannerId`, `altitudeMeters`, `key` (the discovery
   key, normalised uppercase), `questions Json` (the `HuntQuestion[]` gate) and `isTreasure`.
   Without these the deal-on-publish route, the per-stop key gate and the question gate — i.e. the
   gameplay — could not be represented. Name/subtitle/coordinates/radius/clue live on the linked
   `QuestNode`, so a hunt stop really is a reference to an authored location, as the brief intends.
3. `Hunt` gains `route Json?` — the dealt order of `HuntNode` ids produced by
   `dealPublishedRoute`, so "every publish deals a fresh order and it travels with the hunt" keeps
   working. `shareCode` is the short join code and is unique.
4. `PlayerProgress` gains `currentXp` / `xpForNextLevel` / `rankTitle`, because the existing HUD
   renders `currentXp / xpForNextLevel` inside the current level.
5. `User` keeps `totalXp` / `level` (as the brief specifies) in lock-step with `PlayerProgress`
   inside the same transaction — the leaderboard reads `User`, the HUD reads `PlayerProgress`.

Constraints implemented: unique `User.email`, `User.username`, `Hunt.shareCode`, `Badge.name`,
`InventoryItem.name`; `@@unique([HuntParticipant.huntId, userId])`,
`@@unique([HuntNode.huntId, sequence])`, `@@unique([HuntNode.huntId, questNodeId])`,
`@@unique([QuestCompletion.userId, questNodeId])`, `@@unique([UserBadge.userId, badgeId])`,
`@@unique([UserInventory.userId, itemId])`.

Cascades: `PlayerProgress`, `QuestCompletion`, `UserBadge`, `UserInventory`, `HuntParticipant` and
`HuntNode` cascade from their parents; `UserBadge` / `UserInventory` also cascade from `Badge` /
`InventoryItem` so a catalogue delete cannot orphan rows. `Hunt.creator` and
`QuestCompletion.questNode` use `Restrict`, so authored content can never be silently destroyed.

---

## 6. API CONTRACT (base path `/api/v1`, Swagger at `/api/docs`)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | – | `{email, username, password}` → tokens + user |
| POST | `/auth/login` | – | `{email, password}` → tokens + user |
| POST | `/auth/refresh` | – | `{refreshToken}` → new token pair (rotating) |
| POST | `/auth/logout` | Bearer | revokes the supplied refresh token |
| GET | `/auth/me` | Bearer | current user |
| GET | `/users/me` | Bearer | profile + progress summary |
| PATCH | `/users/me` | Bearer | validated `displayName` / `avatarUrl` / `username` |
| GET | `/quests` | optional | quest catalogue, paginated, filter by `type` / `category` |
| GET | `/quests/:questId` | optional | one quest node |
| POST | `/quests/:questId/complete` | Bearer | `{latitude, longitude}` — the authoritative completion (§7) |
| GET | `/hunts` | Bearer | `?mine=true` (created) / `?joined=true` (participating) |
| POST | `/hunts` | Bearer (CREATOR/ADMIN) | `{title, description, nodeIds[], endAnnouncement, endCharacterAssetId}` |
| GET | `/hunts/:huntId` | Bearer | hunt + stops in authored order |
| PATCH | `/hunts/:huntId` | Bearer (owner) | update meta / stops |
| DELETE | `/hunts/:huntId` | Bearer (owner) | cascades stops + participants |
| POST | `/hunts/:huntId/publish` | Bearer (owner) | `DRAFT→PUBLISHED`, deals a fresh route, returns `shareCode` |
| POST | `/hunts/join` | Bearer | `{shareCode}` or `{huntId}` → idempotent `HuntParticipant` |
| GET | `/hunts/:huntId/progress` | Bearer (member) | participant state + route + discovered ids |
| POST | `/hunts/:huntId/discover` | Bearer (member) | `{nodeId, key?, answers?}` — server-validated stop gate (additive; the local gate keeps working offline) |
| GET | `/progress` | Bearer | level, XP, rank, streaks, completed quests/hunts |
| GET | `/badges` | optional | catalogue + the caller's unlock state |
| GET | `/inventory` | Bearer | items held, with quantity and `obtainedAt` |
| GET | `/leaderboard` | optional | `?page=&limit=` → users ranked by `totalXp` |
| GET | `/leaderboard/me` | Bearer | the caller's rank |
| GET | `/health` | – | `{status:"ok", database:"connected"}` |

**Error envelope** — every failure, produced by one global exception filter:

```json
{ "success": false,
  "error": { "code": "QUEST_ALREADY_COMPLETED", "message": "You have already completed this quest." },
  "timestamp": "2026-09-30T12:00:00.000Z",
  "path": "/api/v1/quests/123/complete" }
```

Status → code map: 400 `VALIDATION_ERROR`, 401 `UNAUTHORIZED`, 403 `FORBIDDEN`, 404 `NOT_FOUND`,
409 `CONFLICT`, 422 `BUSINESS_RULE_VIOLATION`, 500 `INTERNAL_SERVER_ERROR`. Domain codes carried on
409/422: `QUEST_ALREADY_COMPLETED`, `OUTSIDE_QUEST_RADIUS`, `QUEST_INACTIVE`,
`HUNT_NOT_PUBLISHED`, `HUNT_ALREADY_JOINED`, `HUNT_NOT_JOINED`, `OUT_OF_ORDER_DISCOVERY`,
`INVALID_KEY`, `WRONG_ANSWER`, `INSUFFICIENT_ROLE`, `USERNAME_TAKEN`, `EMAIL_TAKEN`.

Successful collections return `{ items, total, page, limit }`; resources are returned directly, so
the thin frontend client stays trivial.

---

## 7. GAME LOGIC (authoritative quest completion, rule #12)

`QuestCompletionService.completeQuest(userId, questId, latitude, longitude)`:

```
load quest (isActive?)            → 404 NOT_FOUND / 422 QUEST_INACTIVE
already completed (unique)?       → 409 QUEST_ALREADY_COMPLETED
haversine(player, quest)          → 422 OUTSIDE_QUEST_RADIUS (distanceMeters in the payload)
prisma.$transaction:
    create QuestCompletion (xpEarned, submitted coords, status COMPLETED)
    XpService.award()             → totalXp, level, currentXp, xpForNextLevel, rankTitle
    BadgeEvaluator.evaluate()     → explicit reward badge + achievement rules
    InventoryAward.award()        → explicit reward item (quantity upsert on conflict)
    update PlayerProgress         → currentStreak / longestStreak / lastActiveAt
    update User totals            → totalXp, level   (leaderboard source of truth)
return authoritative result       → {status, xpEarned, totalXp, level, leveledUp, badge?, item?,
                                     distanceMeters, completedAt}
```

Client-supplied `xp` / `level` / `completed` / `badge` / `item` are **never** read (rule #13): the
DTO whitelists only `latitude` and `longitude`. GPS stays a frontend concern; the server performs no
continuous tracking.

**XP / level parity.** The server rank table reproduces `GameContext.RANKS` exactly (1 Novice Seeker
300, 2 Faith Pilgrim 450, 3 Sacred Acolyte 600, 4 Temple Guardian 800, 5 Champion of Truth 1000,
then `Archon Level N` at `round(previous × 1.3)`). One deliberate, documented improvement: the
server loops when a single award crosses more than one threshold, whereas today's client code levels
up at most once per solve and can leave `currentXp` above the bar's maximum. Thresholds are
unchanged, so no existing player's level differs.

**Badge rules** (seeded via `Badge.requirement` JSON): the six existing badges keep their exact
titles, descriptions, icons and categories and remain unlockable by `QuestNode.rewardBadgeId`;
additionally the evaluator understands `{"type":"quests_completed","count":n}`,
`{"type":"level","value":n}`, `{"type":"hunts_completed","count":n}` and
`{"type":"streak","days":n}`, so the two catalogue entries no quest currently grants
(`badge_cryptographer`, `badge_scripture_master`) are reachable by rule as well.
`@@unique([userId, badgeId])` makes double-awarding impossible.

**Hunt route parity.** `dealPublishedRoute` is re-implemented server-side (same shuffle, treasure
held back and dealt last, stored on `Hunt.route`) and the stop gate (`keyMatches` +
`isQuestionCorrect`, 80 % Levenshtein similarity) is re-implemented in
`hunts/services/hunt-gate.service.ts`, so `/hunts/:id/discover` validates a stop without trusting
the client's answers. The client still runs its own gate offline; when the API is reachable, the
server's answer is the one persisted.

---

## 8. MIGRATION PLAN (the 18 phases, with the incremental gate after each)

| Phase | Work | Gate before continuing |
| --- | --- | --- |
| 1 | Repository inspection → this document | done |
| 2 | Backend skeleton (`backend/` Nest 12, `main.ts`, `app.module.ts`, `health`, common/error filter, config, Swagger) | `npm run build` + `GET /api/v1/health` |
| 3 | PostgreSQL + Prisma module/service, `.env` | `prisma validate`, client generated |
| 4 | Prisma schema + first migration | `prisma migrate dev` against local PG |
| 5 | `prisma/seed.ts` importing `data/church_nodes.json` + the 6 badges + items + starter locations | `prisma db seed`, then `GET /quests` returns 6 nodes |
| 6 | Auth (bcrypt, access + refresh JWT, guards, `@CurrentUser`, roles) | unit + e2e register / login / me |
| 7 | Users + Progress | `GET /users/me`, `GET /progress` |
| 8 | Quests read APIs | `GET /quests` matches the existing JSON shape |
| 9 | Quest completion transaction (XP, distance, badge evaluator, inventory award) | `POST /quests/:id/complete` twice → second is 409; outside radius → 422 |
| 10 | Hunts (CRUD, publish + deal route, join, progress, discover) | create → publish → join → progress |
| 11 | Badges + Inventory APIs | `GET /badges`, `GET /inventory` |
| 12 | Leaderboard (paginated) | `GET /leaderboard`, `/leaderboard/me` |
| 13 | Frontend API client (`api/*`), auth context, frontend `.env.example` | frontend `tsc --noEmit` + `next build` |
| 14 | Context migration: `GameContext` (server-authoritative completion, cached progress); `remoteGameRepository` behind the existing `GameRepository` interface | app still runs with **no** `NEXT_PUBLIC_API_URL` |
| 15 | Retire obsolete local writes on the API path (localStorage becomes a cache; local logic remains only as the offline fallback) | manual walk-through of all 5 screens, configured and unconfigured |
| 16 | Tests — unit (XP, level, distance, badges, completion rules, hunt gate) and e2e (register, login, profile, complete, duplicate, outside radius, create hunt, join hunt) | `npm test` green in both apps |
| 17 | Docker (`Dockerfile`, `docker-compose.yml`, `.dockerignore`) | `docker compose config` (no Docker daemon on this machine — validated by inspection and by running the same steps manually) |
| 18 | Production deployment notes | written up in `docs/MIGRATION_REPORT.md` |

### Risk register

| Risk | Mitigation |
| --- | --- |
| Tooling is newer than the model's training data (Nest 12, Prisma 7, TS 6) | pin versions; validate with `prisma validate`, `nest build` and live requests; iterate on real errors instead of assumptions |
| Breaking the AR / three.js or map code | no file under `components/` is touched |
| Breaking offline play | every remote path has a local fallback; with `NEXT_PUBLIC_API_URL` unset the app behaves exactly as today |
| Losing hunt gameplay during normalization | hunt stops keep `key`, `questions`, `isTreasure`, `characterType`, `characterAssetId`, `sponsorBannerId`, `altitudeMeters`; the dealt order is stored on `Hunt.route` |
| Duplicate XP for one quest | `@@unique([userId, questNodeId])` + one transaction + an explicit regression test |
| No Docker daemon on this machine | compose file validated by inspection; migrations run against the local PostgreSQL 14 server |