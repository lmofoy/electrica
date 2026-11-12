import type {
  DeviceAnchor,
  DeviceType,
  ElectricalDevice,
  FreePartition,
  LinePurpose,
  Point2D,
  RoomZone,
} from '../../types';
import {
  distance,
  isPointInPolygon,
  projectPointOnSegment,
} from '../geometry/math';

export type DeviceCatalogSectionId =
  | 'sockets'
  | 'switches'
  | 'lighting'
  | 'power'
  | 'lowvoltage'
  | 'other';

export interface DeviceCatalogSection {
  id: DeviceCatalogSectionId;
  label: string;
  hint: string;
  order: number;
}

export const DEVICE_SECTIONS: DeviceCatalogSection[] = [
  {
    id: 'sockets',
    label: 'Розетки',
    hint: 'Силовые точки 230 В',
    order: 10,
  },
  {
    id: 'switches',
    label: 'Выключатели',
    hint: 'Клавиши, проходные и управление',
    order: 20,
  },
  {
    id: 'lighting',
    label: 'Освещение',
    hint: 'Потолочные и настенные светильники',
    order: 30,
  },
  {
    id: 'power',
    label: 'Силовое',
    hint: 'Плита, техника и климат',
    order: 40,
  },
  {
    id: 'lowvoltage',
    label: 'Слаботочка',
    hint: 'Интернет, ТВ и безопасность',
    order: 50,
  },
  {
    id: 'other',
    label: 'Прочее',
    hint: 'Закладные и нестандартные точки',
    order: 60,
  },
];

export type DeviceConnection = 'socket' | 'terminal' | 'direct' | 'provision';

// Семейный символ на плане: варианты внутри семейства различаются
// количеством гнёзд/клавиш и небольшими метками (влага, проходной и т. п.).
export type DeviceGlyphKind =
  | 'socket'
  | 'switch_key'
  | 'switch_pass'
  | 'switch_cross'
  | 'switch_dimmer'
  | 'switch_motion'
  | 'switch_presence'
  | 'switch_provision'
  | 'light_ceiling'
  | 'light_surface'
  | 'light_recessed'
  | 'light_sconce'
  | 'light_wall_wet'
  | 'light_track'
  | 'light_strip'
  | 'light_outdoor'
  | 'light_provision';

export interface DeviceCatalogEntry {
  label: string;
  shortLabel: string;
  group: 'socket' | 'switch' | 'light';
  section: DeviceCatalogSectionId;
  subsection: string;
  order: number;
  mounting: 'wall' | 'ceiling';
  defaultHeightMm: number;
  defaultPowerWatts: number;
  ipRating: string;
  connection: DeviceConnection;
  suggestedPurpose: LinePurpose | null;
  requiresDedicatedLine: boolean;
  normRefs: string[];
  keywords: string[];
  description: string;
  badge: string;
  glyph: DeviceGlyphKind;
  outlets?: 1 | 2 | 3;
  keys?: 1 | 2 | 3;
  isStub?: boolean;
}

export const DEVICE_CATALOG: Record<DeviceType, DeviceCatalogEntry> = {
  // --- Розетки: 1 гнездо -------------------------------------
  socket_single: {
    label: 'Розетка одинарная',
    shortLabel: 'Розетка 1',
    group: 'socket',
    section: 'sockets',
    subsection: '1 гнездо',
    order: 10,
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 2200,
    ipRating: 'IP20',
    connection: 'socket',
    suggestedPurpose: 'sockets',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'одинарная', 'одна', 'евро', '220', 'ip20'],
    description: 'Базовая розетка для жилых комнат и коридоров.',
    badge: '1',
    glyph: 'socket',
    outlets: 1,
  },
  socket_wet: {
    label: 'Розетка влагозащищённая',
    shortLabel: 'Влажная',
    group: 'socket',
    section: 'sockets',
    subsection: '1 гнездо',
    order: 20,
    mounting: 'wall',
    defaultHeightMm: 1100,
    defaultPowerWatts: 2200,
    ipRating: 'IP44',
    connection: 'socket',
    suggestedPurpose: 'wet',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'влажная', 'ванная', 'санузел', 'балкон', 'ip44'],
    description: 'Влагозащищённый корпус для санузла, кухни у мойки и балкона.',
    badge: 'IP44',
    glyph: 'socket',
    outlets: 1,
  },
  socket_outdoor: {
    label: 'Розетка улица / балкон',
    shortLabel: 'Улица',
    group: 'socket',
    section: 'sockets',
    subsection: '1 гнездо',
    order: 30,
    mounting: 'wall',
    defaultHeightMm: 1100,
    defaultPowerWatts: 2200,
    ipRating: 'IP55',
    connection: 'socket',
    suggestedPurpose: 'wet',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'улица', 'балкон', 'лоджия', 'ip55', 'влажная'],
    description: 'Защищённая розетка для балкона, лоджии и улицы.',
    badge: 'IP55',
    glyph: 'socket',
    outlets: 1,
  },

  // --- Розетки: 2 гнезда -------------------------------------
  socket_double: {
    label: 'Розетка двойная',
    shortLabel: 'Розетка 2',
    group: 'socket',
    section: 'sockets',
    subsection: '2 гнезда',
    order: 40,
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 2200,
    ipRating: 'IP20',
    connection: 'socket',
    suggestedPurpose: 'sockets',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'двойная', 'две', 'евро', '220', 'ip20'],
    description: 'Две розетки в одном блоке для рабочего места и техники.',
    badge: '2',
    glyph: 'socket',
    outlets: 2,
  },
  socket_double_wet: {
    label: 'Розетка двойная влагозащищённая',
    shortLabel: 'Влажная 2',
    group: 'socket',
    section: 'sockets',
    subsection: '2 гнезда',
    order: 50,
    mounting: 'wall',
    defaultHeightMm: 1100,
    defaultPowerWatts: 2200,
    ipRating: 'IP44',
    connection: 'socket',
    suggestedPurpose: 'wet',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'двойная', 'влажная', 'ванная', 'ip44'],
    description: 'Два влагозащищённых гнезда для санузла и мокрой зоны.',
    badge: 'IP44',
    glyph: 'socket',
    outlets: 2,
  },
  socket_double_outdoor: {
    label: 'Розетка двойная улица / балкон',
    shortLabel: 'Улица 2',
    group: 'socket',
    section: 'sockets',
    subsection: '2 гнезда',
    order: 60,
    mounting: 'wall',
    defaultHeightMm: 1100,
    defaultPowerWatts: 2200,
    ipRating: 'IP55',
    connection: 'socket',
    suggestedPurpose: 'wet',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'двойная', 'улица', 'балкон', 'ip55'],
    description: 'Два защищённых гнезда для балкона, лоджии и улицы.',
    badge: 'IP55',
    glyph: 'socket',
    outlets: 2,
  },
  socket_double_usb: {
    label: 'Розетка двойная с USB',
    shortLabel: 'Розетка USB',
    group: 'socket',
    section: 'sockets',
    subsection: '2 гнезда',
    order: 70,
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 2200,
    ipRating: 'IP20',
    connection: 'socket',
    suggestedPurpose: 'sockets',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'двойная', 'usb', 'зарядка', 'телефон', 'ip20'],
    description: 'Два гнезда 230 В и встроенные USB-порты для зарядки.',
    badge: 'USB',
    glyph: 'socket',
    outlets: 2,
  },

  // --- Розетки: 3 гнезда -------------------------------------
  socket_triple: {
    label: 'Розетка тройная',
    shortLabel: 'Розетка 3',
    group: 'socket',
    section: 'sockets',
    subsection: '3 гнезда',
    order: 80,
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 2200,
    ipRating: 'IP20',
    connection: 'socket',
    suggestedPurpose: 'sockets',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'тройная', 'три', 'блок', 'ip20'],
    description: 'Три розетки в одном блоке для кухонного фартука и рабочей зоны.',
    badge: '3',
    glyph: 'socket',
    outlets: 3,
  },
  socket_triple_wet: {
    label: 'Розетка тройная влагозащищённая',
    shortLabel: 'Влажная 3',
    group: 'socket',
    section: 'sockets',
    subsection: '3 гнезда',
    order: 90,
    mounting: 'wall',
    defaultHeightMm: 1100,
    defaultPowerWatts: 2200,
    ipRating: 'IP44',
    connection: 'socket',
    suggestedPurpose: 'wet',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'тройная', 'влажная', 'кухня', 'ip44'],
    description: 'Блок из трёх влагозащищённых гнёзд для мокрой зоны кухни.',
    badge: 'IP44',
    glyph: 'socket',
    outlets: 3,
  },

  // --- Розетки: специальные ----------------------------------
  socket_hob: {
    label: 'Розетка для варочной панели',
    shortLabel: 'Плита',
    group: 'socket',
    section: 'sockets',
    subsection: 'Специальные',
    order: 100,
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 7000,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'hob',
    requiresDedicatedLine: true,
    normRefs: ['ПУЭ-7 гл. 7.1', 'СП 256.1325800.2016'],
    keywords: ['розетка', 'плита', 'варочная', 'панель', '32', '7квт'],
    description: 'Клеммная точка для варочной панели до 7 кВт; отдельная линия 32 А.',
    badge: '32 А',
    glyph: 'socket',
    outlets: 1,
  },
  socket_oven: {
    label: 'Розетка для духового шкафа',
    shortLabel: 'Духовка',
    group: 'socket',
    section: 'sockets',
    subsection: 'Специальные',
    order: 110,
    mounting: 'wall',
    defaultHeightMm: 300,
    defaultPowerWatts: 3500,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'oven',
    requiresDedicatedLine: true,
    normRefs: ['ПУЭ-7 гл. 7.1', 'СП 256.1325800.2016'],
    keywords: ['розетка', 'духовка', 'духовой', 'шкаф', '16', '3.5квт'],
    description: 'Клеммная точка для духового шкафа до 3,5 кВт; отдельная линия 16 А.',
    badge: '16 А',
    glyph: 'socket',
    outlets: 1,
  },
  socket_appliance: {
    label: 'Розетка скрытая для техники',
    shortLabel: 'Техника',
    group: 'socket',
    section: 'sockets',
    subsection: 'Специальные',
    order: 120,
    mounting: 'wall',
    defaultHeightMm: 600,
    defaultPowerWatts: 2200,
    ipRating: 'IP44',
    connection: 'socket',
    suggestedPurpose: 'washing',
    requiresDedicatedLine: true,
    normRefs: ['ПУЭ-7 гл. 7.1', 'СП 256.1325800.2016', 'ГОСТ Р 50571.7.701'],
    keywords: ['розетка', 'стиральная', 'посудомоечная', 'машинка', 'скрытая', 'ip44'],
    description: 'Скрытая розетка за стиральной или посудомоечной машиной; отдельная линия с УЗО.',
    badge: 'IP44',
    glyph: 'socket',
    outlets: 1,
  },
  socket_fridge: {
    label: 'Розетка скрытая для холодильника',
    shortLabel: 'Холодильник',
    group: 'socket',
    section: 'sockets',
    subsection: 'Специальные',
    order: 130,
    mounting: 'wall',
    defaultHeightMm: 600,
    defaultPowerWatts: 300,
    ipRating: 'IP20',
    connection: 'socket',
    suggestedPurpose: 'sockets',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['розетка', 'холодильник', 'скрытая', 'кухня'],
    description: 'Скрытая розетка за холодильником, чтобы вилка не выступала из стены.',
    badge: 'Скрытая',
    glyph: 'socket',
    outlets: 1,
  },

  // --- Выключатели: клавишные --------------------------------
  switch_1k: {
    label: 'Выключатель одноклавишный',
    shortLabel: 'Выкл. 1',
    group: 'switch',
    section: 'switches',
    subsection: 'Клавишные',
    order: 10,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['выключатель', 'клавиша', 'свет', 'одна', 'ip20'],
    description: 'Управляет одной группой освещения.',
    badge: '1',
    glyph: 'switch_key',
    keys: 1,
  },
  switch_2k: {
    label: 'Выключатель двухклавишный',
    shortLabel: 'Выкл. 2',
    group: 'switch',
    section: 'switches',
    subsection: 'Клавишные',
    order: 20,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['выключатель', 'клавиши', 'две', 'свет', 'ip20'],
    description: 'Управляет двумя группами освещения в одном блоке.',
    badge: '2',
    glyph: 'switch_key',
    keys: 2,
  },
  switch_3k: {
    label: 'Выключатель трёхклавишный',
    shortLabel: 'Выкл. 3',
    group: 'switch',
    section: 'switches',
    subsection: 'Клавишные',
    order: 30,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['выключатель', 'клавиши', 'три', 'свет', 'ip20'],
    description: 'Три группы освещения в одном блоке.',
    badge: '3',
    glyph: 'switch_key',
    keys: 3,
  },

  // --- Выключатели: проходные --------------------------------
  switch_pass_1k: {
    label: 'Выключатель проходной одноклавишный',
    shortLabel: 'Проходной',
    group: 'switch',
    section: 'switches',
    subsection: 'Проходные',
    order: 40,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['выключатель', 'проходной', 'свет', 'две точки'],
    description: 'Проходной выключатель для управления светом из двух мест.',
    badge: 'Прох.',
    glyph: 'switch_pass',
    keys: 1,
  },
  switch_pass_2k: {
    label: 'Выключатель проходной двухклавишный',
    shortLabel: 'Проходной 2',
    group: 'switch',
    section: 'switches',
    subsection: 'Проходные',
    order: 50,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['выключатель', 'проходной', 'две клавиши', 'свет'],
    description: 'Два проходных канала в одном блоке.',
    badge: 'Прох. 2',
    glyph: 'switch_pass',
    keys: 2,
  },
  switch_cross: {
    label: 'Выключатель перекрёстный',
    shortLabel: 'Перекрёстный',
    group: 'switch',
    section: 'switches',
    subsection: 'Проходные',
    order: 60,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['выключатель', 'перекрёстный', 'перекрестный', 'три точки'],
    description: 'Перекрёстный выключатель для схемы с тремя и более точками управления.',
    badge: 'Перекр.',
    glyph: 'switch_cross',
    keys: 1,
  },

  // --- Выключатели: управление -------------------------------
  switch_dimmer: {
    label: 'Диммер',
    shortLabel: 'Диммер',
    group: 'switch',
    section: 'switches',
    subsection: 'Управление',
    order: 70,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['диммер', 'регулятор', 'яркость', 'свет'],
    description: 'Плавная регулировка яркости ламп, совместимых с диммером.',
    badge: 'Диммер',
    glyph: 'switch_dimmer',
  },
  switch_motion: {
    label: 'Датчик движения',
    shortLabel: 'Движение',
    group: 'switch',
    section: 'switches',
    subsection: 'Управление',
    order: 80,
    mounting: 'wall',
    defaultHeightMm: 2100,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['датчик', 'движение', 'автоматика', 'свет', 'коридор'],
    description: 'Включает освещение при движении; ставится на стену или в потолок.',
    badge: 'ДД',
    glyph: 'switch_motion',
  },
  switch_presence: {
    label: 'Датчик присутствия',
    shortLabel: 'Присутствие',
    group: 'switch',
    section: 'switches',
    subsection: 'Управление',
    order: 90,
    mounting: 'wall',
    defaultHeightMm: 2100,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.4.41'],
    keywords: ['датчик', 'присутствие', 'автоматика', 'свет', 'офис'],
    description: 'Реагирует на присутствие людей, а не только на движение.',
    badge: 'ДП',
    glyph: 'switch_presence',
  },
  switch_wet: {
    label: 'Выключатель влагозащищённый',
    shortLabel: 'Выкл. IP44',
    group: 'switch',
    section: 'switches',
    subsection: 'Управление',
    order: 100,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP44',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['ПУЭ-7 гл. 7.1', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['выключатель', 'влажный', 'ванная', 'санузел', 'ip44'],
    description: 'Выключатель для влажных зон: санузел, кухня у мойки.',
    badge: 'IP44',
    glyph: 'switch_key',
    keys: 1,
  },

  // --- Выключатели: закладные --------------------------------
  switch_provision: {
    label: 'Закладная под выключатель',
    shortLabel: 'Закладная',
    group: 'switch',
    section: 'switches',
    subsection: 'Закладные',
    order: 110,
    mounting: 'wall',
    defaultHeightMm: 900,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'provision',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ПУЭ-7 гл. 7.1'],
    keywords: ['закладная', 'вывод', 'провод', 'выключатель', 'ремонт'],
    description: 'Вывод провода под будущий выключатель без установленного механизма.',
    badge: 'Закладная',
    glyph: 'switch_provision',
  },

  // --- Освещение: потолочные ---------------------------------
  light_ceiling: {
    label: 'Светильник потолочный',
    shortLabel: 'Свет',
    group: 'light',
    section: 'lighting',
    subsection: 'Потолочные',
    order: 10,
    mounting: 'ceiling',
    defaultHeightMm: 0,
    defaultPowerWatts: 100,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'светильник', 'люстра', 'потолок', 'освещение'],
    description: 'Потолочная точка освещения внутри комнаты.',
    badge: 'Люстра',
    glyph: 'light_ceiling',
  },
  light_surface: {
    label: 'Светильник накладной',
    shortLabel: 'Накладной',
    group: 'light',
    section: 'lighting',
    subsection: 'Потолочные',
    order: 20,
    mounting: 'ceiling',
    defaultHeightMm: 0,
    defaultPowerWatts: 80,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'светильник', 'накладной', 'потолок'],
    description: 'Потолочный светильник, закреплённый на поверхности потолка.',
    badge: 'Накл.',
    glyph: 'light_surface',
  },
  light_recessed: {
    label: 'Светильник встраиваемый',
    shortLabel: 'Встраиваемый',
    group: 'light',
    section: 'lighting',
    subsection: 'Потолочные',
    order: 30,
    mounting: 'ceiling',
    defaultHeightMm: 0,
    defaultPowerWatts: 10,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'светильник', 'встраиваемый', 'точечный', 'спот'],
    description: 'Точечный светильник, утопленный в потолок или гипсокартон.',
    badge: 'Встр.',
    glyph: 'light_recessed',
  },

  // --- Освещение: настенные ----------------------------------
  light_sconce: {
    label: 'Бра',
    shortLabel: 'Бра',
    group: 'light',
    section: 'lighting',
    subsection: 'Настенные',
    order: 40,
    mounting: 'wall',
    defaultHeightMm: 1800,
    defaultPowerWatts: 60,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'бра', 'настенный', 'подсветка', 'стена'],
    description: 'Настенный светильник для локальной подсветки.',
    badge: 'Бра',
    glyph: 'light_sconce',
  },
  light_wall_wet: {
    label: 'Светильник настенный влагозащищённый',
    shortLabel: 'Бра IP44',
    group: 'light',
    section: 'lighting',
    subsection: 'Настенные',
    order: 50,
    mounting: 'wall',
    defaultHeightMm: 1800,
    defaultPowerWatts: 60,
    ipRating: 'IP44',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'бра', 'влажный', 'ванная', 'зеркало', 'ip44'],
    description: 'Влагозащищённый настенный светильник для санузла и зеркала.',
    badge: 'IP44',
    glyph: 'light_wall_wet',
  },

  // --- Освещение: линейные -----------------------------------
  light_track: {
    label: 'Трековая система',
    shortLabel: 'Трек',
    group: 'light',
    section: 'lighting',
    subsection: 'Линейные',
    order: 60,
    mounting: 'ceiling',
    defaultHeightMm: 0,
    defaultPowerWatts: 100,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'трек', 'шина', 'споты', 'потолок'],
    description: 'Потолочная шина с переносимыми светильниками.',
    badge: 'Трек',
    glyph: 'light_track',
  },
  light_strip: {
    label: 'Светодиодная лента',
    shortLabel: 'Лента',
    group: 'light',
    section: 'lighting',
    subsection: 'Линейные',
    order: 70,
    mounting: 'ceiling',
    defaultHeightMm: 0,
    defaultPowerWatts: 50,
    ipRating: 'IP20',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'лента', 'led', 'подсветка', 'карниз'],
    description: 'Линейная LED-подсветка с блоком питания.',
    badge: 'Лента',
    glyph: 'light_strip',
  },

  // --- Освещение: уличные ------------------------------------
  light_outdoor: {
    label: 'Светильник уличный',
    shortLabel: 'Уличный',
    group: 'light',
    section: 'lighting',
    subsection: 'Уличные',
    order: 80,
    mounting: 'wall',
    defaultHeightMm: 1800,
    defaultPowerWatts: 60,
    ipRating: 'IP54',
    connection: 'terminal',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016', 'ГОСТ Р 50571.7.701', 'ГОСТ Р 50571.4.41'],
    keywords: ['свет', 'улица', 'фонарь', 'балкон', 'фасад', 'ip54'],
    description: 'Защищённый светильник для балкона, фасада и улицы.',
    badge: 'IP54',
    glyph: 'light_outdoor',
  },

  // --- Освещение: закладные ----------------------------------
  light_provision: {
    label: 'Закладная под светильник',
    shortLabel: 'Закладная',
    group: 'light',
    section: 'lighting',
    subsection: 'Закладные',
    order: 90,
    mounting: 'ceiling',
    defaultHeightMm: 0,
    defaultPowerWatts: 0,
    ipRating: 'IP20',
    connection: 'provision',
    suggestedPurpose: 'lighting',
    requiresDedicatedLine: false,
    normRefs: ['СП 256.1325800.2016'],
    keywords: ['закладная', 'вывод', 'провод', 'светильник', 'потолок'],
    description: 'Вывод провода под будущий светильник без установленного прибора.',
    badge: 'Закладная',
    glyph: 'light_provision',
  },
};

export const DEVICE_TYPES: DeviceType[] = Object.keys(DEVICE_CATALOG) as DeviceType[];

export interface DeviceCatalogLeaf {
  type: DeviceType;
  entry: DeviceCatalogEntry;
}

export interface DeviceCatalogSubsection {
  id: string;
  label: string;
  order: number;
  leaves: DeviceCatalogLeaf[];
}

export interface DeviceCatalogSectionView {
  section: DeviceCatalogSection;
  subsections: DeviceCatalogSubsection[];
  count: number;
}

function compareLeaves(a: DeviceCatalogLeaf, b: DeviceCatalogLeaf): number {
  return a.entry.order - b.entry.order || a.entry.label.localeCompare(b.entry.label, 'ru');
}

export function buildDeviceCatalogTree(): DeviceCatalogSectionView[] {
  return DEVICE_SECTIONS.map((section) => {
    const leaves = DEVICE_TYPES
      .map((type) => ({ type, entry: DEVICE_CATALOG[type] }))
      .filter((leaf) => leaf.entry.section === section.id);

    const bySubsection = new Map<string, DeviceCatalogLeaf[]>();
    for (const leaf of leaves) {
      const bucket = bySubsection.get(leaf.entry.subsection);
      if (bucket) bucket.push(leaf);
      else bySubsection.set(leaf.entry.subsection, [leaf]);
    }

    const subsections = [...bySubsection.entries()]
      .map(([label, sectionLeaves]) => ({
        id: `${section.id}:${label}`,
        label,
        order: Math.min(...sectionLeaves.map((leaf) => leaf.entry.order)),
        leaves: [...sectionLeaves].sort(compareLeaves),
      }))
      .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label, 'ru'));

    return {
      section,
      subsections,
      count: leaves.length,
    };
  });
}

export const DEVICE_CATALOG_TREE = buildDeviceCatalogTree();

export function deviceCatalogPath(type: DeviceType): {
  section: DeviceCatalogSection;
  subsection: string;
  leaf: DeviceCatalogLeaf;
} | null {
  const entry = DEVICE_CATALOG[type];
  const section = DEVICE_SECTIONS.find((candidate) => candidate.id === entry.section);
  if (!section) return null;
  return {
    section,
    subsection: entry.subsection,
    leaf: { type, entry },
  };
}

export function searchDeviceCatalog(query: string): DeviceCatalogLeaf[] {
  const normalized = query.trim().toLocaleLowerCase('ru');
  if (!normalized) return [];

  const sectionOrder = new Map(
    DEVICE_SECTIONS.map((section) => [section.id, section.order])
  );

  return DEVICE_TYPES
    .map((type) => ({ type, entry: DEVICE_CATALOG[type] }))
    .filter((leaf) => {
      const haystack = [
        leaf.entry.label,
        leaf.entry.shortLabel,
        leaf.entry.subsection,
        leaf.entry.ipRating,
        leaf.entry.badge,
        leaf.entry.description,
        ...leaf.entry.keywords,
      ].join(' ').toLocaleLowerCase('ru');
      return haystack.includes(normalized);
    })
    .sort(
      (a, b) =>
        (sectionOrder.get(a.entry.section) ?? 0) -
          (sectionOrder.get(b.entry.section) ?? 0) ||
        compareLeaves(a, b)
    );
}

export interface DevicePose {
  position: Point2D;
  rotationDeg: number; // локальная ось -Y смотрит внутрь комнаты
  roomId: string;
  mirrored: boolean;
}

export interface ResolvedDevice {
  device: ElectricalDevice;
  poses: DevicePose[];
  roomIds: string[];
  isShared: boolean;
}

export type DevicePlacementResult =
  | {
      ok: true;
      anchor: DeviceAnchor;
      position: Point2D;
      rotationDeg: number;
      roomId: string;
      isShared: boolean;
    }
  | { ok: false; error: string };

function pointInRoom(point: Point2D, room: RoomZone): boolean {
  if (!isPointInPolygon(point, room.vertices)) return false;
  return !(room.holes ?? []).some((hole) => isPointInPolygon(point, hole));
}

function inwardNormalForEdge(room: RoomZone, a: Point2D, b: Point2D): Point2D {
  const len = distance(a, b) || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const probe = 100;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const candidate = { x: mid.x + nx * probe, y: mid.y + ny * probe };
  return pointInRoom(candidate, room) ? { x: nx, y: ny } : { x: -nx, y: -ny };
}

function rotationForInward(inward: Point2D): number {
  return (Math.atan2(inward.y, inward.x) * 180) / Math.PI + 90;
}

interface AdjacentEdge {
  room: RoomZone;
  edgeIndex: number;
  point: Point2D;
  inward: Point2D;
  coincident: boolean;
}

function findAdjacentRoomEdge(
  primaryRoomId: string,
  devicePoint: Point2D,
  outward: Point2D,
  rooms: RoomZone[],
  thickness: number
): AdjacentEdge | null {
  let best: AdjacentEdge | null = null;
  let bestScore = Infinity;

  for (const room of rooms) {
    if (room.id === primaryRoomId) continue;
    const count = room.vertices.length;
    if (count < 3) continue;

    for (let i = 0; i < count; i++) {
      const c = room.vertices[i];
      const d = room.vertices[(i + 1) % count];
      const proj = projectPointOnSegment(devicePoint, c, d);
      // Точка должна попадать внутрь ребра, а не в его конец
      if (proj.t <= 0.002 || proj.t >= 0.998) continue;

      const coincident = proj.distance < 15;
      if (!coincident && Math.abs(proj.distance - thickness) > 15) continue;

      const toPoint = {
        x: proj.point.x - devicePoint.x,
        y: proj.point.y - devicePoint.y,
      };
      if (!coincident && toPoint.x * outward.x + toPoint.y * outward.y <= 0) continue;

      const score = Math.abs(proj.distance - (coincident ? 0 : thickness));
      if (score < bestScore) {
        bestScore = score;
        best = {
          room,
          edgeIndex: i,
          point: proj.point,
          inward: inwardNormalForEdge(room, c, d),
          coincident,
        };
      }
    }
  }

  return best;
}

export function resolveDevice(
  device: ElectricalDevice,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): ResolvedDevice | null {
  const anchor = device.anchor;

  if (anchor.kind === 'room_point') {
    const room = rooms.find((candidate) => candidate.id === anchor.roomId);
    if (!room) return null;
    return {
      device,
      poses: [
        {
          position: { x: anchor.x, y: anchor.y },
          rotationDeg: 0,
          roomId: room.id,
          mirrored: false,
        },
      ],
      roomIds: [room.id],
      isShared: false,
    };
  }

  if (anchor.kind === 'partition') {
    const partition = partitions.find((candidate) => candidate.id === anchor.partitionId);
    if (!partition) return null;
    const len = distance(partition.p1, partition.p2);
    if (len < 1) return null;

    const dir = {
      x: (partition.p2.x - partition.p1.x) / len,
      y: (partition.p2.y - partition.p1.y) / len,
    };
    const offset = Math.max(0, Math.min(len, anchor.offsetMm));
    const normal = { x: -dir.y * anchor.side, y: dir.x * anchor.side };

    return {
      device,
      poses: [
        {
          position: {
            x: partition.p1.x + dir.x * offset,
            y: partition.p1.y + dir.y * offset,
          },
          rotationDeg: rotationForInward(normal),
          roomId: partition.roomId,
          mirrored: false,
        },
      ],
      roomIds: [partition.roomId],
      isShared: false,
    };
  }

  const room = rooms.find((candidate) => candidate.id === anchor.roomId);
  if (!room || room.vertices.length < 3) return null;

  const count = room.vertices.length;
  const edgeIndex = ((anchor.edgeIndex % count) + count) % count;
  const a = room.vertices[edgeIndex];
  const b = room.vertices[(edgeIndex + 1) % count];
  const len = distance(a, b);
  if (len < 1) return null;

  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const offset = Math.max(0, Math.min(len, anchor.offsetMm));
  const position = { x: a.x + dir.x * offset, y: a.y + dir.y * offset };
  const inward = inwardNormalForEdge(room, a, b);

  const poses: DevicePose[] = [
    {
      position,
      rotationDeg: rotationForInward(inward),
      roomId: room.id,
      mirrored: false,
    },
  ];
  const roomIds = [room.id];

  if (device.shared) {
    const outward = { x: -inward.x, y: -inward.y };
    const adjacent = findAdjacentRoomEdge(room.id, position, outward, rooms, thickness);
    if (adjacent) {
      const position2 = adjacent.coincident
        ? {
            x: adjacent.point.x + adjacent.inward.x * (thickness / 2),
            y: adjacent.point.y + adjacent.inward.y * (thickness / 2),
          }
        : adjacent.point;
      poses.push({
        position: position2,
        rotationDeg: rotationForInward(adjacent.inward),
        roomId: adjacent.room.id,
        mirrored: true,
      });
      roomIds.push(adjacent.room.id);
    }
  }

  return { device, poses, roomIds, isShared: poses.length > 1 };
}

interface WallCandidate {
  kind: 'room_edge' | 'partition';
  distanceMm: number;
  roomId: string;
  edgeIndex?: number;
  partitionId?: string;
  lengthMm: number;
  point: Point2D;
  inward: Point2D;
  offsetMm: number;
}

function collectCandidates(
  cursor: Point2D,
  room: RoomZone | null,
  rooms: RoomZone[],
  partitions: FreePartition[],
  searchRadiusMm: number
): WallCandidate[] {
  const candidates: WallCandidate[] = [];
  const sourceRooms = room ? [room] : rooms;

  for (const candidateRoom of sourceRooms) {
    const count = candidateRoom.vertices.length;
    for (let i = 0; i < count; i++) {
      const a = candidateRoom.vertices[i];
      const b = candidateRoom.vertices[(i + 1) % count];
      const len = distance(a, b);
      if (len < 1) continue;
      const proj = projectPointOnSegment(cursor, a, b);
      if (proj.distance > searchRadiusMm) continue;
      const offsetMm = proj.t * len;
      candidates.push({
        kind: 'room_edge',
        distanceMm: proj.distance,
        roomId: candidateRoom.id,
        edgeIndex: i,
        lengthMm: len,
        point: proj.point,
        inward: inwardNormalForEdge(candidateRoom, a, b),
        offsetMm,
      });
    }
  }

  const sourcePartitions = room
    ? partitions.filter((partition) => partition.roomId === room.id)
    : partitions;

  for (const partition of sourcePartitions) {
    const proj = projectPointOnSegment(cursor, partition.p1, partition.p2);
    if (proj.distance > searchRadiusMm) continue;
    const len = distance(partition.p1, partition.p2);
    if (len < 1) continue;
    const dir = {
      x: (partition.p2.x - partition.p1.x) / len,
      y: (partition.p2.y - partition.p1.y) / len,
    };
    const normal = { x: -dir.y, y: dir.x };
    const side =
      (cursor.x - partition.p1.x) * normal.x + (cursor.y - partition.p1.y) * normal.y >= 0
        ? 1
        : -1;
    candidates.push({
      kind: 'partition',
      distanceMm: proj.distance,
      roomId: partition.roomId,
      partitionId: partition.id,
      lengthMm: len,
      point: proj.point,
      inward: { x: normal.x * side, y: normal.y * side },
      offsetMm: proj.t * len,
    });
  }

  return candidates;
}

export function findDevicePlacement(
  type: DeviceType,
  cursor: Point2D,
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number,
  sharedRequested: boolean
): DevicePlacementResult {
  const catalog = DEVICE_CATALOG[type];

  if (catalog.mounting === 'ceiling') {
    const room = rooms.find((candidate) => pointInRoom(cursor, candidate));
    if (!room) {
      return { ok: false, error: 'Светильник размещается внутри комнаты.' };
    }
    const position = {
      x: Math.round(cursor.x / 10) * 10,
      y: Math.round(cursor.y / 10) * 10,
    };
    return {
      ok: true,
      anchor: { kind: 'room_point', roomId: room.id, x: position.x, y: position.y },
      position,
      rotationDeg: 0,
      roomId: room.id,
      isShared: false,
    };
  }

  const hostRoom = rooms.find((candidate) => pointInRoom(cursor, candidate)) ?? null;
  const searchRadius = hostRoom ? 400 : 350;
  const candidates = collectCandidates(cursor, hostRoom, rooms, partitions, searchRadius);
  if (candidates.length === 0) {
    return {
      ok: false,
      error: 'Поднесите курсор к внутренней грани стены комнаты или к перегородке.',
    };
  }

  candidates.sort((a, b) => a.distanceMm - b.distanceMm);
  const best = candidates[0];

  const margin = Math.min(100, best.lengthMm / 2);
  const offsetMm =
    best.lengthMm > 2 * margin
      ? Math.min(
          best.lengthMm - margin,
          Math.max(margin, Math.round(best.offsetMm / 50) * 50)
        )
      : best.lengthMm / 2;

  if (best.kind === 'partition' && best.partitionId) {
    if (sharedRequested) {
      return {
        ok: false,
        error: 'Сквозное устройство ставится только на стену между двумя комнатами, не на перегородку.',
      };
    }
    const partition = partitions.find((candidate) => candidate.id === best.partitionId);
    if (!partition) {
      return { ok: false, error: 'Перегородка не найдена.' };
    }
    const len = distance(partition.p1, partition.p2);
    const dir = {
      x: (partition.p2.x - partition.p1.x) / len,
      y: (partition.p2.y - partition.p1.y) / len,
    };
    const normal = { x: -dir.y, y: dir.x };
    const side =
      (cursor.x - partition.p1.x) * normal.x + (cursor.y - partition.p1.y) * normal.y >= 0
        ? 1
        : -1;
    return {
      ok: true,
      anchor: {
        kind: 'partition',
        partitionId: best.partitionId,
        offsetMm,
        side: side as 1 | -1,
      },
      position: {
        x: partition.p1.x + dir.x * offsetMm,
        y: partition.p1.y + dir.y * offsetMm,
      },
      rotationDeg: rotationForInward({ x: normal.x * side, y: normal.y * side }),
      roomId: best.roomId,
      isShared: false,
    };
  }

  if (best.edgeIndex === undefined) {
    return { ok: false, error: 'Не удалось определить грань стены.' };
  }

  const anchor: DeviceAnchor = {
    kind: 'room_edge',
    roomId: best.roomId,
    edgeIndex: best.edgeIndex,
    offsetMm,
  };

  const host = rooms.find((candidate) => candidate.id === best.roomId);
  if (!host) return { ok: false, error: 'Комната не найдена.' };

  let isShared = false;
  if (sharedRequested) {
    const adjacent = findAdjacentRoomEdge(
      host.id,
      best.point,
      { x: -best.inward.x, y: -best.inward.y },
      rooms,
      thickness
    );
    if (!adjacent) {
      return {
        ok: false,
        error: 'Рядом нет смежной комнаты. Снимите флажок «Сквозная».',
      };
    }
    isShared = true;
  }

  const a = host.vertices[best.edgeIndex];
  const b = host.vertices[(best.edgeIndex + 1) % host.vertices.length];
  const len = distance(a, b);
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };

  return {
    ok: true,
    anchor,
    position: { x: a.x + dir.x * offsetMm, y: a.y + dir.y * offsetMm },
    rotationDeg: rotationForInward(best.inward),
    roomId: best.roomId,
    isShared,
  };
}

export function sanitizeDevices(
  devices: ElectricalDevice[],
  rooms: RoomZone[],
  partitions: FreePartition[],
  thickness: number
): ElectricalDevice[] {
  return devices.filter((device) => resolveDevice(device, rooms, partitions, thickness) !== null);
}
