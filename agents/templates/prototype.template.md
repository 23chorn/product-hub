Produce a single valid JSON object wrapped in a ```json code block. No prose before or after — just the JSON block.

The JSON defines a complete, self-contained React prototype with these exact keys:

```json
{
  "title": "Short prototype name",
  "description": "One sentence: what user flow this prototype demonstrates",
  "screens": ["ScreenName1", "ScreenName2"],
  "entryScreen": "ScreenName1",
  "files": {
    "/App.tsx": "...",
    "/screens/ScreenName1.tsx": "...",
    "/components/Button.tsx": "...",
    "/data/mock-data.ts": "...",
    "/styles.css": "..."
  }
}
```

Rules:
- **files** is a flat key-value map: file path (string) → file content (string)
- `/App.tsx` is the entry point — it must render the current screen based on a `useState<string>` router
- `/styles.css` must NOT import design-tokens.css or design-system-utilities.css — they are injected automatically; only add custom CSS that Tailwind can't handle
- All components use TypeScript (.tsx) and Tailwind classes from the design system
- Include `/data/mock-data.ts` with realistic domain data (not lorem ipsum)
- Maximum 8 screens, 15 files total
- No external dependencies, no fetch calls, no react-router
- Every screen must accept `navigate: (screen: string) => void` as a prop
- Screens must be ordered: `screens[0]` is the entry point shown on load
- Interactive: buttons navigate, forms update state, lists expand/collapse
- Mobile-first: use responsive Tailwind classes, design for 375px minimum width
