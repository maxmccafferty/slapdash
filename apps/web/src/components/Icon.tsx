import {
  ArrowUp,
  Camera,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileDown,
  Folder,
  FolderOpen,
  Image,
  Layers,
  List,
  ListOrdered,
  MessageCircle,
  Mic,
  Plus,
  Redo2,
  Square,
  TriangleAlert,
  Undo2,
  Upload,
  X,
  type LucideIcon,
} from 'lucide-react';

const ICONS = {
  save: Download,
  load: FolderOpen,
  undo: Undo2,
  redo: Redo2,
  materials: List,
  steps: ListOrdered,
  project: Folder,
  floors: Layers,
  eye: Eye,
  chat: MessageCircle,
  mic: Mic,
  send: ArrowUp,
  close: X,
  camera: Camera,
  image: Image,
  stop: Square,
  pdf: FileDown,
  warning: TriangleAlert,
  plus: Plus,
  upload: Upload,
  back: ChevronLeft,
  next: ChevronRight,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

/** `key`: 13px at 1.3px stroke (desktop keys). `phone`: 20px at 1.5px (phone corner keys). */
export type IconSize = 'key' | 'phone';

const SIZES: Record<IconSize, { size: number; stroke: number }> = {
  key: { size: 13, stroke: 1.3 },
  phone: { size: 20, stroke: 1.5 },
};

/** Outline icon in `currentColor` (ink), round joins. Always decorative: the key carries the name. */
export function Icon({ name, size = 'key' }: { name: IconName; size?: IconSize }) {
  const Component = ICONS[name];
  const s = SIZES[size];
  return <Component size={s.size} strokeWidth={s.stroke} absoluteStrokeWidth aria-hidden="true" focusable="false" />;
}
