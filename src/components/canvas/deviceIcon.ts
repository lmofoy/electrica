import { Droplets, Lightbulb, Plug, ToggleLeft } from 'lucide-react';
import type { DeviceType } from '../../types';
import { DEVICE_CATALOG } from '../../core/electrical/devices';

export function deviceIcon(type: DeviceType) {
  const entry = DEVICE_CATALOG[type];
  if (entry.group === 'light') return Lightbulb;
  if (entry.group === 'switch') return ToggleLeft;
  return entry.ipRating !== 'IP20' ? Droplets : Plug;
}
