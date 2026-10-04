import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception.js';

/**
 * Distance maths — the server's own answer to "is the player there?" (rule #13).
 *
 * This mirrors `utils/geo.ts` in the frontend, which stays as the *UI*'s
 * optimistic proximity calculation. The frontend's number is never trusted for
 * awarding anything: the player submits coordinates, and this service recomputes
 * the distance from the quest's own stored coordinates.
 */
const EARTH_RADIUS_METERS = 6371000; // Earth mean radius — same constant as utils/geo.ts

export interface Coordinates {
  latitude: number;
  longitude: number;
}

@Injectable()
export class DistanceService {
  /** Great-circle distance in meters (Haversine). */
  between(from: Coordinates, to: Coordinates): number {
    const dLat = toRadians(to.latitude - from.latitude);
    const dLon = toRadians(to.longitude - from.longitude);

    const lat1 = toRadians(from.latitude);
    const lat2 = toRadians(to.latitude);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
  }

  /**
   * True when the player is inside the quest's activation radius.
   *
   * GPS accuracy is accounted for: a fix that is itself less precise than the
   * gap between the player and the radius edge should not fail a player who is
   * standing on the spot in the rain under a tree. The radius is therefore
   * widened by the reported accuracy, capped at one radius' worth of slack so a
   * wildly inaccurate fix cannot unlock a quest from across the city.
   */
  isWithinRadius(
    player: Coordinates,
    quest: Coordinates & { radiusMeters: number },
    accuracyMeters?: number,
  ): { distanceMeters: number; withinRadius: boolean; effectiveRadiusMeters: number } {
    const distanceMeters = this.between(player, quest);
    const slack = Math.min(Math.max(accuracyMeters ?? 0, 0), quest.radiusMeters);
    const effectiveRadiusMeters = quest.radiusMeters + slack;

    return {
      distanceMeters,
      withinRadius: distanceMeters <= effectiveRadiusMeters,
      effectiveRadiusMeters,
    };
  }

  /** Coordinates are validated by the DTO; this guards the maths itself. */
  assertPlausible(coords: Coordinates): void {
    const { latitude, longitude } = coords;
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    ) {
      throw ApiException.badRequest(
        'VALIDATION_ERROR',
        'latitude/longitude must be a real coordinate pair.',
        { latitude, longitude },
      );
    }
  }
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}