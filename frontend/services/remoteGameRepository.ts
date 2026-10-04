import { isApiConfigured } from '../api/client';
import { huntsApi } from '../api/hunts.api';
import type {
  CreateHuntInput,
  HuntStopInput,
  UpdateHuntInput,
} from '../api/hunts.api';
import type { HuntCharacterDto, HuntDto } from '../api/types';
import type { HuntGame, HuntCharacter, HuntProgress, HuntQuestion } from '../types/hunt';
import {
  localGameRepository,
  type GameRepository,
} from './gameRepository';
import { isTreasureStop } from '../utils/huntRoute';
import { webStorage } from '../utils/webStorage';

/**
 * Per-device guest identity, one token per hunt.
 *
 * A guest who joins from a share link has no account, so the server issues an
 * opaque token and this is where it lives. Without it the guest would be a new,
 * unrecognised player on every reload — their round would restart, and the
 * creator's report would fill with duplicate half-finished rows.
 *
 * Keyed by hunt so one game's token can never be presented to another: the
 * server matches on `(huntId, guestToken)`, so a token from hunt A is simply
 * unknown to hunt B. There is no "read all tokens and replay them" helper here
 * on purpose — callers ask for one hunt's token.
 */
const GUEST_TOKEN_PREFIX = '@faithquest:guest_token:';

/** The stored token for `huntId`, or null when this device has never joined. */
export async function readGuestToken(huntId: string): Promise<string | null> {
  if (!huntId) return null;
  try {
    return await webStorage.getItem(`${GUEST_TOKEN_PREFIX}${huntId}`);
  } catch {
    // Private-mode Safari throws on every storage call; a guest who cannot be
    // remembered simply plays as a new visitor next time.
    return null;
  }
}

/**
 * Stores the token the server just issued.
 *
 * A no-op for a signed-in join (there is no token to store) — which is exactly
 * why `joinGame` can call this unconditionally.
 */
export async function writeGuestToken(huntId: string, token?: string): Promise<void> {
  if (!huntId || !token) return;
  try {
    await webStorage.setItem(`${GUEST_TOKEN_PREFIX}${huntId}`, token);
  } catch {
    // Losing the token costs a fresh row next time, never correctness now.
  }
}

/**
 * `GameRepository` over the REST API (plan §2/§3).
 *
 * Selected by `HuntContext` whenever a backend is configured — signed-in or
 * not; everything degrades to `localGameRepository` exactly as the plan's
 * offline-first rule demands: *every* local read/write still happens
 * (localStorage stays the cache), and a server failure — network, not
 * published, not joined, a stop the catalogue does not know — is logged and
 * swallowed so today's behaviour never regresses.
 *
 * Creator-placed locations (a character dropped on an arbitrary PlaceSearch
 * pin, rather than one of the shared catalogue quests) sync like any other
 * hunt: the place itself travels with each stop and the server registers it.
 * See `HuntStopInput`.
 *
 * ## The two id spaces
 *
 * Local hunts key everything by a device id (`"12"`) and character ids like
 * `char_…`; the server keys hunts by UUID and its route/progress by *hunt-node*
 * UUIDs. This adapter keeps ONE mapping (below) so the UI only ever sees local
 * ids: after a create/update the response's stops are mapped to the local
 * characters **by order** (both sides are sequence-ordered 1:n), and every
 * server route / discovered id is translated back before it reaches the app.
 *
 */

const SYNC_MAP_KEY = '@faithquest:hunt_sync_map';

/** One synced hunt: its server UUID plus the character-id correspondence. */
interface SyncEntry {
  serverId: string;
  /** local character id → server hunt-node id (matched by stop order). */
  chars: Record<string, string>;
}

type SyncMap = Record<string, SyncEntry>;

async function readSyncMap(): Promise<SyncMap> {
  try {
    const raw = await webStorage.getItem(SYNC_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SyncMap;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

async function writeSyncMap(map: SyncMap): Promise<void> {
  await webStorage.setItem(SYNC_MAP_KEY, JSON.stringify(map));
}

async function entryFor(localId: string): Promise<SyncEntry | null> {
  return (await readSyncMap())[localId] ?? null;
}

/**
 * Server id for a local hunt — the id itself when it was born on the server.
 *
 * Exported because the creator dashboard needs it too: it is handed a local
 * `HuntGame.id` (`"0"`, `"12"`…) and must not put that on the wire, or every
 * call 404s against a hunt the server knows by its UUID. This is the single
 * place that knows how to cross from the device's id space to the server's.
 */
export async function serverIdFor(localId: string): Promise<string> {
  return (await entryFor(localId))?.serverId ?? localId;
}

/** Local character id → server hunt-node id (falls back to the id itself). */
function toServerCharId(localCharId: string, entry: SyncEntry | null): string {
  return entry?.chars[localCharId] ?? localCharId;
}

/** Server hunt-node id → local character id (reverse of the order mapping). */
function toLocalCharId(serverCharId: string, entry: SyncEntry | null): string {
  if (!entry) return serverCharId;
  for (const [localId, serverId] of Object.entries(entry.chars)) {
    if (serverId === serverCharId) return localId;
  }
  return serverCharId;
}

const toLocalIds = (ids: string[], entry: SyncEntry | null): string[] =>
  ids.map((id) => toLocalCharId(id, entry));

// ---------------------------------------------------------------------------
// Server ↔ UI mapping
// ---------------------------------------------------------------------------

/** Server `HuntDto` → the UI's `HuntGame`, translated into the local id space. */
function dtoToHuntGame(dto: HuntDto, localId: string, entry: SyncEntry | null): HuntGame {
  const characters = [...dto.characters]
    .sort((a, b) => a.order - b.order)
    .map<HuntCharacter>((c) => ({
      id: toLocalCharId(c.id, entry),
      order: c.order,
      name: c.name,
      subtitle: c.subtitle,
      latitude: c.latitude,
      longitude: c.longitude,
      altitudeMeters: c.altitudeMeters,
      radiusMeters: c.radiusMeters,
      characterType: c.characterType as HuntCharacter['characterType'],
      ...(c.characterAssetId ? { characterAssetId: c.characterAssetId } : {}),
      sponsorBannerId: c.sponsorBannerId ?? null,
      hint: c.hint ?? '',
      ...(c.key ? { key: c.key } : {}),
      ...(Array.isArray(c.questions) ? { questions: c.questions as HuntQuestion[] } : {}),
      ...(c.isTreasure ? { isTreasure: true } : {}),
    }));

  return {
    id: localId,
    title: dto.title,
    description: dto.description,
    creatorName: dto.creatorName,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    endAnnouncement: dto.endAnnouncement,
    endCharacterAssetId: dto.endCharacterAssetId ?? null,
    characters,
    ...(dto.route && dto.route.length > 0
      ? { route: toLocalIds(dto.route, entry) }
      : {}),
    // Carried so a share payload built from this hunt tells the *receiver's*
    // device which server hunt it is playing — see `HuntGame.shareCode`.
    ...(dto.shareCode ? { shareCode: dto.shareCode } : {}),
  };
}

/** UI `HuntGame` → the create/update payload (stops resolved server-side). */
function toStopInputs(game: HuntGame): HuntStopInput[] {
  return game.characters.map((ch) => ({
    questNodeId: ch.id,
    characterType: ch.characterType,
    ...(ch.characterAssetId ? { characterAssetId: ch.characterAssetId } : {}),
    ...(ch.sponsorBannerId ? { sponsorBannerId: ch.sponsorBannerId } : {}),
    altitudeMeters: ch.altitudeMeters,
    ...(ch.key ? { key: ch.key } : {}),
    ...(Array.isArray(ch.questions)
      ? { questions: ch.questions as unknown as Record<string, unknown>[] }
      : {}),
    isTreasure: isTreasureStop(ch),
    // The place itself travels with the stop. A location the catalogue does not
    // have is registered server-side from exactly these fields — without them
    // `POST /hunts` refused the whole hunt and it stayed device-local, invisible
    // to the creator's own progress report. Harmless for a catalogue stop: the
    // server ignores place fields whenever `questNodeId` resolves.
    title: ch.name,
    subtitle: ch.subtitle,
    latitude: ch.latitude,
    longitude: ch.longitude,
    radiusMeters: ch.radiusMeters,
    clue: ch.hint,
  }));
}

function toCreateInput(game: HuntGame): CreateHuntInput {
  return {
    title: game.title,
    description: game.description,
    endAnnouncement: game.endAnnouncement,
    ...(game.endCharacterAssetId ? { endCharacterAssetId: game.endCharacterAssetId } : {}),
    stops: toStopInputs(game),
    // A local route means the creator pressed Publish / Save (which always
    // deals one), so the server publishes too and deals ITS route for new teams.
    publish: Boolean(game.route?.length),
  };
}

function toUpdateInput(game: HuntGame): UpdateHuntInput {
  return {
    title: game.title,
    description: game.description,
    endAnnouncement: game.endAnnouncement,
    ...(game.endCharacterAssetId ? { endCharacterAssetId: game.endCharacterAssetId } : {}),
    stops: toStopInputs(game),
  };
}

/**
 * Persists `game` to the server and returns the canonical server version —
 * or `null` when the server cannot take it (unreachable, unknown stops, not
 * the owner). Never throws: the caller has already written the local copy.
 */
async function pushGame(game: HuntGame): Promise<{ dto: HuntDto; entry: SyncEntry } | null> {
  if (!isApiConfigured()) return null;
  try {
    const existingId = await serverIdFor(game.id);
    let dto: HuntDto;
    let entry: SyncEntry;

    const known = existingId !== game.id ? await tryGetHunt(existingId) : await tryGetHunt(game.id);
    if (known) {
      dto = await huntsApi.update(game.id === known.id ? known.id : existingId, toUpdateInput(game));
      entry = (await entryFor(game.id)) ?? { serverId: dto.id, chars: {} };
    } else {
      dto = await huntsApi.create(toCreateInput(game));
      entry = { serverId: dto.id, chars: {} };
    }

    // Both sides sequence their stops 1:n, so order is the join key.
    const localOrdered = [...game.characters].sort((a, b) => a.order - b.order);
    const serverOrdered = [...dto.characters].sort((a, b) => a.order - b.order);
    const chars: Record<string, string> = {};
    localOrdered.forEach((local, index) => {
      const server = serverOrdered[index];
      if (server) chars[local.id] = server.id;
    });
    entry = { serverId: dto.id, chars: { ...entry.chars, ...chars } };

    // `publish` above already published when a route existed; for an update the
    // explicit publish deals a fresh route — every local Save deals one too
    // (teams already walking keep their pinned route, on both sides).
    if (game.route?.length && dto.status !== 'PUBLISHED') {
      dto = await huntsApi.publish(entry.serverId);
    }

    // Persist the id mapping first — even if the publish below fails, later
    // calls must find the server hunt instead of creating a duplicate.
    const map = await readSyncMap();
    map[game.id] = entry;
    await writeSyncMap(map);

    // `known` means this was an UPDATE: re-publish so every Save deals a fresh
    // route, exactly like the local `normaliseGame` does (teams already walking
    // keep their pinned route on both sides — plan/§types.hunt guarantees).
    if (known && game.route?.length) {
      try {
        dto = await huntsApi.publish(entry.serverId);
      } catch (err) {
        console.warn('[hunts] publish skipped:', err);
      }
    }
    return { dto, entry };
  } catch (err) {
    console.warn('[hunts] server sync skipped (staying device-local):', err);
    return null;
  }
}

async function tryGetHunt(serverId: string): Promise<HuntDto | null> {
  try {
    return await huntsApi.get(serverId);
  } catch {
    return null;
  }
}

/** Writes the canonical server version back into the local cache (id-translated). */
async function mirrorGame(
  game: HuntGame,
  dto: HuntDto,
  entry: SyncEntry,
): Promise<void> {
  const mapped = dtoToHuntGame(dto, game.id, entry);
  await localGameRepository.saveGame({ ...mapped, route: mapped.route ?? game.route });
  // Keep the caller's in-memory object on the server's dealt order so the
  // progress it saves next (joinGame) pins the same route the server will expect.
  if (mapped.route) game.route = [...mapped.route];
}

// ---------------------------------------------------------------------------
// Progress shadow sync
// ---------------------------------------------------------------------------

/**
 * Mirrors a locally-validated discovery to the server: idempotent join (creates
 * the participant and pins this team's server-side route), then one `discover`
 * per stop the server has not seen yet, carrying the stop's key.
 *
 * Questions are attested rather than re-sent — the answers live in the AR UI,
 * which already ran the local gate; the server still decides order, join state,
 * completion and the key (see `hunt-gate.service.ts` on omitted `answers`).
 * Any refusal (unreachable, unpublished, out of order, wrong key) stops the
 * shadow and leaves the round on this device; it never rolls back the UI.
 */
async function shadowSync(progress: HuntProgress): Promise<void> {
  if (!isApiConfigured()) return;
  try {
    const game = await localGameRepository.getGame(progress.gameId);
    let entry = await entryFor(progress.gameId);

    // How to name this hunt to the server.
    //
    // A device that *created* the hunt has a sync-map entry pointing at the
    // server UUID. A device that received it as a share payload has no such
    // entry — its `gameId` is a local counter ("0") that means nothing to the
    // server, and joining by it 404s. Asking by the hunt's **share code** works
    // from anywhere, because that code travels inside the payload. Without this
    // branch a guest on another device silently produced no server row at all,
    // and the creator's progress report stayed empty for exactly the players a
    // hunt is advertised to.
    const reference: { huntId?: string; shareCode?: string } = entry?.serverId
      ? { huntId: entry.serverId }
      : game?.shareCode
        ? { shareCode: game.shareCode }
        : {};
    if (!reference.huntId && !reference.shareCode) return; // device-local hunt

    const joinTarget = reference.huntId ?? (await serverIdFor(progress.gameId));
    // No session is not a reason to skip: an anonymous player's round is exactly
    // the one the creator's report needs, and their guest token is what
    // identifies it. `readGuestToken` returns null for a signed-in player, in
    // which case the token field is simply omitted.
    const guestToken = joinTarget ? await readGuestToken(joinTarget) : null;

    const joined = await huntsApi.join({
      ...reference,
      // The name this team chose at join time — sent on the idempotent join so
      // the server's participant row learns it even though the first join may
      // have happened before this field existed.
      ...(progress.teamName ? { teamName: progress.teamName } : {}),
      ...(guestToken ? { guestToken } : {}),
    });
    // First join of a guest's life: the server issues the token, keep it.
    const serverId = entry?.serverId ?? joined.id;
    if (joined.guestToken) await writeGuestToken(serverId, joined.guestToken);

    // A device playing from a payload has no id mapping yet, so build one now:
    // both sides list their stops in authored order 1:n, and order is the join
    // key (the same correspondence `dtoToHuntGame` uses). Without it every
    // later `discover` would send a local character id the server has never
    // heard of, and no checkpoint would ever be recorded.
    if (!entry && game) {
      entry = {
        serverId,
        chars: matchCharactersByOrder(game, joined.characters ?? []),
      };
      const map = await readSyncMap();
      map[progress.gameId] = entry;
      await writeSyncMap(map);
    }

    const serverProgress = await huntsApi.progress(serverId, joined.guestToken ?? undefined);
    const known = new Set(toLocalIds(serverProgress.discoveredCharacterIds, entry));
    const pending = progress.discoveredCharacterIds.filter((id) => !known.has(id));
    if (pending.length === 0) return;

    for (const localCharId of pending) {
      const character = game?.characters.find((ch) => ch.id === localCharId);
      try {
        const updated = await huntsApi.discover(serverId, {
          nodeId: toServerCharId(localCharId, entry),
          ...(character?.key ? { key: character.key } : {}),
          // The same token identifies the guest on the gate call as on join.
          ...(joined.guestToken ? { guestToken: joined.guestToken } : {}),
        });
        await localGameRepository.saveProgress({
          gameId: progress.gameId,
          joinedAt: updated.joinedAt,
          discoveredCharacterIds: toLocalIds(updated.discoveredCharacterIds, entry),
          ...(updated.route && updated.route.length > 0
            ? { route: toLocalIds(updated.route, entry) }
            : {}),
          ...(progress.teamName ? { teamName: progress.teamName } : {}),
          status: updated.status,
          completedAt: updated.completedAt ?? null,
        });
      } catch (err) {
        console.warn('[hunts] server discovery skipped:', err);
        break;
      }
    }
  } catch (err) {
    console.warn('[hunts] progress shadow sync skipped:', err);
  }
}

/**
 * Local character id → server hunt-node id, matched by authored order.
 *
 * Both sides sequence their stops 1:n, so position is the correspondence. This
 * is what lets a device that received a hunt as a share payload address the
 * server's own nodes for it — the payload's ids are local and meaningless to the
 * API.
 */
function matchCharactersByOrder(
  game: HuntGame,
  serverCharacters: HuntCharacterDto[],
): Record<string, string> {
  const local = [...game.characters].sort((a, b) => a.order - b.order);
  const server = [...serverCharacters].sort((a, b) => a.order - b.order);
  const chars: Record<string, string> = {};
  local.forEach((character, index) => {
    const match = server[index];
    if (match) chars[character.id] = match.id;
  });
  return chars;
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

export const remoteGameRepository: GameRepository = {
  /**
   * Write-through: the local cache is updated first (so the creator's screen
   * and any offline reader see the save immediately), then the server is
   * pushed and its canonical answer (dealt route included) mirrored back.
   */
  async saveGame(game) {
    await localGameRepository.saveGame(game);
    const pushed = await pushGame(game);
    if (pushed) await mirrorGame(game, pushed.dto, pushed.entry);
  },

  async getGame(id) {
    if (isApiConfigured()) {
      const entry = await entryFor(id);
      try {
        const dto = await huntsApi.get(entry?.serverId ?? id);
        const mapped = dtoToHuntGame(dto, id, entry);
        await localGameRepository.saveGame(mapped);
        return mapped;
      } catch {
        // 404 (never synced / unknown) or unreachable — the cache decides.
      }
    }
    return localGameRepository.getGame(id);
  },

  /**
   * Server list first (`?mine=true`), each row written into the local cache in
   * the right id space: a hunt this device created refreshes its local twin
   * (so no duplicate appears), a hunt born elsewhere is stored under its UUID.
   * The merged view is then whatever the local store holds — it is never a
   * subset of the server's, so an unreachable server still lists everything.
   */
  async listGames() {
    if (isApiConfigured()) {
      try {
        const page = await huntsApi.list({ mine: true });
        const map = await readSyncMap();
        const twins = new Map(
          Object.entries(map).map(([localId, e]) => [e.serverId, [localId, e] as const]),
        );
        for (const dto of page.items) {
          const twin = twins.get(dto.id);
          if (twin) {
            await localGameRepository.saveGame(dtoToHuntGame(dto, twin[0], twin[1]));
          } else {
            await localGameRepository.saveGame(dtoToHuntGame(dto, dto.id, null));
          }
        }
      } catch (err) {
        console.warn('[hunts] server list skipped:', err);
      }
    }
    return localGameRepository.listGames(); // sorted by updatedAt, desc
  },

  async deleteGame(id) {
    if (isApiConfigured()) {
      try {
        await huntsApi.remove(await serverIdFor(id));
      } catch (err) {
        console.warn('[hunts] server delete skipped:', err);
      }
    }
    const map = await readSyncMap();
    delete map[id];
    await writeSyncMap(map);
    await localGameRepository.deleteGame(id);
  },

  async saveProgress(progress) {
    await localGameRepository.saveProgress(progress);
    await shadowSync(progress);
  },

  async getProgress(gameId) {
    if (isApiConfigured()) {
      const entry = await entryFor(gameId);
      const serverId = entry?.serverId ?? gameId;
      try {
        // A guest's own round is addressed by their token, so this call is made
        // signed-out too — which is the whole point of the guest token.
        const dto = await huntsApi.progress(serverId, (await readGuestToken(serverId)) ?? undefined);
        // A participant row written before the join prompt existed has no name;
        // keep the one this device collected rather than dropping it.
        const teamName =
          dto.teamName ?? (await localGameRepository.getProgress(gameId))?.teamName;
        const translated: HuntProgress = {
          gameId,
          joinedAt: dto.joinedAt,
          discoveredCharacterIds: toLocalIds(dto.discoveredCharacterIds, entry),
          ...(dto.route && dto.route.length > 0
            ? { route: toLocalIds(dto.route, entry) }
            : {}),
          ...(teamName ? { teamName } : {}),
          status: dto.status,
          completedAt: dto.completedAt ?? null,
        };
        await localGameRepository.saveProgress(translated);
        return translated;
      } catch {
        // Not a member yet, unknown, or offline — the cache decides.
      }
    }
    return localGameRepository.getProgress(gameId);
  },

  async deleteProgress(gameId) {
    // The API has no endpoint that clears a participant's round — the server
    // keeps its authoritative record — so only the local cache copy is dropped.
    await localGameRepository.deleteProgress(gameId);
  },

  // Active-hunt pointer is a per-device UI concern; it stays local always.
  getActiveGameId: () => localGameRepository.getActiveGameId(),
  setActiveGameId: (gameId) => localGameRepository.setActiveGameId(gameId),
};




