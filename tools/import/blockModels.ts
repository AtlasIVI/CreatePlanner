// Resolves vanilla block item models into something the UI can draw as an inventory icon:
// a full cube (top / left / right faces as seen in the inventory) or a flat texture.

type Json = Record<string, unknown>;
type Vec3 = [number, number, number];

export interface FaceLayer {
  /** Texture path, e.g. "block/grass_block_side". */
  texture: string;
  /** The face is tinted (grass, foliage). */
  tinted: boolean;
}

export type BlockIcon =
  | { kind: 'cube'; top: FaceLayer[]; left: FaceLayer[]; right: FaceLayer[] }
  | { kind: 'flat'; texture: string; tinted: boolean }
  | { kind: 'none'; reason: string };

export interface ResolvedModel {
  textures: Record<string, string>;
  elements?: Json[];
  /** Ends in builtin/generated (flat item) or builtin/entity (special renderer). */
  builtin?: 'generated' | 'entity';
}

const strip = (s: string) => s.replace(/^minecraft:/, '');

/** Merge a model with its parents: child textures win, elements come from the closest model defining them. */
export function resolveModel(name: string, getModel: (path: string) => Json | undefined, depth = 0): ResolvedModel | undefined {
  const path = strip(name);
  if (path === 'builtin/generated') return { textures: {}, builtin: 'generated' };
  if (path === 'builtin/entity') return { textures: {}, builtin: 'entity' };
  if (depth > 20) return undefined;
  const m = getModel(path);
  if (!m) return undefined;
  const parent = typeof m.parent === 'string' ? resolveModel(m.parent, getModel, depth + 1) : undefined;
  const own = (m.textures ?? {}) as Record<string, string>;
  return {
    textures: { ...(parent?.textures ?? {}), ...own },
    elements: Array.isArray(m.elements) ? (m.elements as Json[]) : parent?.elements,
    builtin: Array.isArray(m.elements) ? undefined : parent?.builtin,
  };
}

/** Follow "#var" references to a texture path. */
export function resolveTexture(ref: string | undefined, textures: Record<string, string>, depth = 0): string | undefined {
  if (!ref || depth > 10) return undefined;
  if (ref.startsWith('#')) return resolveTexture(textures[ref.slice(1)], textures, depth + 1);
  return strip(ref);
}

const isFullCube = (e: Json) => {
  const from = e.from as Vec3 | undefined;
  const to = e.to as Vec3 | undefined;
  return !!from && !!to && from.every((v) => v === 0) && to.every((v) => v === 16) && !e.rotation;
};

// Minecraft's inventory view (display.gui rotation [30, 225, 0]) shows the top,
// the north face on the left and the west face on the right.
export const VISIBLE = { top: 'up', left: 'north', right: 'west' } as const;

export function iconFromModel(model: ResolvedModel | undefined): BlockIcon {
  if (!model) return { kind: 'none', reason: 'modèle introuvable' };
  if (model.builtin === 'generated') {
    const texture = resolveTexture(model.textures.layer0, model.textures);
    return texture ? { kind: 'flat', texture, tinted: false } : { kind: 'none', reason: 'texture introuvable' };
  }
  if (model.builtin === 'entity') return { kind: 'none', reason: 'rendu spécial (entité de bloc)' };
  const elements = model.elements ?? [];
  if (elements.length > 0 && elements.every(isFullCube)) {
    const face = (dir: string): FaceLayer[] =>
      elements.flatMap((e) => {
        const f = (e.faces as Record<string, Json> | undefined)?.[dir];
        const texture = f ? resolveTexture(f.texture as string, model.textures) : undefined;
        return texture ? [{ texture, tinted: f!.tintindex !== undefined }] : [];
      });
    const icon = { kind: 'cube' as const, top: face(VISIBLE.top), left: face(VISIBLE.left), right: face(VISIBLE.right) };
    if (icon.top.length && icon.left.length && icon.right.length) return icon;
  }
  // Not a plain cube (stairs, slabs, fences...): show its main texture for now.
  const texture = resolveTexture(model.textures.particle ?? Object.values(model.textures)[0], model.textures);
  return texture ? { kind: 'flat', texture, tinted: false } : { kind: 'none', reason: 'forme non gérée' };
}

/** Default inventory tint of a tinted block (biome-independent item colours). */
export function tintFor(block: string): string {
  if (block === 'birch_leaves') return '#80a755';
  if (block === 'spruce_leaves') return '#619961';
  if (block.endsWith('leaves') || block === 'vine') return '#48b518';
  if (block === 'lily_pad') return '#208030';
  return '#91bd59';
}
