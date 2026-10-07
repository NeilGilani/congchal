import {
  Accessibility,
  Activity,
  ArrowUpDown,
  Award,
  BadgeCheck,
  Ban,
  Building,
  Bug,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  CircleDot,
  CircleQuestionMark,
  ClipboardCheck,
  Clock,
  CloudOff,
  Construction,
  Copy,
  Cpu,
  Crosshair,
  Download,
  Droplets,
  ExternalLink,
  Eye,
  FileText,
  Flag,
  FlaskConical,
  Footprints,
  Gauge,
  Image,
  Info,
  Landmark,
  Layers,
  LocateFixed,
  LocateOff,
  Lock,
  Mail,
  Map,
  MapPin,
  OctagonAlert,
  Pencil,
  Phone,
  RotateCcw,
  Route,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Signpost,
  SlidersHorizontal,
  Smartphone,
  Sofa,
  SprayCan,
  Target,
  Trash,
  TreeDeciduous,
  TriangleAlert,
  Undo2,
  WavesHorizontal,
  WifiOff,
  X,
  Zap,
  ZapOff,
  type LucideIcon,
} from 'lucide-react-native';

import { Platform } from 'react-native';

import type { IconName as CategoryIconName } from '@/constants/categories';
import { colors } from '@/constants/theme';

const ICONS = {
  accessibility: Accessibility,
  activity: Activity,
  sort: ArrowUpDown,
  award: Award,
  verified: BadgeCheck,
  ban: Ban,
  building: Building,
  bug: Bug,
  camera: Camera,
  check: Check,
  back: ChevronLeft,
  chevron: ChevronRight,
  checkCircle: CircleCheck,
  dot: CircleDot,
  help: CircleQuestionMark,
  clipboard: ClipboardCheck,
  clock: Clock,
  offline: CloudOff,
  copy: Copy,
  cpu: Cpu,
  crosshair: Crosshair,
  download: Download,
  external: ExternalLink,
  eye: Eye,
  file: FileText,
  flag: Flag,
  flask: FlaskConical,
  gauge: Gauge,
  gallery: Image,
  info: Info,
  landmark: Landmark,
  layers: Layers,
  locate: LocateFixed,
  locateOff: LocateOff,
  lock: Lock,
  mail: Mail,
  map: Map,
  pin: MapPin,
  alertOctagon: OctagonAlert,
  edit: Pencil,
  phone: Phone,
  retry: RotateCcw,
  route: Route,
  search: Search,
  settings: Settings,
  share: Share2,
  shield: ShieldCheck,
  filter: SlidersHorizontal,
  phoneDevice: Smartphone,
  target: Target,
  delete: Trash,
  warning: TriangleAlert,
  undo: Undo2,
  wifiOff: WifiOff,
  close: X,
  flash: Zap,
  flashOff: ZapOff,
  // category glyphs
  pothole: Construction,
  crack: Route,
  sidewalk: Footprints,
  graffiti: SprayCan,
  trash: Trash,
  dumping: Sofa,
  sign: Signpost,
  tree: TreeDeciduous,
  water: Droplets,
  waves: WavesHorizontal,
  obstruction: Accessibility,
  other: Flag,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

// Every category icon must resolve.
const _categoryCheck: Record<CategoryIconName, LucideIcon> = ICONS;
void _categoryCheck;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
}

/**
 * Hides a decorative graphic from screen readers. On the web the SVG is a DOM
 * element, which only understands aria-hidden (the native props would leak
 * into the DOM as unknown attributes).
 */
export const decorativeProps =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as const)
    : ({ accessibilityElementsHidden: true, importantForAccessibility: 'no' } as const);

/** Decorative by default: pair icons with text (or give the parent an accessibilityLabel). */
export const Icon = ({ name, size = 22, color = colors.text, strokeWidth = 1.8 }: IconProps) => {
  const Cmp = ICONS[name];
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} {...decorativeProps} />;
};
