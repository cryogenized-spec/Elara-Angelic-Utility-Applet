import './portrait-banner.css';

export type PortraitScale = 1 | 2 | 3;

interface PortraitBannerProps {
  collapsed: boolean;
  scale?: PortraitScale;
}

export function PortraitBanner({ collapsed, scale = 2 }: PortraitBannerProps) {
  return (
    <section
      className={`elara-banner${collapsed ? ' is-collapsed' : ''} portrait-scale-${scale}`}
      aria-label="Elara portrait banner"
    >
      <div className="elara-banner__art" role="img" aria-label="Elara portrait placeholder">
        <div className="elara-banner__portrait" aria-hidden="true">
          <div className="elara-banner__halo" />
          <div className="elara-banner__silhouette">E</div>
        </div>
      </div>
      <div className="elara-banner__copy">
        <span className="eyebrow">ANGELIC UTILITY APPLET</span>
        <h1>Elara</h1>
        <span className="presence"><i /> Online · ready</span>
      </div>
    </section>
  );
}
