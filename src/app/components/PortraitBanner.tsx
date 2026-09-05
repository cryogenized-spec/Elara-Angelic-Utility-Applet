import type { CharacterArtworkMode, CharacterArtworkReference } from '../../domain/character';
import './portrait-banner.css';

export type PortraitScale = 1 | 2 | 3;
export type PortraitBackground = 'midnight' | 'blue-hour' | 'violet' | 'rose';

interface PortraitBannerProps {
  collapsed: boolean;
  scale?: PortraitScale;
  background?: PortraitBackground;
  artworkMode?: CharacterArtworkMode;
  artwork?: CharacterArtworkReference | null;
  characterName?: string;
}

export function PortraitBanner({ collapsed, scale = 2, background = 'midnight', artworkMode = 'portrait', artwork = null, characterName = '' }: PortraitBannerProps) {
  const artworkStyle = artwork ? { objectPosition: `${artwork.focalX}% ${artwork.focalY}%` } : undefined;
  return <section className={`elara-banner portrait-background-${background}${collapsed ? ' is-collapsed' : ''} portrait-scale-${scale} artwork-mode-${artworkMode}`} aria-label={`${characterName} character banner`}>
    <div className="elara-banner__art" role="img" aria-label={artwork ? `${characterName} artwork` : `${characterName} portrait placeholder`}>
      {artwork ? <img className="elara-banner__image" src={artwork.dataUrl} alt="" style={artworkStyle} /> : <div className="elara-banner__portrait" aria-hidden="true"><div className="elara-banner__halo" /><div className="elara-banner__silhouette">{characterName.slice(0, 1).toUpperCase()}</div></div>}
    </div>
    <div className="elara-banner__copy"><span className="eyebrow">ANGELIC UTILITY APPLET</span><h1>{characterName}</h1><span className="presence"><i /> Online · ready</span></div>
  </section>;
}
