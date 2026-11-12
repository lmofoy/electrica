import type { DeviceType } from '../../types';
import { DEVICE_CATALOG } from './devices';

const STORAGE_KEY = 'electrica-ui-prefs-v1';
const MAX_RECENT = 6;
const MAX_FAVORITES = 12;

export interface DeviceUiPreferences {
  recentDeviceTypes: DeviceType[];
  favoriteDeviceTypes: DeviceType[];
}

export const DEFAULT_DEVICE_UI_PREFERENCES: DeviceUiPreferences = {
  recentDeviceTypes: [],
  favoriteDeviceTypes: [],
};

function isDeviceType(value: unknown): value is DeviceType {
  return typeof value === 'string' && Object.hasOwn(DEVICE_CATALOG, value);
}

function validTypes(value: unknown, limit: number): DeviceType[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<DeviceType>();
  for (const item of value) {
    if (!isDeviceType(item)) continue;
    unique.add(item);
    if (unique.size >= limit) break;
  }
  return [...unique];
}

export function loadDeviceUiPreferences(): DeviceUiPreferences {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_DEVICE_UI_PREFERENCES;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_DEVICE_UI_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return DEFAULT_DEVICE_UI_PREFERENCES;
    }
    const record = parsed as Record<string, unknown>;
    return {
      recentDeviceTypes: validTypes(record.recentDeviceTypes, MAX_RECENT),
      favoriteDeviceTypes: validTypes(record.favoriteDeviceTypes, MAX_FAVORITES),
    };
  } catch {
    return DEFAULT_DEVICE_UI_PREFERENCES;
  }
}

export function saveDeviceUiPreferences(preferences: DeviceUiPreferences): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        recentDeviceTypes: preferences.recentDeviceTypes,
        favoriteDeviceTypes: preferences.favoriteDeviceTypes,
      })
    );
  } catch {
    // UI preferences are optional; quota or privacy mode must not break the app.
  }
}

export function rememberRecentDevice(
  type: DeviceType,
  preferences: DeviceUiPreferences
): DeviceUiPreferences {
  return {
    ...preferences,
    recentDeviceTypes: [
      type,
      ...preferences.recentDeviceTypes.filter((candidate) => candidate !== type),
    ].slice(0, MAX_RECENT),
  };
}

export function toggleFavoriteDevice(
  type: DeviceType,
  preferences: DeviceUiPreferences
): DeviceUiPreferences {
  const exists = preferences.favoriteDeviceTypes.includes(type);
  return {
    ...preferences,
    favoriteDeviceTypes: exists
      ? preferences.favoriteDeviceTypes.filter((candidate) => candidate !== type)
      : [type, ...preferences.favoriteDeviceTypes].slice(0, MAX_FAVORITES),
  };
}
