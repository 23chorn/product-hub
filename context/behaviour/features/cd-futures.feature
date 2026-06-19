Feature: Futures Contract Detail Screen

  Background: Business Rules
    # G-01: All prices in AED
    # G-02: Long = Green, Short = Red, No change = Grey
    # G-03: Futures trading only available to users with Margin enabled
    # G-04: If margin not enabled → block Buy/Sell with mandatory margin enable flow
    # G-05: Multiplier & Required Margin per contract are delivered real-time from backend
    # G-06: Chart uses same TradingView WebView instance as equity charts (same config)

  #################################################
  # USER FLOW: Contract Overview Card
  #################################################

  Scenario: Historical Range Bar
    Then Horizontal bar: Historical Low ←────●────→ Historical High
    And Current price marker on bar

  #################################################
  # USER FLOW: Open Futures Position Section (Conditional)
  #################################################

  Scenario: Visibility
    Then Shown only if user has a long or short position in this exact contract

  #################################################
  # USER FLOW: Futures Open Orders Section (Conditional)
  #################################################

  Scenario: Visibility
    Then Shown only if user has ≥1 active order on this contract
    And Header: Open Orders + badge count
    And Default: Collapsed (user can expand)

  Scenario: Each Order Card
    Then Order type + icon (Limit Buy / Limit Sell)
    And Contract code
    And Limit price
    And Number of Contracts
    And Validity date

