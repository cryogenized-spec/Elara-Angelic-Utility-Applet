export function MarkdownIcon({ size = 24, color = 'currentColor', className = '' }: { size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 208 128" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <rect width="208" height="128" rx="12" fill={color} fillOpacity="0.1" stroke={color} strokeWidth="10" />
      <path d="M30 98V30h20l20 25 20-25h20v68H90V58L70 83 50 58v40H30zm110 0l-30-35h20V30h20v33h20l-30 35z" fill={color} />
    </svg>
  );
}
