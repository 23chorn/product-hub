# xCube Behavior Documentation

This folder contains documentation pulled from the Azure Wiki "xCube Docs" section. These documents describe the current implementation and business rules of the xCube application.

## Purpose

These documents serve as **context during the PRD and Story phases** to help understand:
- Current implementation details
- Business rules and validation logic
- User flows and screen behaviors
- Technical specifications
- Integration patterns

## Structure

### feature-map.json
A structured index of all Gherkin feature files, organized by category:
- **22 features** across 8 categories (authentication, trading, portfolio, funding, discovery, IPO, advisor, other)
- **91 user flows** describing screen-by-screen interactions
- **222 scenarios** with Given/When/Then steps
- **118 business rules** extracted from documentation
- Searchable index with keywords for each feature

### Individual Documents

Each `.md` file corresponds to a specific feature or flow in the xCube application:

| File | Description |
|------|-------------|
| `xcube-docs_account.md` | Account management features |
| `xcube-docs_advisorflow.md` | Advisor-specific workflows |
| `xcube-docs_architecture---tech-overview.md` | System architecture and technology stack |
| `xcube-docs_bank-transfer.md` | Bank transfer integration and flows |
| `xcube-docs_cd-futures.md` | Futures trading certificate of deposit |
| `xcube-docs_cd-stocks-etf.md` | Stocks and ETFs certificate of deposit |
| `xcube-docs_companydetails.md` | Company information display |
| `xcube-docs_deposit.md` | Deposit money flows |
| `xcube-docs_explore.md` | Explore/discovery features |
| `xcube-docs_forgetpassflow.md` | Password reset flow |
| `xcube-docs_fullscreenchart.md` | Full-screen charting interface |
| `xcube-docs_future-tradelogic.md` | Futures trading business logic |
| `xcube-docs_ipoflow.md` | Initial Public Offering subscription flow |
| `xcube-docs_login.md` | Login and authentication |
| `xcube-docs_marketdepth.md` | Market depth / order book display |
| `xcube-docs_more.md` | More/settings menu |
| `xcube-docs_onboarding.md` | User onboarding process |
| `xcube-docs_ordervalidationrules.md` | Order validation business rules |
| `xcube-docs_portfolio.md` | Portfolio management and display |
| `xcube-docs_recoveraccountflow.md` | Account recovery flow |
| `xcube-docs_search.md` | Search functionality |
| `xcube-docs_tradeflow.md` | Trading flows for stocks, ETFs, and futures |
| `xcube-docs_watchlist.md` | Watchlist management |

## Usage

When working on PRDs or user stories:
1. Reference these documents to understand current implementation
2. Check business rules before proposing changes
3. Ensure consistency with existing patterns
4. Identify gaps between current state and desired state

## Updating

To refresh these documents from the Azure Wiki, run:

```bash
# Step 1: Fetch latest from Azure Wiki
npx tsx scripts/fetch-wiki-docs.ts

# Step 2: Convert to Gherkin format
npx tsx scripts/convert-to-gherkin-final.ts

# Step 3: Generate feature map
npx tsx scripts/generate-feature-map.ts

# Step 4: Clean up temporary markdown files
rm -f context/behaviour/xcube-docs*.md
```

This will:
- Fetch the latest content from xCube Docs
- Convert to Gherkin .feature files
- Generate an updated feature map with categories and searchable index
- Remove intermediate markdown files

## Source

**Azure DevOps Wiki:** https://dev.azure.com/xCubeApp/xCube-Backend/_wiki/wikis/xCube-Backend.wiki
**Section:** /xCube Docs
**Last Fetched:** 2026-06-19T09:08:23.629Z
