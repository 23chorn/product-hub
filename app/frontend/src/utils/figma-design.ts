/** One screen entry from a figma_design artifact's `screens_created` array. */
export interface FigmaScreenRef {
  name: string;
  frame_url?: string;
}

export interface ParsedFigmaDesign {
  figmaFileUrl: string | null;
  screens: FigmaScreenRef[];
}

/**
 * Parses a figma_design artifact's content (raw JSON, optionally fenced in
 * ```json) into the file-level URL and per-screen frame refs. Shared by every
 * surface that renders the figma_design checkpoint UI so the fence-stripping
 * and shape stay in one place.
 */
export function parseFigmaDesignContent(content: string | null | undefined): ParsedFigmaDesign {
  if (!content) return { figmaFileUrl: null, screens: [] };
  try {
    const cleaned = content.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned);
    const screens: FigmaScreenRef[] = Array.isArray(parsed.screens_created)
      ? parsed.screens_created
          .filter((s: any) => s && typeof s.name === 'string')
          .map((s: any) => ({ name: s.name, frame_url: s.frame_url || undefined }))
      : [];
    return { figmaFileUrl: parsed.figma_file_url || null, screens };
  } catch {
    return { figmaFileUrl: null, screens: [] };
  }
}
