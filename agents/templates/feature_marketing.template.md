Output a single valid JSON object wrapped in a ```json code block. No prose before or after the block.

Schema:

```json
{
  "feature_name": {
    "recommended": { "name": "Feature name", "tagline": "Short benefit-focused phrase", "rationale": "One sentence why this works for the target audience" },
    "alternative_a": { "name": "Alternative name", "tagline": "Alternative tagline", "rationale": "One sentence" },
    "alternative_b": { "name": "Alternative name", "tagline": "Alternative tagline", "rationale": "One sentence" }
  },
  "value_proposition": "≤20 words. Benefit-first. Describes what changes for the user — not what the feature does.",
  "messaging_hierarchy": {
    "headline": "≤8 words",
    "sub_headline": "≤25 words",
    "supporting_bullets": ["Specific outcome, no generic superlatives", "Specific outcome", "Specific outcome"]
  },
  "channel_copy": {
    "app_store": "≤170 characters, plain text, no markdown",
    "website_hero": {
      "headline": "Headline",
      "body": "Sentence 1 — what it does and who it's for. Sentence 2 — the outcome or proof point."
    },
    "email": {
      "subject_line": "≤60 characters",
      "body_paragraph_1": "Hook. Opens with the problem or moment this feature solves. 2–3 sentences.",
      "body_paragraph_2": "Benefit detail. What specifically changes for the reader? 2–3 sentences.",
      "body_paragraph_3": "CTA. Clear single action. Where do they go next? 1–2 sentences."
    },
    "linkedin": "≤150 words, professional but conversational, ends with a question",
    "twitter": "≤280 characters + one hashtag",
    "short_form_social": {
      "instagram": { "hook_concept": "What stops the scroll", "format": "Carousel|Reel|Static", "caption_style": "Tone and length guidance", "hashtag_approach": "3–5 hashtag categories" },
      "tiktok": { "hook_concept": "First 3 seconds concept", "format": "Tutorial|Before-after|POV|Trending sound", "caption_style": "Short and punchy|question-led|CTA-focused", "hashtag_approach": "Mix of broad and niche tags" }
    }
  },
  "internal_faq": [
    { "question": "Real question sales/support will get", "answer": "2–3 sentence answer. User-facing language only." }
  ]
}
```

Rules:
- internal_faq must contain exactly 5 entries.
- Do not reference features not in the approved PRD or GTM strategy.
- Do not suggest product changes.
