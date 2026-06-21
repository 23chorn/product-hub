/**
 * Backend (publish) rendering of structured JSON artifacts to markdown for external
 * publishing (e.g. the ADO wiki). The converters live in @pap/shared so this rendering
 * can't drift from the in-app display; here we only pin the 'publish' variant and the
 * publish contract of returning the original content when no converter exists.
 */
import { renderArtifactMarkdown } from '@pap/shared';

/**
 * Convert a JSON artifact string to markdown.
 * Returns the original content unchanged if no converter exists for the type
 * (e.g. content that is already markdown, or a specialised view type).
 */
export function convertArtifactToMarkdown(artifactType: string, content: string): string {
  return renderArtifactMarkdown(artifactType, content, 'publish') ?? content;
}
