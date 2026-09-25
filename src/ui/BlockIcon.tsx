// Inventory-style block icon: a CSS 3D cube seen like Minecraft's GUI (top, north on the left,
// west on the right) with the game's side shading, or a flat texture for non-cube blocks.

import type { CSSProperties } from 'react';
import { textureUrl, type BlockIconData, type IconFace } from '../data/blocks';

function layerStyle(f: IconFace): CSSProperties | undefined {
  const url = textureUrl(f.texture);
  if (!url) return undefined;
  if (!f.tint) return { backgroundImage: `url(${url})` };
  // Tinted layers (grass, leaves): multiply the texture by the tint, keep its transparency.
  return {
    backgroundImage: `url(${url})`,
    backgroundColor: f.tint,
    backgroundBlendMode: 'multiply',
    maskImage: `url(${url})`,
    WebkitMaskImage: `url(${url})`,
  };
}

function Face({ layers, className }: { layers: IconFace[]; className: string }) {
  return (
    <div className={`bi-face ${className}`}>
      {layers.map((l, i) => (
        <div key={i} className="bi-layer" style={layerStyle(l)} />
      ))}
    </div>
  );
}

export function BlockIcon({ icon, size = 40, label }: { icon: BlockIconData; size?: number; label: string }) {
  if (icon.kind === 'cube') {
    const c = Math.round(size / 1.6);
    return (
      <div className="block-icon" style={{ width: size, height: size }} role="img" aria-label={label}>
        <div className="bi-cube" style={{ width: c, height: c, ['--half' as string]: `${c / 2}px` }}>
          <Face layers={icon.top} className="bi-top" />
          <Face layers={icon.left} className="bi-left" />
          <Face layers={icon.right} className="bi-right" />
        </div>
      </div>
    );
  }
  if (icon.kind === 'flat') {
    const style = layerStyle({ texture: icon.texture, tint: icon.tint });
    return (
      <div className="block-icon" style={{ width: size, height: size }} role="img" aria-label={label}>
        <div className="bi-flat" style={{ width: size * 0.8, height: size * 0.8, ...style }} />
      </div>
    );
  }
  return (
    <div className="block-icon bi-none" style={{ width: size, height: size, fontSize: size * 0.45 }} role="img" aria-label={label} title={icon.reason}>
      {label.charAt(0).toUpperCase()}
    </div>
  );
}
