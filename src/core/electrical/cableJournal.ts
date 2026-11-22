import type {
  ElectricalDevice,
  ElectricalPanel,
  FreePartition,
  RoomZone,
} from '../../types';
import { LINE_PRESETS } from './norms';
import { lineCodes } from './lineOps';
import type { LineRoute } from './routing';
import { formatCableLengthMm } from './routing';

// -------------------------------------------------------------
// Кабельный журнал ЭС-07: по каждой групповой линии — начало, конец,
// марка и сечение кабеля, способ прокладки и длина по трассе.
// -------------------------------------------------------------

export interface CableJournalSource {
  devices: ElectricalDevice[];
  rooms: RoomZone[];
  partitions: FreePartition[];
  routes: Map<string, LineRoute>;
}

export interface CableJournalRow {
  id: string;
  code: number;
  groupLabel: string;
  lineName: string;
  purposeLabel: string;
  start: string;
  end: string;
  cable: string;
  routingLabel: string;
  breakerLabel: string;
  lengthMm: number;
  lengthLabel: string;
  warning: string | null;
}

export interface CableJournalTotals {
  lines: number;
  cableMeters: number;
  ceilingCount: number;
  floorCount: number;
  missingCount: number;
}

export interface CableJournal {
  panelName: string;
  cableBrand: string;
  rows: CableJournalRow[];
  totals: CableJournalTotals;
  warnings: string[];
}

function num(value: number, digits = 1): string {
  return value.toFixed(digits).replace('.', ',');
}

function sectionLabel(sectionMm2: number): string {
  return num(sectionMm2, sectionMm2 % 1 === 0 ? 0 : 1);
}

function deviceRoomId(
  device: ElectricalDevice,
  partitions: FreePartition[]
): string | null {
  const anchor = device.anchor;
  if (anchor.kind === 'room_edge' || anchor.kind === 'room_point') {
    return anchor.roomId;
  }
  if (anchor.kind !== 'partition') return null;
  const partitionId = anchor.partitionId;
  const partition = partitions.find((item) => item.id === partitionId);
  return partition?.roomId ?? null;
}

function lineRooms(
  lineDeviceIds: string[],
  devices: ElectricalDevice[],
  rooms: RoomZone[],
  partitions: FreePartition[]
): string[] {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const roomNameById = new Map(rooms.map((room) => [room.id, room.name]));
  const names: string[] = [];
  for (const deviceId of lineDeviceIds) {
    const device = byId.get(deviceId);
    if (!device) continue;
    const roomId = deviceRoomId(device, partitions);
    const name = roomId ? roomNameById.get(roomId) : null;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export function buildCableJournal(
  panel: ElectricalPanel,
  source: CableJournalSource
): CableJournal {
  const codes = lineCodes(panel);
  const rows: CableJournalRow[] = panel.lines.map((line, index) => {
    const route = source.routes.get(line.id);
    const roomNames = lineRooms(line.deviceIds, source.devices, source.rooms, source.partitions);
    const routing = route?.mode ?? line.routing ?? panel.lines[index].routing ?? 'ceiling';
    const cores = line.cable.cores;
    const lengthMm = route?.cableLengthMm ?? 0;
    const breaker = line.breaker;
    const code = codes.get(line.id) ?? index + 2;
    return {
      id: line.id,
      code,
      groupLabel: `Гр. ${code}`,
      lineName: line.name,
      purposeLabel: LINE_PRESETS[line.purpose].label,
      start: panel.name,
      end:
        roomNames.length > 0
          ? roomNames.join(', ')
          : `${line.deviceIds.length} приб.`,
      cable: `${panel.supply.cableBrand} ${cores}×${sectionLabel(line.cable.sectionMm2)} мм²`,
      routingLabel: routing === 'floor' ? 'в полу' : 'по потолку',
      breakerLabel: `QF${code} ${breaker.ratingA} А`,
      lengthMm,
      lengthLabel: formatCableLengthMm(lengthMm),
      warning: route?.warning ?? null,
    };
  });

  const totals: CableJournalTotals = {
    lines: rows.length,
    cableMeters: rows.reduce((sum, row) => sum + row.lengthMm, 0) / 1000,
    ceilingCount: rows.filter((row) => row.routingLabel === 'по потолку').length,
    floorCount: rows.filter((row) => row.routingLabel === 'в полу').length,
    missingCount: rows.filter((row) => row.lengthMm <= 0).length,
  };

  const warnings: string[] = [];
  for (const row of rows) {
    if (row.warning && !warnings.includes(row.warning)) warnings.push(row.warning);
  }

  return {
    panelName: panel.name,
    cableBrand: panel.supply.cableBrand,
    rows,
    totals,
    warnings,
  };
}
