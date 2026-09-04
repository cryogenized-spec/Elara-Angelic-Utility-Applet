import type { CSSProperties, ReactNode } from 'react';

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

const paths: Record<IconName, ReactNode> = {
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  settings: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.74v.5a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" /><circle cx="12" cy="12" r="3" /></>,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M8 3v4M16 3v4M4 10h16" /></>,
  tasks: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="m8 9 1.5 1.5L12 8M8 15h8" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  paperclip: <><path d="M8.5 12.5 15.6 5.4a3.35 3.35 0 0 1 4.75 4.75l-8.9 8.9a4.85 4.85 0 0 1-6.86-6.86l8.56-8.56" /></>,
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" /></>,
  send: <><path d="m4 4 16 8-16 8 3-8-3-8Z" /><path d="M7 12h8" /></>,
  chevron: <><path d="m8 10 4 4 4-4" /></>,
  shield: <><path d="M12 3 19 6v5c0 4.4-2.8 8-7 10-4.2-2-7-5.6-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  type: <><path d="M4 5h10M9 5v14M6 19h6" /><path d="M15 10h6M18 10v9M16 19h4" /></>,
  palette: <><path d="M12 3a9 9 0 0 0 0 18h1.2a1.8 1.8 0 0 0 1.2-3.1 1.8 1.8 0 0 1 1.2-3.1h1.8A3.6 3.6 0 0 0 22 11.2C22 6.7 17.5 3 12 3Z" /><path d="M7.5 9.5h.01M10 7h.01M14 7h.01M16.5 9.5h.01" /></>,
  chat: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4V15.5A2.5 2.5 0 0 1 4 13Z" /></>,
  sparkles: <><path d="m12 3-1.4 4.6L6 9l4.6 1.4L12 15l1.4-4.6L18 9l-4.6-1.4L12 3Z" /><path d="m19 15-.7 2.3L16 18l2.3.7L19 21l.7-2.3L19 15Z" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  dots: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
  expand: <><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M20 15v5h-5" /></>,
  collapse: <><path d="M9 3v6H3M15 3v6h6M9 21v-6H3M21 15v6h-6" /></>,
  markdown: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M6 15V9l3 3 3-3v6M16 15V9m0 0 2 2 2-2" /></>,
};

export function Icon({ name, size = 20, strokeWidth = 1.7, style }: { name: IconName; size?: number; strokeWidth?: number; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>{paths[name]}</svg>;
}
