Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "opportunities": [
    {
      "title": "Short opportunity name",
      "description": "2-4 sentences: what the opportunity is, who it serves, why now.",
      "rationale": "How this idea was derived — the reasoning chain from evidence to idea.",
      "confidence": 0.0,
      "evidence": [
        {
          "sourceTitle": "Exact source document title, or web page title if from a search result",
          "sourceId": "discovery_sources.id if this evidence came from an uploaded document — omit entirely if from web search",
          "quote": "Short supporting quote or paraphrase, taken only from text actually present in the source",
          "url": "Only if from a web search result that returned this exact URL"
        }
      ]
    }
  ]
}
```

Rules:
- Produce 3–8 opportunities. Quality over quantity — do not pad to hit a count.
- `confidence` is 0.0–1.0: your own estimate of how strong the supporting evidence is.
- Every opportunity must have at least one evidence entry.
- Check the "Current App State" section of your context. Do not suggest an opportunity that
  duplicates an existing item or feature already in the backlog; if a close match exists,
  either skip the idea or explicitly note the differentiation in `rationale`.
- For uploaded-document evidence, never invent a quote — only quote or paraphrase text that
  is literally present in the source content you were given.
- For web evidence, follow the same anti-hallucination citation rules as research: only cite
  a URL actually returned by a search in this conversation. If you have no web search tool
  available in this session, omit web-sourced opportunities entirely rather than guessing.
