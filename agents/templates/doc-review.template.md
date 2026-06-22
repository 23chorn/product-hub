Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "suggestions": [
    {
      "quote": "Short excerpt copied verbatim from the file this suggestion refers to — omit if the suggestion is about the file as a whole.",
      "comment": "What's wrong and what would fix it.",
      "severity": "minor"
    }
  ]
}
```

Rules:
- 0–8 suggestions. An empty array is a valid, good outcome for a well-written doc.
- `severity` is `"minor"` or `"major"` — see the persona's definition of each.
- `quote` must be copied verbatim from the file content you were given, never invented.
- Never include a suggestion that proposes rewriting the whole file — point at specific
  passages or specific gaps instead.
