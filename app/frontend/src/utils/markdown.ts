/** Strip a leading YAML frontmatter block (`--- ... ---`) from raw markdown content. */
export function stripFrontmatter(raw: string): string {
  return raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}
