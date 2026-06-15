# Figma Design Output Template

Produce a single valid JSON object matching the schema below, wrapped in a ```json code block. No prose before or after.

```json
{
  "title": "Figma Mockups: <feature name>",
  "figma_file_url": "https://www.figma.com/file/<FIGMA_MOCKUP_FILE>/...",
  "figma_write_status": "planned | created | partial",
  "source_design_system": "<FIGMA_DESIGN_SYSTEM_FILE key>",

  "design_tokens_extracted": {
    "colors": [
      { "name": "<token name>", "value": "<hex or rgba>", "usage": "<e.g. primary background>" }
    ],
    "typography": [
      { "name": "<style name>", "font_family": "<family>", "size": "<px>", "weight": "<weight>", "usage": "<e.g. section headers>" }
    ],
    "spacing": [
      { "name": "<token name>", "value": "<px>", "usage": "<e.g. content padding>" }
    ],
    "components": [
      { "name": "<component name>", "node_id": "<figma node id>", "variants": ["<variant1>", "<variant2>"] }
    ],
    "design_gaps": [
      "<component or token that is missing from the design system and needs to be created>"
    ]
  },

  "screens_created": [
    {
      "name": "<screen name, e.g. Channel List>",
      "frame_id": "<figma node id, empty if write deferred>",
      "frame_url": "<https://www.figma.com/file/...?node-id=..., empty if write deferred>",
      "size": { "width": 390, "height": 844 },
      "prd_journeys": ["<journey name from PRD>"],
      "description": "<one sentence describing what this screen shows and its role in the flow>",
      "layout_notes": "<key layout decisions: grid, spacing, component choices>",
      "interactions": [
        { "trigger": "<tap/swipe/input>", "target_screen": "<screen name>", "notes": "<optional context>" }
      ],
      "tokens_used": ["<list of token names applied in this screen>"]
    }
  ],

  "navigation_flow": "<ASCII diagram showing screen-to-screen navigation>",

  "notes": "<Design rationale, deferred decisions, or gaps to resolve before Figma write>"
}
```

## Field requirements

- `figma_write_status`: Use `"planned"` when `FIGMA_MOCKUP_FILE` is not set or write is deferred. Use `"created"` when all frames were successfully written. Use `"partial"` if some frames were written.
- `design_tokens_extracted.colors`: Include at minimum the primary brand color, background, text, and interactive/CTA token.
- `design_tokens_extracted.design_gaps`: List any component or token needed for the mockups that does not exist in the design system. An empty array means the design system is sufficient.
- `screens_created`: Minimum 3, maximum 8. Each screen must correspond to a named user journey from the PRD.
- `navigation_flow`: ASCII diagram showing how screens connect. Example: `ChannelList → ChannelDetail → Compose → ChannelDetail`
- `notes`: Required. Include at minimum: whether the Figma write was executed or deferred, and any design gaps flagged.
