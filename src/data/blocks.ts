// Vanilla block library produced by `npm run import:blocks` (data/generated/blocks, not versioned).

export interface IconFace {
  /** File name in data/generated/blocks/textures. */
  texture: string;
  /** Tint colour applied by multiplication (grass, leaves). */
  tint?: string;
}

export type BlockIconData =
  | { kind: 'cube'; top: IconFace[]; left: IconFace[]; right: IconFace[] }
  | { kind: 'flat'; texture: string; tint?: string }
  | { kind: 'none'; reason: string };

export interface LibraryBlock {
  id: string;
  en: string;
  fr?: string;
  icon: BlockIconData;
}

const libraryFile = import.meta.glob('/data/generated/blocks/blocks.json', { eager: true, import: 'default' }) as Record<
  string,
  { version: string; blocks: LibraryBlock[] }
>;
const textureFiles = import.meta.glob('/data/generated/blocks/textures/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const data = Object.values(libraryFile)[0];

export const blockLibraryVersion = data?.version;
export const blockLibrary: LibraryBlock[] = (data?.blocks ?? []).slice().sort((a, b) => (a.fr ?? a.en).localeCompare(b.fr ?? b.en, 'fr'));

export function textureUrl(file: string): string | undefined {
  return textureFiles[`/data/generated/blocks/textures/${file}`];
}
