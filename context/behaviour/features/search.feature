Feature: Search Screen

  Background: Business Rules
    # G-01: Search covers Stocks, ETFs, Funds, and DFM Futures across DFM + ADX
    # G-02: Minimum 2 characters required to trigger live search
    # G-03: Search is case-insensitive
    # G-04: Recent searches: maximum 5 items, stored locally, persist until manually cleared
    # G-05: Results are categorised and displayed in fixed order: Stocks → Futures → Funds/ETFs
    # G-06: Colour coding: Green = positive change, Red = negative, Grey = no change

  #################################################
  # USER FLOW: Fixed Search Bar (Always Visible at Top)
  #################################################

  Scenario: Displayed Elements
    Then Placeholder: "Search by symbol or security name"
    And Clear "×" button (appears when text is entered)
    And Cancel button (right) → closes screen instantly

  Scenario: 0–1 chars
    When 0–1 chars
    Then Show Recent Searches or Empty State

  Scenario: ≥2 chars
    When ≥2 chars
    Then Live search starts immediately, results replace recent/empty view

  #################################################
  # USER FLOW: Recent Searches Section (Conditional)
  #################################################

  Scenario: Visibility
    Then Shown only if user has performed ≥1 search in the past

  Scenario: Displayed Elements
    Then Section header: **Recent Searches**
    And Up to 10 most recent items (latest on top)

  Scenario: Each Recent Item
    Then Security logo
    And Security name (e.g., "SALIK", "SALIKF26 JAN6")
    And Last traded price
    And % change (coloured)

  Scenario: Tap item
    When user tap item
    Then Opens correct detail screen (Company / Futures / Fund)

  Scenario: Auto-expiry
    When Auto-expiry
    Then Items auto-expire after 10 — no "Clear All" button required

  #################################################
  # USER FLOW: Live Search Results (≥2 Characters)
  #################################################

  Scenario: Each Category
    Then Header with category name + count (e.g., "Stocks (47)")
    And Up to 5 results shown inline
    And If >5 matches → "Show more →" link at bottom of category → Tap → opens full filtered list screen for that category

  Scenario: Stock row
    When Stock row
    Then Company Detail Screen

  Scenario: Futures row
    When Futures row
    Then Futures Contract Detail Screen

  Scenario: Fund/ETF row
    When Fund/ETF row
    Then Fund Detail Screen

  Scenario: Category with zero matches
    When Category with zero matches
    Then Completely hidden

