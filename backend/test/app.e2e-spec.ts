import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';

/**
 * End-to-end walkthrough of the plan's §16 list against the real MySQL
 * database (migrations applied, seed present): register → login → profile →
 * authoritative completion (award / duplicate / radius) → create & join hunt.
 *
 * The harness mirrors `main.ts` — global prefix, whitelist ValidationPipe and
 * the unified error filter — so every status code asserted here is the same
 * one a real client sees.
 */
describe('API e2e — register, login, profile, completion, hunts', () => {
  let app: INestApplication;

  const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e_${suffix}@example.com`;
  const username = `e2e_${suffix}`;
  const password = 'e2e-password-1';

  let accessToken = '';
  let refreshToken = '';

  /** node_01_chapel's seeded coordinates; radius 10 m. */
  const CHAPEL = { latitude: 37.774929, longitude: -122.419416 };
  const OUTSIDE = { latitude: 37.785, longitude: -122.419416 };

  const http = () => request(app.getHttpServer());

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  after(async () => {
    await app?.close();
  });

  it('register → 201 with tokens and the fresh user', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, username, password, displayName: 'E2E Pilot' })
      .expect(201);
    assert.ok(res.body.accessToken, 'accessToken present');
    assert.ok(res.body.refreshToken, 'refreshToken present');
    assert.equal(typeof res.body.expiresIn, 'number');
    assert.equal(res.body.user.email, email);
    assert.equal(res.body.user.username, username);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('registering the same email again → 409 with the envelope', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, username: `other_${suffix}`, password })
      .expect(409);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.code === 'CONFLICT' || res.body.error.code === 'EMAIL_TAKEN');
  });

  it('login with the wrong password → 401, right password → 200', async () => {
    const bad = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: 'definitely-wrong-1' })
      .expect(401);
    assert.equal(bad.body.success, false);

    const good = await http()
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    assert.ok(good.body.accessToken);
    accessToken = good.body.accessToken;
    refreshToken = good.body.refreshToken;
  });

  it('refresh rotates the token pair', async () => {
    const res = await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    assert.ok(res.body.accessToken);
    assert.notEqual(res.body.refreshToken, refreshToken);
    accessToken = res.body.accessToken;
    refreshToken = res.body.refreshToken;
  });

  it('GET /auth/me, /users/me and /progress describe the signed-in player', async () => {
    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    assert.equal(me.body.username, username);

    const profile = await http()
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    assert.equal(profile.body.progress.level, 1);
    assert.equal(profile.body.progress.totalXp, 0);

    const progress = await http()
      .get('/api/v1/progress')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    assert.equal(progress.body.completedQuests, 0);
    assert.ok(progress.body.xpForNextLevel > 0);
  });

  it('protected routes reject anonymous callers with 401, not 500', async () => {
    for (const path of ['/api/v1/auth/me', '/api/v1/progress', '/api/v1/inventory', '/api/v1/hunts']) {
      const res = await http().get(path).expect(401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
  });

  it('GET /quests serves the seeded catalogue', async () => {
    const res = await http().get('/api/v1/quests').expect(200);
    assert.ok(res.body.total >= 6, `expected ≥6 nodes, got ${res.body.total}`);
    const first = res.body.items.find((node: { id: string }) => node.id === 'node_01_chapel');
    assert.ok(first, 'node_01_chapel present');
    assert.equal(typeof first.xpReward, 'number');
  });

  it('POST /quests/:id/complete inside the radius → 201 with authoritative XP + badge + item', async () => {
    const res = await http()
      .post('/api/v1/quests/node_01_chapel/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(CHAPEL)
      .expect(201);
    assert.equal(res.body.status, 'COMPLETED');
    assert.equal(res.body.xpEarned, 150);
    assert.equal(res.body.totalXp, 150);
    assert.equal(res.body.newBadge.id, 'badge_first_step');
    assert.equal(res.body.newItem.id, 'item_azure_shard');
    assert.ok(res.body.distanceMeters <= 10);
  });

  it('a second completion of the same quest → 409 QUEST_ALREADY_COMPLETED (no double XP)', async () => {
    const res = await http()
      .post('/api/v1/quests/node_01_chapel/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(CHAPEL)
      .expect(409);
    assert.equal(res.body.error.code, 'QUEST_ALREADY_COMPLETED');
  });

  it('completing from outside the radius → 422 OUTSIDE_QUEST_RADIUS with the distance', async () => {
    const res = await http()
      .post('/api/v1/quests/node_02_cloister/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(OUTSIDE)
      .expect(422);
    assert.equal(res.body.error.code, 'OUTSIDE_QUEST_RADIUS');
    assert.ok(res.body.error.details.distanceMeters > 100);
  });

  it('client-supplied XP is rejected by the whitelist → 400', async () => {
    const res = await http()
      .post('/api/v1/quests/node_02_cloister/complete')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ ...CHAPEL, xp: 9999 })
      .expect(400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  let huntId = '';
  let shareCode = '';
  let publishedRoute: string[] = [];
  /** This hunt's stop ids in authored order, kept for the reorder assertions. */
  let huntStopIds: string[] = [];

  it('POST /hunts creates a draft from catalogue nodes → 201', async () => {
    const res = await http()
      .post('/api/v1/hunts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'E2E Pilgrim Walk',
        description: 'Three stops, one treasure.',
        nodeIds: ['node_01_chapel', 'node_02_cloister', 'node_03_belltower'],
      })
      .expect(201);
    assert.equal(res.body.status, 'DRAFT');
    assert.equal(res.body.characters.length, 3);
    huntId = res.body.id;
    shareCode = res.body.shareCode;
    assert.ok(huntId && shareCode);
    huntStopIds = res.body.characters.map((character: { id: string }) => character.id);
  });

  it('POST /hunts/:id/publish → PUBLISHED with a dealt route', async () => {
    const publish = await http()
      .post(`/api/v1/hunts/${huntId}/publish`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(201);
    assert.equal(publish.body.status, 'PUBLISHED');
    assert.ok(Array.isArray(publish.body.route));
    assert.equal(publish.body.route.length, 3);
    shareCode = publish.body.shareCode;
    publishedRoute = publish.body.route;
  });

  // ---------------------------------------------------------------------------
  // Reordering stops (PATCH /hunts/:id/stops/order)
  //
  // The interesting property is not "the order changed" but "nothing else did":
  // `HuntNode` carries `@@unique([huntId, sequence])`, so the write has to dodge a
  // mid-update collision, and a reorder must not disturb a hunt that is already
  // published or a team already walking it.
  // ---------------------------------------------------------------------------

  /** This hunt's stops, re-read fresh (ids and authored order as the server sees them). */
  const fetchStops = async () => {
    const res = await http()
      .get(`/api/v1/hunts/${huntId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    return res.body.characters as { id: string; order: number }[];
  };

  it('PATCH /hunts/:id/stops/order rotates the stops → 200 with the new order', async () => {
    // A full rotation, not a swap: every stop moves, and the write collides with
    // `@@unique([huntId, sequence])` on the very first row if it is not two-phase.
    const rotated = [...huntStopIds.slice(1), huntStopIds[0]];
    const res = await http()
      .patch(`/api/v1/hunts/${huntId}/stops/order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nodeIds: rotated })
      .expect(200);

    assert.deepEqual(
      res.body.characters.map((character: { id: string }) => character.id),
      rotated,
    );
    // 1..n, dense — no negative residue from the parking phase.
    assert.deepEqual(
      res.body.characters.map((character: { order: number }) => character.order),
      [1, 2, 3],
    );
  });

  it('the rotated order survives a re-read (it is the DB, not just the response)', async () => {
    const stops = await fetchStops();
    const ids = stops.map(stop => stop.id);
    assert.deepEqual(ids, [...huntStopIds.slice(1), huntStopIds[0]]);
    assert.deepEqual(
      stops.map(stop => stop.order),
      [1, 2, 3],
    );
    // Restore the original order so the join/gate steps below run on it.
    await http()
      .patch(`/api/v1/hunts/${huntId}/stops/order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nodeIds: huntStopIds })
      .expect(200);
  });

  it('a partial list → 422 VALIDATION_ERROR and the order is untouched', async () => {
    // The common client mistake: send only the stops that moved. Accepting this
    // would strand the rest at their old positions (duplicate `sequence`) or
    // renumber stops the caller never mentioned.
    const res = await http()
      .patch(`/api/v1/hunts/${huntId}/stops/order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nodeIds: [huntStopIds[1], huntStopIds[0]] })
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    const stops = await fetchStops();
    assert.deepEqual(
      stops.map(stop => stop.id),
      huntStopIds,
    );
  });

  it('a duplicated stop → 422 and the order is untouched', async () => {
    // Right length, all-known ids: the case a naive "same size + all known"
    // check would pass while silently dropping the third stop.
    const res = await http()
      .patch(`/api/v1/hunts/${huntId}/stops/order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nodeIds: [huntStopIds[0], huntStopIds[0], huntStopIds[1]] })
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');

    const stops = await fetchStops();
    assert.deepEqual(
      stops.map(stop => stop.id),
      huntStopIds,
    );
  });

  it('an unknown stop id → 422 (one hunt can never be reordered with another’s stops)', async () => {
    const res = await http()
      .patch(`/api/v1/hunts/${huntId}/stops/order`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ nodeIds: [huntStopIds[0], huntStopIds[1], 'not-a-stop-of-this-hunt'] })
      .expect(422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
  });

  it('reordering keeps the published route and the hunt published', async () => {
    // Rule 2: a share link already in players' hands must keep describing the
    // hunt they joined, so an authoring edit is not a re-publish.
    const res = await http()
      .get(`/api/v1/hunts/${huntId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    assert.equal(res.body.status, 'PUBLISHED');
    assert.deepEqual(res.body.route, publishedRoute);
  });

  it('GET /hunts/:id/progress before joining → 403 HUNT_NOT_JOINED', async () => {
    const res = await http()
      .get(`/api/v1/hunts/${huntId}/progress`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    assert.equal(res.body.error.code, 'HUNT_NOT_JOINED');
  });

  it('POST /hunts/join by share code → the hunt (idempotent on retry)', async () => {
    const res = await http()
      .post('/api/v1/hunts/join')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shareCode, teamName: 'The Pilgrims' })
      .expect(201);
    assert.equal(res.body.id, huntId);

    const again = await http()
      .post('/api/v1/hunts/join')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shareCode, teamName: 'The Pilgrims' })
      .expect(201);
    assert.equal(again.body.id, huntId);

    const progress = await http()
      .get(`/api/v1/hunts/${huntId}/progress`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    assert.equal(progress.body.status, 'active');
    assert.equal(progress.body.discoveredCharacterIds.length, 0);
    // The name given on the join screen travels with the participant.
    assert.equal(progress.body.teamName, 'The Pilgrims');
    // `route` is the dealt stop order pinned at join: all 3 authored stops,
    // with the dealt order starting where the published deal left it.
    assert.equal(progress.body.route.length, 3);
    const published = new Set(publishedRoute);
    assert.ok(
      progress.body.route.every((id: string) => published.has(id)),
      'pinned route holds the same stops as the published deal',
    );
  });

  it('re-joining under a new team name renames it without moving the round', async () => {
    const before = await http()
      .get(`/api/v1/hunts/${huntId}/progress`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    await http()
      .post('/api/v1/hunts/join')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ shareCode, teamName: 'Pilgrim Squad' })
      .expect(201);

    const after = await http()
      .get(`/api/v1/hunts/${huntId}/progress`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    assert.equal(after.body.teamName, 'Pilgrim Squad');
    // A name is cosmetic; the round pinned under it is not.
    assert.deepEqual(after.body.route, before.body.route, 'route untouched by a rename');
    assert.deepEqual(
      after.body.discoveredCharacterIds,
      before.body.discoveredCharacterIds,
      'discoveries untouched by a rename',
    );
    assert.equal(after.body.joinedAt, before.body.joinedAt, 'same original membership');
  });

  it('a player who joins without naming a team falls back to their username', async () => {
    const otherSuffix = `${suffix}_b`;
    const otherUser = `e2e_${otherSuffix}`;
    const registered = await http()
      .post('/api/v1/auth/register')
      .send({
        email: `e2e_${otherSuffix}@example.com`,
        username: otherUser,
        password,
      })
      .expect(201);

    await http()
      .post('/api/v1/hunts/join')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .send({ shareCode })
      .expect(201);

    const progress = await http()
      .get(`/api/v1/hunts/${huntId}/progress`)
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);
    assert.equal(progress.body.teamName, otherUser);
  });

  it('unknown routes answer the unified 404 envelope', async () => {
    const res = await http()
      .get('/api/v1/hunts/does-not-exist')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    assert.ok(typeof res.body.timestamp === 'string');
    assert.ok(typeof res.body.path === 'string');
  });

  /**
   * Creator-placed locations.
   *
   * A `HuntNode` cannot exist without a `QuestNode`, because that row is where a
   * place's coordinates, radius and clue live. So a hunt built on an arbitrary
   * location used to be unstorable: `POST /hunts` answered 404 and the hunt
   * stayed on the device — invisible to the creator's own progress report, which
   * is the whole reason this exists.
   */
  describe('creator-placed locations', () => {
    /** Bengaluru-ish coordinates; nothing here is ever walked in a test. */
    const CUSTOM_ONE = { latitude: 12.971599, longitude: 77.594566 };

    it('a hunt on a location the catalogue lacks is stored, not refused', async () => {
      const res = await http()
        .post('/api/v1/hunts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Custom Place Hunt',
          publish: true,
          stops: [
            {
              questNodeId: 'char_e2e_custom_1',
              characterType: 'guardian',
              key: 'A3QESS',
              title: 'The Arch',
              subtitle: 'a creator-placed place',
              clue: 'Look under the arch.',
              radiusMeters: 75,
              ...CUSTOM_ONE,
            },
          ],
        })
        .expect(201);

      assert.equal(res.body.status, 'PUBLISHED', 'and it publishes like any other');
      const stop = res.body.characters[0];
      // The place survives the round trip — this is what makes the stop playable.
      assert.equal(stop.name, 'The Arch');
      assert.equal(stop.hint, 'Look under the arch.');
      assert.equal(stop.radiusMeters, 75);
      assert.equal(Number(stop.latitude), CUSTOM_ONE.latitude);
      assert.equal(Number(stop.longitude), CUSTOM_ONE.longitude);
    });

    it('a custom place is registered once, not once per save', async () => {
      const before = await http()
        .get('/api/v1/quests')
        .query({ includeInactive: true, limit: 100 })
        .expect(200);

      await http()
        .post('/api/v1/hunts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Re-save Custom',
          publish: true,
          stops: [
            {
              questNodeId: 'char_e2e_custom_1',
              characterType: 'guardian',
              title: 'The Arch (moved)',
              ...CUSTOM_ONE,
              latitude: 13.1,
              longitude: 77.7,
              radiusMeters: 120,
            },
          ],
        })
        .expect(201);

      const after = await http()
        .get('/api/v1/quests')
        .query({ includeInactive: true, limit: 100 })
        .expect(200);

      assert.equal(
        after.body.total,
        before.body.total,
        'the same place is updated in place, not duplicated',
      );
      const place = after.body.items.find(
        (q: { slug: string }) => q.slug.endsWith('char_e2e_custom_1'),
      );
      assert.equal(place.title, 'The Arch (moved)', 'and the move is kept');
      assert.equal(Number(place.latitude), 13.1);
      assert.equal(place.radiusMeters, 120);
    });

    it('registered places stay out of the public quest catalogue', async () => {
      const publicList = await http().get('/api/v1/quests').query({ limit: 100 }).expect(200);
      const leaked = publicList.body.items.filter((q: { slug: string }) =>
        q.slug.startsWith('creator_'),
      );
      assert.equal(leaked.length, 0, 'a hunt location is not a public quest');

      // …and it is explicitly inactive, which is what keeps it out.
      const all = await http()
        .get('/api/v1/quests')
        .query({ includeInactive: true, limit: 100 })
        .expect(200);
      const mine = all.body.items.filter((q: { slug: string }) => q.slug.startsWith('creator_'));
      assert.ok(mine.length > 0, 'it does exist, just not publicly');
      assert.ok(
        mine.every((q: { isActive: boolean }) => q.isActive === false),
        'registered as inactive',
      );
    });

    it('a catalogue stop ignores client-supplied coordinates', async () => {
      // Otherwise any client could move a shared landmark for everyone.
      const res = await http()
        .post('/api/v1/hunts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Catalogue Stop With Bogus Coords',
          publish: true,
          stops: [
            {
              questNodeId: 'node_01_chapel',
              characterType: 'guardian',
              title: 'HIJACKED',
              latitude: 10,
              longitude: 10,
            },
          ],
        })
        .expect(201);

      const stop = res.body.characters[0];
      assert.equal(stop.name, 'Chapel of St. Francis', 'the catalogue is authoritative');
      assert.equal(Number(stop.latitude), 37.774929, 'coordinates unchanged');
    });

    it('an unknown location with no coordinates is still a clear 404', async () => {
      const res = await http()
        .post('/api/v1/hunts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'No Coordinates',
          stops: [{ questNodeId: 'char_e2e_orphan_1', characterType: 'guardian' }],
        })
        .expect(404);

      assert.equal(res.body.error.code, 'NOT_FOUND');
      assert.match(res.body.error.message, /latitude and longitude/);
    });

    it('out-of-range coordinates are rejected rather than clamped', async () => {
      await http()
        .post('/api/v1/hunts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Bad Coordinates',
          stops: [
            { questNodeId: 'char_e2e_bad_1', characterType: 'guardian', latitude: 999, longitude: 0 },
          ],
        })
        .expect(400);
    });
  });

  describe('share links — shortening an invite', () => {
    /** Long enough to be a real invite, short enough to read in a test. */
    const payload = 'A'.repeat(200);
    const longTarget = `https://hunt.example.test/games#join=${payload}`;
    const strippedTarget = `/games#join=${payload}`;
    /** The alphabet hunts and links share (see `common/utils/short-code.ts`). */
    const CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

    it('POST /links → 201 with a 6-character code and an origin-stripped target', async () => {
      const res = await http().post('/api/v1/links').send({ target: longTarget }).expect(201);
      assert.match(res.body.code, CODE, 'six characters from the shared alphabet');
      assert.equal(res.body.target, strippedTarget, 'only the path + fragment are stored');
    });

    it('shortening the same link twice reuses its code rather than minting another', async () => {
      const first = await http().post('/api/v1/links').send({ target: longTarget }).expect(201);
      const second = await http().post('/api/v1/links').send({ target: longTarget }).expect(201);
      assert.equal(second.body.code, first.body.code, 'same target → same code');
      assert.equal(second.body.target, first.body.target);
    });

    it('GET /links/:code → 200 with the stored target, needing no token at all', async () => {
      const minted = await http().post('/api/v1/links').send({ target: longTarget }).expect(201);
      // A brand-new browser opening a shared link has no session to present.
      const res = await http().get(`/api/v1/links/${minted.body.code}`).expect(200);
      assert.equal(res.body.code, minted.body.code);
      assert.equal(res.body.target, strippedTarget);
    });

    it('an unknown or malformed code answers 404 rather than 500', async () => {
      const unknown = await http().get('/api/v1/links/ZZZZZZ').expect(404);
      assert.equal(unknown.body.error.code, 'NOT_FOUND');
      // `code` is a VARCHAR(8) key: an over-long value must be caught before
      // MySQL is handed a row it cannot store.
      const tooLong = await http().get(`/api/v1/links/${'A'.repeat(300)}`).expect(404);
      assert.equal(tooLong.body.error.code, 'NOT_FOUND');
    });

    it('only http(s) targets are shortenable', async () => {
      const script = await http()
        .post('/api/v1/links')
        .send({ target: 'javascript:alert(1)' })
        .expect(400);
      assert.equal(script.body.error.code, 'VALIDATION_ERROR');
      await http().post('/api/v1/links').send({ target: 'not a url' }).expect(400);
    });
    it('the origin is dropped, so a stored link can never redirect off this app', async () => {
      const res = await http()
        .post('/api/v1/links')
        .send({ target: 'https://evil.example/games#join=whatever' })
        .expect(201);
      assert.equal(res.body.target, '/games#join=whatever', 'host discarded');

      // `//host` is the protocol-relative form a browser would follow off-site.
      const protocolRelative = await http()
        .post('/api/v1/links')
        .send({ target: 'https://hunt.example.test//evil.example/payload' })
        .expect(400);
      assert.equal(protocolRelative.body.error.code, 'VALIDATION_ERROR');
    });

    it('a request carrying unknown fields is rejected, not silently truncated', async () => {
      await http()
        .post('/api/v1/links')
        .send({ target: longTarget, httpOnlyCookieStealer: true })
        .expect(400);
    });
  });

  /**
   * The creator's progress report.
   *
   * The whole feature rests on one thing a guest used to be unable to do at all:
   * leave a server-side trace. So these specs drive it the way a real guest
   * would — no `Authorization` header on the playing side — and assert the
   * creator can then see them, name them, and read where they are and how long
   * they have taken.
   */
  describe('creator progress report — guests and checkpoints', () => {
    let guestToken = '';
    let reportHuntId = '';
    let reportShareCode = '';

    /** Joins `shareCode` with no auth header and returns the issued token. */
    async function joinAsGuest(
      code: string,
      teamName: string,
      existing?: string,
    ): Promise<string> {
      const res = await http()
        .post('/api/v1/hunts/join')
        .send({ shareCode: code, teamName, ...(existing ? { guestToken: existing } : {}) })
        .expect(201);
      assert.equal(typeof res.body.guestToken, 'string', 'guest is issued a token');
      return res.body.guestToken as string;
    }

    /** The guest's own round, read back the way their screen reads it. */
    async function guestProgress(token: string) {
      return (
        await http()
          .get(`/api/v1/hunts/${reportHuntId}/progress`)
          .query({ guestToken: token })
          .expect(200)
      ).body;
    }

    /** The creator's view of the report. */
    async function report() {
      return (
        await http()
          .get(`/api/v1/hunts/${reportHuntId}/players`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200)
      ).body;
    }

    /** Clears however many of `count` stops are next in the guest's own route. */
    async function clearNextStops(token: string, count: number): Promise<void> {
      for (let i = 0; i < count; i += 1) {
        const progress = await guestProgress(token);
        const discovered = new Set<string>(progress.discoveredCharacterIds);
        const next = (progress.route as string[]).find((id) => !discovered.has(id));
        assert.ok(next, 'a next stop exists while the route has one left');
        await http()
          .post(`/api/v1/hunts/${reportHuntId}/discover`)
          .send({ nodeId: next, guestToken: token })
          .expect(201);
      }
    }

    it('a creator publishes a fresh hunt for the report to follow', async () => {
      const created = await http()
        .post('/api/v1/hunts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Progress Report Hunt',
          stops: [
            { questNodeId: 'node_01_chapel' },
            { questNodeId: 'node_02_cloister' },
            { questNodeId: 'node_03_belltower' },
          ],
        })
        .expect(201);
      reportHuntId = created.body.id;

      const published = await http()
        .post(`/api/v1/hunts/${reportHuntId}/publish`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      reportShareCode = published.body.shareCode;
      assert.equal(published.body.characters.length, 3);
    });

    it('a guest joins with no account and gets a token back', async () => {
      guestToken = await joinAsGuest(reportShareCode, 'Nameless Wanderer');

      // The round is genuinely server-side now, which is the whole point.
      const progress = await guestProgress(guestToken);
      assert.equal(progress.teamName, 'Nameless Wanderer');
      assert.equal(progress.status, 'active');
    });

    it('re-joining with the same token returns the same round, not a second one', async () => {
      const first = await guestProgress(guestToken);
      await joinAsGuest(reportShareCode, 'Nameless Wanderer', guestToken);
      const second = await guestProgress(guestToken);
      assert.equal(second.joinedAt, first.joinedAt, 'one membership, not two');
    });

    it('clearing stops writes one timestamped checkpoint per stop', async () => {
      await clearNextStops(guestToken, 2);

      const guest = (await report()).items.find(
        (p: { teamName: string }) => p.teamName === 'Nameless Wanderer',
      );
      assert.ok(guest, 'the guest appears in the creator report');
      assert.equal(guest.isGuest, true, 'marked as a guest row');
      assert.equal(guest.accountUsername, null, 'with no account attached');
      assert.equal(guest.checkpoints.length, 2, 'one checkpoint per cleared stop');
      assert.equal(guest.stopsCleared, 2);
      assert.equal(guest.totalStops, 3);
      assert.equal(guest.completed, false);

      // Route positions are 1-based and ascending; elapsed never runs backwards.
      const positions = guest.checkpoints.map((c: { routePosition: number }) => c.routePosition);
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'ordered by route');
      assert.ok(positions.every((p: number) => p >= 1 && p <= 3), 'positions are 1-based');

      let previous = 0;
      for (const checkpoint of guest.checkpoints) {
        assert.ok(
          typeof checkpoint.reachedAt === 'string' &&
            !Number.isNaN(Date.parse(checkpoint.reachedAt)),
          'each checkpoint carries a real timestamp',
        );
        assert.equal(typeof checkpoint.elapsedMs, 'number');
        assert.ok(
          checkpoint.elapsedMs >= previous,
          'elapsed time never goes backwards along the route',
        );
        previous = checkpoint.elapsedMs;
      }

      // "Where they are stuck": the one stop they have not reached yet.
      assert.equal(guest.currentRoutePosition, 3, 'stuck on their third stop');
      assert.ok(guest.currentStopName, 'and the report names it');
    });

    it('a second guest is tracked separately, including where they are stuck', async () => {
      await joinAsGuest(reportShareCode, 'Silent Stranger');
      // Typed as the loose shape the HTTP body actually has, so the assertions
      // below read against real fields rather than a hand-picked subset.
      const items = (await report()).items as Record<string, any>[];
      const first = items.find((p) => p.teamName === 'Nameless Wanderer');
      const other = items.find((p) => p.teamName === 'Silent Stranger');
      assert.ok(other, 'the second guest is listed too');
      assert.equal(other.stopsCleared, 0, 'a fresh guest has cleared nothing');
      assert.equal(other.checkpoints.length, 0, 'and so has no timeline');
      assert.equal(other.currentRoutePosition, 1, 'stuck on their first stop');
      assert.notEqual(other.participantId, first?.participantId, 'distinct rows');
    });

    it('the summary counts every player, not just the page', async () => {
      const body = await report();
      // Two guests by this point: the wanderer mid-round and the stranger fresh.
      assert.equal(body.summary.totalJoined, 2);
      assert.equal(typeof body.summary.playingNow, 'number');
      assert.equal(
        body.summary.completed + body.summary.inProgress,
        body.summary.totalJoined,
        'every player is either finished or still going',
      );
      // The headline number and the rows it summarises must agree — a per-row
      // "playing now" dot that disagreed with the count would be a lie in one
      // of the two places.
      const liveRows = (body.items as Record<string, any>[]).filter((p) => p.isActive).length;
      assert.equal(liveRows, body.summary.playingNow, 'rows agree with the count');
    });

    it('finishing records a completion time and a whole-round duration', async () => {
      await clearNextStops(guestToken, 1); // the last stop

      const finisher = (await report()).items.find(
        (p: { teamName: string }) => p.teamName === 'Nameless Wanderer',
      );
      assert.equal(finisher.completed, true);
      assert.ok(finisher.completedAt, 'a completion timestamp exists');
      assert.equal(typeof finisher.totalElapsedMs, 'number', 'and a whole-round duration');
      assert.ok(finisher.totalElapsedMs >= 0);
      assert.equal(finisher.checkpoints.length, 3, 'every stop is on the timeline');
      // A finished player is not "playing now", however fresh the heartbeat is.
      assert.equal(finisher.isActive, false, 'a completed round is never counted as live');
    });

    it('a replayed discover does not double the timeline', async () => {
      // The offline queue re-sends a stop that already landed; the unique index
      // must turn that into a no-op rather than a second entry for one stop.
      const progress = await guestProgress(guestToken);
      const cleared = progress.discoveredCharacterIds as string[];
      const replayed = cleared[0];
      assert.ok(replayed, 'there is a cleared stop to replay');

      // The gate refuses an already-cleared stop on its own…
      const refused = await http()
        .post(`/api/v1/hunts/${reportHuntId}/discover`)
        .send({ nodeId: replayed, guestToken: guestToken })
        .expect(422);
      assert.ok(
        ['HUNT_COMPLETED', 'OUT_OF_ORDER_DISCOVERY'].includes(refused.body.error.code),
        'an already-cleared stop is refused',
      );

      // …and even if one slipped through, the count would not move.
      const guest = (await report()).items.find(
        (p: { teamName: string }) => p.teamName === 'Nameless Wanderer',
      );
      assert.equal(guest.checkpoints.length, 3, 'still one checkpoint per stop');
    });

    it('the report marks a signed-in player as linked to an account', async () => {
      await http()
        .post('/api/v1/hunts/join')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ shareCode: reportShareCode, teamName: 'The Account' })
        .expect(201);

      const linked = (await report()).items.find(
        (p: { teamName: string }) => p.teamName === 'The Account',
      );
      assert.equal(linked.isGuest, false);
      assert.equal(linked.accountUsername, username, 'the account is identified');
    });

    it('a signed-in join never returns a guest token', async () => {
      const res = await http()
        .post('/api/v1/hunts/join')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ shareCode: reportShareCode, teamName: 'The Account' })
        .expect(201);
      assert.equal(res.body.guestToken, undefined, 'an account is its own identity');
    });

    it('a session wins over a presented guest token, so one cannot borrow a round', async () => {
      // The account-holder presents the guest's token: the request must land on
      // *their* row, never the guest's.
      const mine = (
        await http()
          .get(`/api/v1/hunts/${reportHuntId}/progress`)
          .set('Authorization', `Bearer ${accessToken}`)
          .query({ guestToken })
          .expect(200)
      ).body;
      assert.equal(mine.teamName, 'The Account', 'session identity wins');

      // And the guest's own round is untouched by that attempt.
      const theirs = await guestProgress(guestToken);
      assert.equal(theirs.teamName, 'Nameless Wanderer');
      assert.equal(theirs.status, 'completed');
    });

    it('the report is author-only: another player gets 403, an anonymous one 401', async () => {
      const otherSuffix = `${suffix}_report`;
      const registered = await http()
        .post('/api/v1/auth/register')
        .send({
          email: `e2e_${otherSuffix}@example.com`,
          username: `e2e_${otherSuffix}`,
          password,
        })
        .expect(201);

      const forbidden = await http()
        .get(`/api/v1/hunts/${reportHuntId}/players`)
        .set('Authorization', `Bearer ${registered.body.accessToken}`)
        .expect(403);
      assert.equal(forbidden.body.error.code, 'FORBIDDEN');

      // A guest cannot read the report either — it exposes other people's rounds.
      await http().get(`/api/v1/hunts/${reportHuntId}/players`).expect(401);
    });

    it('a malformed guest token is rejected, not treated as a lookup', async () => {
      const res = await http()
        .post('/api/v1/hunts/join')
        .send({ shareCode: reportShareCode, guestToken: 'not-a-real-token' })
        .expect(400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');

      // On the query route it simply matches nobody — no 500 from the database.
      await http()
        .get(`/api/v1/hunts/${reportHuntId}/progress`)
        .query({ guestToken: 'not-a-real-token' })
        .expect(403);
    });

    it('discovering without any identity at all → 403, not a crash', async () => {
      const res = await http()
        .post(`/api/v1/hunts/${reportHuntId}/discover`)
        .send({ nodeId: 'node_01_chapel' })
        .expect(403);
      assert.equal(res.body.error.code, 'HUNT_NOT_JOINED');
    });

  /**
   * Live player location — the creator's map.
   *
   * Reported unconditionally while a round is in progress, so these assertions
   * are about what is *bounded* rather than what is permitted: a creator can
   * only read positions for a hunt they created, can never recover where
   * anybody walked, and can never see a team that has not yet reported one.
   */
  describe('live player location — unconditional, last-fix-only, author-only', () => {
    const HERE = { latitude: 37.7749, longitude: -122.4194 };
    const THERE = { latitude: 37.785, longitude: -122.41 };
    let mapHuntId = '';
    let guestToken = '';
    let otherToken = '';

    const report = async (
      huntId: string,
      token: string,
      body: Record<string, unknown>,
      expected = 201,
    ) =>
      http()
        .post(`/api/v1/hunts/${huntId}/location`)
        .send({ ...body, guestToken: token })
        .expect(expected);

    /** Every player row the creator can see. */
    const rows = async () => {
      const res = await http()
        .get(`/api/v1/hunts/${mapHuntId}/players`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      return res.body.items as {
        teamName: string | null;
        latitude: number | null;
        longitude: number | null;
        locationAt: string | null;
      }[];
    };

    /** The row for one named team. */
    const rowFor = async (teamName: string) => {
      const found = (await rows()).find(player => player.teamName === teamName);
      assert.ok(found, `a row for ${teamName}`);
      return found;
    };

    it('a creator publishes a hunt and two guests join it', async () => {
      const hunt = await http()
        .post('/api/v1/hunts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          title: 'Location Map Walk',
          nodeIds: ['node_01_chapel', 'node_02_cloister'],
          publish: true,
        })
        .expect(201);
      mapHuntId = hunt.body.id;

      // Guests join with no session at all — the realistic case, since most
      // players arrive from a share link.
      const first = await http()
        .post('/api/v1/hunts/join')
        .send({ shareCode: hunt.body.shareCode, teamName: 'Pilgrims' })
        .expect(201);
      guestToken = first.body.guestToken;

      const second = await http()
        .post('/api/v1/hunts/join')
        .send({ shareCode: hunt.body.shareCode, teamName: 'Wardens' })
        .expect(201);
      otherToken = second.body.guestToken;

      assert.ok(guestToken && otherToken, 'both guests got a token');
    });

    it('a team that has not pinged yet has no position to show', async () => {
      // Sharing is unconditional, but a position only exists once the first ping
      // lands — so a just-joined team is absent from the map rather than
      // misplaced at some default coordinate.
      const row = await rowFor('Wardens');
      assert.equal(row.latitude, null);
      assert.equal(row.longitude, null);
      assert.equal(row.locationAt, null);
    });

    it('a reported position is stored and shown to the creator immediately', async () => {
      // No consent step, no flag: one ping is enough to put the team on the map.
      await report(mapHuntId, guestToken, HERE);

      const shown = await rowFor('Pilgrims');
      assert.equal(Number(shown.latitude), HERE.latitude);
      assert.equal(Number(shown.longitude), HERE.longitude);
      assert.ok(shown.locationAt, 'stamped with the server clock');
    });

    it('every team that reports appears — several on one map at a time', async () => {
      // The creator's map is explicitly multi-player, so a second team must be
      // able to appear alongside the first rather than replacing it.
      const before = (await rows()).filter(player => player.latitude !== null).length;
      assert.equal(before, 1, 'only the Pilgrims have reported so far');

      await report(mapHuntId, otherToken, THERE);

      const withFix = (await rows()).filter(player => player.latitude !== null);
      assert.equal(withFix.length, 2, 'both teams are on the map at once');
      assert.deepEqual(
        withFix.map(player => Number(player.latitude)).sort(),
        [HERE.latitude, THERE.latitude].sort(),
      );
    });

    it('the fix is OVERWRITTEN, never appended — no trail of where people walked', async () => {
      await report(mapHuntId, guestToken, THERE);

      const moved = await rowFor('Pilgrims');
      assert.equal(Number(moved.latitude), THERE.latitude, 'now the second fix');
      assert.equal(Number(moved.longitude), THERE.longitude);

      // Move back; the store must hold the latest fix and nothing else. The
      // schema has exactly one coordinate slot per participant, so a trail is
      // not merely unexposed — it is unrepresentable.
      await report(mapHuntId, guestToken, HERE);
      const back = await rowFor('Pilgrims');
      assert.equal(Number(back.latitude), HERE.latitude);
    });

    it('the report stays author-only: another player cannot read anybody’s positions', async () => {
      const other = await http()
        .post('/api/v1/auth/register')
        .send({
          email: `e2e_loc_${suffix}@example.com`,
          username: `e2e_loc_${suffix}`,
          password,
          displayName: 'Nosy',
        })
        .expect(201);

      const res = await http()
        .get(`/api/v1/hunts/${mapHuntId}/players`)
        .set('Authorization', `Bearer ${other.body.accessToken}`)
        .expect(403);
      assert.equal(res.body.error.code, 'FORBIDDEN');

      // …and signed out is a 401, not an empty list that reads as "no players".
      const anon = await http().get(`/api/v1/hunts/${mapHuntId}/players`).expect(401);
      assert.equal(anon.body.error.code, 'UNAUTHORIZED');
    });

    it('out-of-range coordinates are refused rather than clamped', async () => {
      await http()
        .post(`/api/v1/hunts/${mapHuntId}/location`)
        .send({ latitude: 999, longitude: 0, guestToken })
        .expect(400);
      await http()
        .post(`/api/v1/hunts/${mapHuntId}/location`)
        .send({ latitude: 0, longitude: 999, guestToken })
        .expect(400);
    });

    it('a client cannot forge the fix time — the field is refused outright', async () => {
      // A client-supplied `locationAt` could be backdated to make a fix look live
      // for hours. It never reaches the service at all: the global whitelist pipe
      // strips/rejects unknown fields, so the attempt is a 400 rather than a
      // silently-ignored extra.
      const forged = await http()
        .post(`/api/v1/hunts/${mapHuntId}/location`)
        .send({ ...HERE, locationAt: '1999-01-01T00:00:00.000Z', guestToken })
        .expect(400);
      assert.equal(forged.body.error.code, 'VALIDATION_ERROR');

      // And the stored fix is stamped by the server regardless.
      await report(mapHuntId, guestToken, HERE);
      const row = await rowFor('Pilgrims');
      const stamped = new Date(row.locationAt as string).getTime();
      assert.ok(
        Math.abs(Date.now() - stamped) < 60_000,
        `server stamped it now (got ${row.locationAt})`,
      );
    });

    it('pinging a hunt you have not joined → 403', async () => {
      await http()
        .post(`/api/v1/hunts/${mapHuntId}/location`)
        .send({ ...HERE, guestToken: 'f'.repeat(64) })
        .expect(403);
    });
  });
});
});
