# Figma Design Output Template

Produce a single valid JSON object matching the schema below, wrapped in a ```json code block. No prose before or after.

The output is displayed in two views:
- **Summary page** — shows the screen list (`name` + `description`), `navigation_flow`, `notes`, and `design_gaps`. Reviewers read this first to understand scope.
- **Per-screen pages** — show `layout_notes` and `interactions` for each screen individually. Designers work from these.

```json
{
  "title": "Figma Mockups: <feature name>",
  "figma_file_url": "",
  "figma_write_status": "planned",

  "screens_created": [
    {
      "name": "<screen name, e.g. Channel List>",
      "frame_url": "<URL to the Figma frame or Section for this screen. If the screen has multiple states (empty, loading, error, modal open), group all state frames inside a Figma Section and link to the Section — get_figma_data returns the full subtree including all child frames.>",
      "prd_journeys": ["<journey name from PRD>"],
      "description": "<one sentence — what this screen is and its role in the flow. Shown in the summary list, so keep it brief>",
      "layout_notes": "<shown on the per-screen detail page: structure, which existing components to reuse, key constraints. A few sentences for the designer>",
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
- `frame_url`: Link to the Figma frame for this screen. If the screen has multiple states (empty state, loading, error, modal open, etc.), group all state frames inside a **Figma Section** and link to the Section — the API contract stage fetches the full subtree, so all states are captured in one link.
- `figma_write_status`: Always set to `"planned"` — later steps stamp this to `"annotated"`, `"created"`, or `"reviewed"` automatically.
- `screens_created`: Minimum 3, maximum 8. Each screen must correspond to a named user journey from the PRD.
- `description`: **One sentence only.** This is shown in the Summary page alongside every other screen — it must be brief enough to scan. Save detail for `layout_notes`.
- `layout_notes`: The few things a designer needs to know to build the screen correctly. Shown on the per-screen detail page, so a few sentences is fine. Do not enumerate tokens or pixel values — the designer has the design system open already.
- `navigation_flow`: ASCII diagram showing how screens connect — shown on the Summary page. Example: `ChannelList → ChannelDetail → Compose → ChannelDetail`
- `design_gaps`: Components or patterns this screen set needs that do not exist in the design system yet. Shown on the Summary page. Empty array if none.
- `notes`: One or two sentences of cross-screen context — anything the designer needs to resolve or decide. Shown on the Summary page.
