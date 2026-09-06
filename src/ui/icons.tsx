import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bot,
  CalendarDays,
  ChevronDown,
  FileCode2,
  ListTodo,
  Loader2,
  LockKeyhole,
  Mail,
  Maximize2,
  Menu,
  MessageCircle,
  MessageSquare,
  Mic,
  Minimize2,
  MoreHorizontal,
  Palette,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Type,
  WandSparkles,
  X,
} from 'lucide-react';

export type IconName =
  | 'menu'
  | 'settings'
  | 'calendar'
  | 'tasks'
  | 'mail'
  | 'plus'
  | 'paperclip'
  | 'mic'
  | 'send'
  | 'chevron'
  | 'shield'
  | 'type'
  | 'palette'
  | 'chat'
  | 'bot'
  | 'message-circle'
  | 'sparkles'
  | 'wand-sparkles'
  | 'lock-keyhole'
  | 'close'
  | 'search'
  | 'dots'
  | 'expand'
  | 'collapse'
  | 'markdown'
  | 'stop'
  | 'refresh'
  | 'trash'
  | 'loader';

const icons: Record<IconName, LucideIcon> = {
  menu: Menu,
  settings: Settings,
  calendar: CalendarDays,
  tasks: ListTodo,
  mail: Mail,
  plus: Plus,
  paperclip: Paperclip,
  mic: Mic,
  send: Send,
  chevron: ChevronDown,
  shield: ShieldCheck,
  type: Type,
  palette: Palette,
  chat: MessageSquare,
  bot: Bot,
  'message-circle': MessageCircle,
  sparkles: Sparkles,
  'wand-sparkles': WandSparkles,
  'lock-keyhole': LockKeyhole,
  close: X,
  search: Search,
  dots: MoreHorizontal,
  expand: Maximize2,
  collapse: Minimize2,
  markdown: FileCode2,
  stop: Square,
  refresh: RefreshCw,
  trash: Trash2,
  loader: Loader2,
};

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.8,
  style,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}) {
  const Component = icons[name];
  return <Component aria-hidden="true" size={size} strokeWidth={strokeWidth} style={style} />;
}
