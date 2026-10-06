import { apiRequest } from './client';
import type { InventoryEntry } from './types';

/** `GET /inventory` — items held by the caller (bare array). */
export const inventoryApi = {
  list(): Promise<InventoryEntry[]> {
    return apiRequest<InventoryEntry[]>('/inventory');
  },
};
