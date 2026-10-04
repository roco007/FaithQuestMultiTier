import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DistanceService } from './distance.service.js';

/** node_01_chapel's seeded coordinates — the smoke test's fixture too. */
const CHAPEL = { latitude: 37.774929, longitude: -122.419416, radiusMeters: 10 };
/** ≈ 0.000135° of latitude ≈ 15 m north of the chapel. */
const NEAR = { latitude: 37.775064, longitude: -122.419416 };
/** ≈ 0.000225° ≈ 25 m north of the chapel. */
const EDGE = { latitude: 37.775154, longitude: -122.419416 };
/** ~1 km away — comfortably outside anything. */
const FAR = { latitude: 37.785, longitude: -122.419416 };

const geo = new DistanceService();

describe('DistanceService.between', () => {
  it('is zero at the same point', () => {
    assert.equal(geo.between(CHAPEL, CHAPEL), 0);
  });

  it('matches the haversine length of one meridional degree (~111.19 km)', () => {
    const one = geo.between(
      { latitude: 0, longitude: 0 },
      { latitude: 1, longitude: 0 },
    );
    assert.ok(Math.abs(one - 111194.93) < 1, `got ${one}`);
  });

  it('agrees with the frontend: chapel → FAR ≈ 1.1 km', () => {
    const metres = geo.between(CHAPEL, FAR);
    assert.ok(metres > 1000 && metres < 1250, `got ${metres}`);
  });
});

describe('DistanceService.isWithinRadius', () => {
  it('passes a player standing on the spot', () => {
    const verdict = geo.isWithinRadius(CHAPEL, CHAPEL);
    assert.equal(verdict.withinRadius, true);
    assert.equal(verdict.effectiveRadiusMeters, 10);
    assert.equal(verdict.distanceMeters, 0);
  });

  it('fails a player outside the radius without accuracy', () => {
    assert.equal(geo.isWithinRadius(EDGE, CHAPEL).withinRadius, false);
    assert.equal(geo.isWithinRadius(FAR, CHAPEL).withinRadius, false);
  });

  it('widens the radius by the reported GPS accuracy', () => {
    // ~15 m away, radius 10 → fails bare, passes when the fix admits 20 m
    // error (slack capped at one radius → effective 20).
    assert.equal(geo.isWithinRadius(NEAR, CHAPEL).withinRadius, false);
    const withAccuracy = geo.isWithinRadius(NEAR, CHAPEL, 20);
    assert.equal(withAccuracy.withinRadius, true);
    assert.equal(withAccuracy.effectiveRadiusMeters, 20);
  });

  it('caps the accuracy slack at one radius', () => {
    // A wildly inaccurate fix must not unlock from across the city.
    const verdict = geo.isWithinRadius(EDGE, CHAPEL, 10_000);
    assert.equal(verdict.effectiveRadiusMeters, 20);
    assert.equal(verdict.withinRadius, false);
    assert.equal(geo.isWithinRadius(FAR, CHAPEL, 10_000).withinRadius, false);
  });
});

describe('DistanceService.assertPlausible', () => {
  it('accepts a real coordinate pair', () => {
    geo.assertPlausible(CHAPEL);
  });

  it('rejects NaN and out-of-range values with a 400 envelope', () => {
    for (const bad of [
      { latitude: Number.NaN, longitude: 0 },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: -181 },
    ]) {
      assert.throws(
        () => geo.assertPlausible(bad),
        (err: { code?: string; getStatus?: () => number }) =>
          err.code === 'VALIDATION_ERROR' && err.getStatus?.() === 400,
      );
    }
  });
});
