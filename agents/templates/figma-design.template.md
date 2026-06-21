# Figma Design Output Template

Produce a single valid JSON object matching the schema below, wrapped in a ```json code block. No prose before or after.

```json
{
  "title": "Figma Mockups: <feature name>",
  "figma_file_url": "",
  "figma_write_status": "planned",

  "screens_created": [
    {
      "name": "<screen name, e.g. Channel List>",
      "frame_url": "",
      "prd_journeys": ["<journey name from PRD>"],
      "description": "<one or two sentences: what this screen shows and its role in the flow>",
      "layout_notes": "<the few things the designer needs to know to build this screen: structure, which existing components to reuse, anything non-obvious>",
      "interactions": [
        { "trigger": "<tap/swipe/input>", "target_screen": "<screen name>", "notes": "<optional context>" }
      ]
    }
  ],

  "navigation_flow": "<ASCII diagram showing screen-to-screen navigation>",

  "design_gaps": [
    "<component or pattern these screens need that does not exist in the design system yet>"
  ],

  "notes": "<anything the designer should know or decide for themselves>"
}
```

## Field requirements

- `figma_file_url`: Use the file URL from the **Target Figma File** section of your context if provided. Leave as an empty string if no target file was specified or this stage is running in bypass mode.
- `figma_write_status`: Always set to `"planned"` — later steps stamp this to `"annotated"`, `"created"`, or `"reviewed"` automatically.
- `screens_created`: Minimum 3, maximum 8. Each screen must correspond to a named user journey from the PRD. This is a brief for a human designer, not a spec — keep each field short.
- `layout_notes`: The few things a designer actually needs to know to build the screen correctly. Do not enumerate tokens or pixel values — the designer has the design system open already.
- `navigation_flow`: ASCII diagram showing how screens connect. Example: `ChannelList → ChannelDetail → Compose → ChannelDetail`
- `design_gaps`: Components or patterns this screen set needs that do not exist in the design system yet. Empty array if none.
- `notes`: One or two sentences — anything the designer needs to resolve or decide themselves.
