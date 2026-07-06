/** Split a comma-separated product area string ("Web App, Mobile App") into trimmed, non-empty parts for per-area badges. */
export function splitProductAreas(productArea: string): string[] {
  return productArea.split(',').map(area => area.trim()).filter(Boolean);
}
