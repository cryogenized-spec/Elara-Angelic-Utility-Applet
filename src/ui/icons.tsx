import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  CalendarDays,
  ChevronDown,
  FileCode2,
  ListTodo,
  Mail,
  Maximize2,
  Menu,
  MessageSquare,
  Mic,
  Minimize2,
  MoreHorizontal,
  Palette,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Type,
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
  | 'sparkles'
  | 'close'
  | 'search'
  | 'dots'
  | 'expand'
  | 'collapse'
  | 'markdown';

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
  sparkles: Sparkles,
  close: X,
  search: Search,
  dots: MoreHorizontal,
  expand: Maximize2,
  collapse: Minimize2,
  markdown: FileCode2,
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
