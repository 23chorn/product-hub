# Airtable Schema Documentation

**Base ID:** `unknown`
**Generated:** 2026-02-11T08:40:15.611Z

---

## Table: Initiatives

**Table ID:** `tblMBKMT8WY5h4Fta`
**Primary Field ID:** `fldDaDxd4Qr0Qb5Ih`

### Fields

| Field Name | Type | Description | Options |
|------------|------|-------------|---------|
| Initiative | `singleLineText` |  |  |
| Description | `multilineText` |  |  |
| Status | `singleSelect` |  | In Progress, Blocked, Ready, Discovery, Deferred, Shipped |
| Target Quarter | `singleSelect` | Next 2/3 Quarters, then Half Years, then Whole Years | Q1 '26, Q2 '26, Q3 '26, Q4 '26, Q1 '27 |
| Target Window | `singleSelect` |  | Now, Next, Later, Under Review, Someday, Shipped |
| Product Area | `singleSelect` |  | Mobile App, Web App, Admin Portal, Advisor Portal, Corp Website, Core Platform, API Platform, Developer Platform, Compliance & Security, Identity & Access, Internal Tooling |
| Strategic Theme | `singleSelect` |  | Asset Class Expansion, Market & Region Expansion, Trading Tools & Power Features, Customer Experience & Usability, Risk, Compliance & Trust, Platform & Scalability, Revenue & Monetisation, Operational Efficiency & Automation |
| Affected Stakeholders | `multipleSelects` |  | Finance, RM, IT, Marketing, Market Makers, Customer Success, Users |
| Priority Score | `formula` | Calculates a priority score using Business Value, mapped Estimate, and Confidence percent. | Formula: `IF(AND({flds54LBOReKrjjkp}, {fldA51PSoOtf4W2Mi}, {fld9mcuEBA55zfoJX}),
  {flds54LBOReKrjjkp} * ({fld9mcuEBA55zfoJX}) /
    SWITCH({fldA51PSoOtf4W2Mi},
      "XS", 1,
      "S", 3,
      "M", 5,
      "L", 8,
      "XL", 13,
      BLANK()
    ),
  BLANK()
)` |
| Business Value | `number` | Single 1–10 score estimating the benefit if this succeeds (revenue, retention, CX, strategy, risk reduction). Relative to other items; do not include effort. Add a one‑line rationale. 
10 = company-level impact; 8–9 = top strategic/large audience; 6–7 = important improvement; 4–5 = localized; 2–3 = minor; 1 = minimal/experimental. |  |
| Estimate | `singleSelect` | XS, S, M, L, XL | XS, S, M, L, XL |
| Confidence | `percent` | 0.3–0.9 certainty in the Business Value based on evidence quality (research, data, pilots). Reflects how sure we are about the value, not delivery risk. 
0.8–0.9 = strong evidence; 0.6–0.7 = promising but some unknowns; 0.3–0.5 = hypothesis/early discovery. Include a brief rationale. |  |
| Planned Start Date | `date` | Displays the Planned Start date in 'Mon YYYY' format (e.g., Jan 2026). |  |
| Planned Start | `formula` | Displays the month abbreviation of Planned Start Date, or blank if no date. | Formula: `IF({fld1Uw9gi81nrsH2d}, DATETIME_FORMAT({fld1Uw9gi81nrsH2d}, "MMM-YY"), BLANK())` |
| Planned End Date | `date` |  |  |
| Planned End | `formula` | Displays the month and year of Planned End Date, or blank if no date. | Formula: `IF({fldmphdbGcCrHGacY}, DATETIME_FORMAT({fldmphdbGcCrHGacY}, "MMM-YY"), BLANK())` |
| PRD Link | `url` |  |  |
| Epic Link | `url` |  |  |
| Last Modified | `lastModifiedTime` |  |  |
| Release Logs | `singleLineText` |  |  |
| Requires Dev Work | `singleSelect` |  | Yes, No |
| Notes | `multilineText` |  |  |

## Table: Customer Feedback Requests

**Table ID:** `tblIaidkelDSJ0vwE`
**Primary Field ID:** `fldg866J0Zewzob1v`

### Fields

| Field Name | Type | Description | Options |
|------------|------|-------------|---------|
| Request ID | `autoNumber` |  |  |
| CS Owner | `singleLineText` |  |  |
| Request Description | `multilineText` |  |  |
| Request Type | `singleSelect` |  | Bug Report, Feature Request, Process Feedback, Other |
| Impact | `multilineText` |  |  |
| Urgency | `singleSelect` |  | Low, Medium, High, Critical |
| Customer Value | `multilineText` |  |  |
| Linked Feature | `singleLineText` |  |  |
| Status | `singleSelect` |  | New, Under Review, In Progress, Closed, Deferred |

---

## Current Implementation Mapping

### TypeScript Interface (AirtableItem)

```typescript
export interface AirtableItem {
  id: string;
  title: string;
  description: string;
  status: 'Up Next' | 'Needs PRD' | 'PRD In Review' | 'Ready for Backlog' | 'Ready for Grooming' | 'Ready for Dev';
  priority: 'P0' | 'P1' | 'P2';
  owner: string;
  prdLink: string;
  epicId: string;
  featureIds: string[];
  storyIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

### Field Mapping in Code

| Code Field | Airtable Field Name | Notes |
|------------|---------------------|-------|
| `id` | Record ID | System generated |
| `title` | "Title" or "Name" | Primary field |
| `description` | "Description" | Text field |
| `status` | "Status" | Single select |
| `priority` | "Priority" | Single select |
| `owner` | "Owner" | User/text field |
| `prdLink` | "PRD Link" | URL field |
| `epicId` | "Epic ID" | Text field |
| `featureIds` | "Feature IDs" | Multiple values |
| `storyIds` | "Story IDs" | Multiple values |
| `createdAt` | "Created Time" | System field |
| `updatedAt` | "Last Modified" | System field |

