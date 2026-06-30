/** One screen entry from a figma_design artifact's `screens_created` array. */
export interface FigmaScreenRef {
  name: string;
  frame_url?: string;
  description?: string;
  prd_journeys?: string[];
  layout_notes?: string;
  interactions?: Array<{ trigger?: string; target_screen?: string; notes?: string }>;
}

export interface ParsedFigmaDesign {
  figmaFileUrl: string | null;
  screens: FigmaScreenRef[];
  title?: string;
  designGaps?: string[];
  navigationFlow?: string;
  notes?: string;
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
          .map((s: any) => ({
            name: s.name,
            frame_url: s.frame_url || undefined,
            description: s.description || undefined,
            prd_journeys: Array.isArray(s.prd_journeys) && s.prd_journeys.length ? s.prd_journeys : undefined,
            layout_notes: s.layout_notes || undefined,
            interactions: Array.isArray(s.interactions) && s.interactions.length ? s.interactions : undefined,
          }))
      : [];
    return {
      figmaFileUrl: parsed.figma_file_url || null,
      screens,
      title: parsed.title || undefined,
      designGaps: Array.isArray(parsed.design_gaps) && parsed.design_gaps.length ? parsed.design_gaps : undefined,
      navigationFlow: parsed.navigation_flow || undefined,
      notes: parsed.notes || undefined,
    };
  } catch {
    return { figmaFileUrl: null, screens: [] };
  }
}
