# xCube Behavior Features (Gherkin Format)

This folder contains Gherkin-style feature files generated from the xCube Docs Azure Wiki documentation. These files describe the current implementation using the standard Gherkin syntax for better integration with PRD and story workflows.

## What is Gherkin?

Gherkin is a structured, human-readable language for describing software behavior. It uses keywords like:
- **Feature**: High-level capability or module
- **Background**: Business rules applicable to all scenarios
- **User Flow**: A logical grouping of related scenarios (screen flows, processes)
- **Scenario**: A specific use case or interaction
- **Given**: Preconditions or context
- **When**: Actions or triggers
- **Then**: Expected outcomes
- **And**: Continuation of the previous keyword

## File Structure

```
features/
├── account.feature                  # Account management
├── advisorflow.feature             # Advisor-specific workflows  
├── bank-transfer.feature           # Bank transfer integration
├── cd-futures.feature              # Futures certificate of deposit
├── cd-stocks-etf.feature           # Stocks/ETFs certificate of deposit
├── companydetails.feature          # Company info display
├── deposit.feature                 # Deposit flows
├── explore.feature                 # Discovery features
├── forgetpassflow.feature          # Password reset
├── fullscreenchart.feature         # Full-screen charting
├── future-tradelogic.feature       # Futures trading logic
├── ipoflow.feature                 # IPO subscription
├── login.feature                   # Login & authentication
├── marketdepth.feature             # Market depth / order book
├── more.feature                    # More/settings menu
├── onboarding.feature              # User onboarding
├── ordervalidationrules.feature    # Order validation
├── portfolio.feature               # Portfolio management
├── recoveraccountflow.feature      # Account recovery
├── search.feature                  # Search functionality
├── tradeflow.feature              # Trading flows
└── watchlist.feature               # Watchlist management
```

## Statistics

- **Total Features**: 22
- **Total User Flows**: 91
- **Total Scenarios**: 222
- **Coverage**: Stocks, ETFs, Futures, Accounts, Onboarding, Trading, Deposits, Withdrawals, etc.

## Feature File Format

Each feature file follows this structure:

```gherkin
Feature: [Feature Name]

  Background: Business Rules
    # RULE-ID: Description of business rule
    # ...

  #################################################
  # USER FLOW: [Flow Name]
  #################################################

  Scenario: [Scenario Name]
    Given [precondition]
    When [action]
    Then [expected result]
    And [additional result]

  Scenario: [Another Scenario]
    ...
```

### Example

```gherkin
Feature: Onboarding & Signup Flow

  Background: Business Rules
    # G-01: Onboarding flow starts after fresh install
    # G-02: Two signup methods: Email + Password or UAE PASS

  #################################################
  # USER FLOW: Signup Options Screen
  #################################################

  Scenario: Displayed Elements
    Then Title: Sign Up
    And Email Address field
    And Password field + Show toggle
    And Create an account button

  Scenario: Tap "Verify account"
    When user tap "verify account"
    Then Verify Your Identity screen
```

## Usage in Workflow

### 1. During PRD Phase

When writing a PRD for a new feature, reference relevant feature files to:
- Understand existing business rules (Background section)
- See current screen flows and interactions
- Ensure consistency with existing patterns

**Example**: Creating a PRD for "Stop-Loss Orders"
```bash
# Find related features
grep -l "order\|trade\|validation" context/behaviour/features/*.feature

# Review:
# - tradeflow.feature → current order types
# - ordervalidationrules.feature → existing validation rules
# - future-tradelogic.feature → futures-specific logic
```

### 2. During Story Decomposition

When breaking down features into user stories, use feature files to:
- Write acceptance criteria that match existing patterns
- Reference business rules in story descriptions
- Ensure technical notes align with current flows

**Example**: Story for "Enable Stop-Loss Orders"
```gherkin
Given I am on the trade entry screen (see tradeflow.feature: Order Entry)
And I have selected a stock (follows Business Rule T-01: min 300 AED)
When I select "Stop-Loss" as order type
Then I should see stop-loss price input field
And the price must follow tick size rules (Business Rule T-07)
```

### 3. During Technical Refinement

Engineers can:
- Reference scenarios to understand expected behavior
- Map Gherkin scenarios to test cases
- Verify implementation matches documented flows

### 4. As Living Documentation

- Keep feature files in sync with implementation
- Update scenarios when business rules change
- Reference in code comments and ADRs

## Regenerating Features

If the Azure Wiki documentation is updated, regenerate feature files:

```bash
# First, fetch latest wiki docs
npx tsx scripts/fetch-wiki-docs.ts

# Then, convert to Gherkin
npx tsx scripts/convert-to-gherkin-final.ts
```

This will:
1. Pull latest markdown from Azure Wiki
2. Parse into structured Gherkin format
3. Generate .feature files with:
   - Business rules as Background
   - H2 sections as User Flows
   - H3 subsections and behavior tables as Scenarios
   - Bullet points and table rows as Given/When/Then steps

## Comparison: Markdown vs Gherkin

### Original Markdown
```markdown
## Login Screen

### Displayed Elements
- Email field
- Password field
- Sign in button

### Behaviour
| Action | Behaviour |
|--------|-----------|
| Tap "Sign in" | → Validate credentials → Home screen |
```

### Converted Gherkin
```gherkin
#################################################
# USER FLOW: Login Screen
#################################################

Scenario: Displayed Elements
  Then Email field
  And Password field
  And Sign in button

Scenario: Tap "Sign in"
  When user tap "sign in"
  Then Validate credentials
  And Home screen
```

## Benefits of Gherkin Format

1. **Standardized**: Industry-standard format used by BDD tools (Cucumber, SpecFlow, Behave)
2. **Parseable**: Can be programmatically consumed by test frameworks
3. **Executable**: Gherkin scenarios can directly drive automated tests
4. **Traceable**: Easy to map scenarios → stories → tests → code
5. **Consistent**: Given/When/Then structure enforces clear thinking about behavior
6. **AI-Friendly**: LLMs understand Gherkin natively and can generate better stories

## Integration with Test Automation

These feature files can serve as a foundation for:
- **E2E tests** (Playwright/Cypress with Cucumber)
- **API tests** (mapping scenarios to API calls)
- **Visual regression tests** (screenshot assertions per scenario)
- **Load tests** (user flow patterns for K6/JMeter)

## Contributing

When xCube behavior changes:
1. Update the Azure Wiki documentation first (source of truth)
2. Run `npx tsx scripts/fetch-wiki-docs.ts` to sync
3. Run `npx tsx scripts/convert-to-gherkin-final.ts` to regenerate
4. Review diffs to ensure conversion is accurate
5. Commit changes with message: `docs: sync behaviour features from Azure Wiki`

## Related Files

- **Source**: `context/behaviour/*.md` (markdown from Azure Wiki)
- **Tree Map**: `context/behaviour/tree-map.json` (wiki structure)
- **Scripts**: 
  - `scripts/fetch-wiki-docs.ts` (fetch from Azure)
  - `scripts/convert-to-gherkin-final.ts` (markdown → Gherkin)
- **Documentation**:
  - `context/behaviour/README.md` (general overview)
  - `context/behaviour/USAGE.md` (how to use in workflow)

## Last Updated

**Generated**: 2026-06-19
**Source**: xCube Docs section of xCube-Backend.wiki
**Wiki URL**: https://dev.azure.com/xCubeApp/xCube-Backend/_wiki/wikis/xCube-Backend.wiki?pagePath=%2FxCube%20Docs
