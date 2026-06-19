Feature: Recent Activity Screen

  Background: Business Rules
    # G-01: The screen is accessible from Portfolio → "Recent Activity"
    # G-02: If user has any sub-account(s) → "Select Account" dropdown is shown at the top
    # G-03: If user has only Primary account → no dropdown, "Primary" is implicitly used
    # G-04: When user enters from Portfolio and a sub-account is currently selected in Portfolio → only Transactions tab is shown (Open Orders & Order History are hidden)
    # G-05: When Primary account is selected → all three tabs are available
    # G-06: Search bar filters results in real time within the active tab

  #################################################
  # USER FLOW: Portfolio Valuation
  #################################################

  Scenario: Displayed Information
    Then Net Assets Value (NAV) (in AED)
    And Eye Icon → toggles between showing and hiding financial values

  Scenario: Eye Icon – Hidden Fields
    Then Net Assets Value (NAV)
    And Today's Gain/Loss Value and Percentage
    And Time Range Gain/Loss Value and Percentage
    And Buying Power
    And Number of Shares
    And Total Value of Current Holding

  #################################################
  # USER FLOW: Portfolio Performance Chart
  #################################################

  Scenario: Time Range Filters
    Then 1W, 1M, 3M, 6M, 1Y

  #################################################
  # USER FLOW: Buying Power
  #################################################

  Scenario: Display
    Then Buying Power value in AED

  #################################################
  # USER FLOW: Holding List
  #################################################

  Scenario: Categories
    Then Stocks
    And ETF
    And Futures
    And Pending Share Transfer

  #################################################
  # USER FLOW: Upgrade Margin Banner
  #################################################

  Scenario: Displayed Information
    Then Title: "Get more buying power with margin on securities"
    And Subtitle: "Up to 100% of your net asset value and access to futures"
    And Illustrations
    And CTA: **Upgrade for Margin**

  #################################################
  # USER FLOW: User Base Conditions
  #################################################

  Scenario: Internal User
    Then Show: **Complete Onboarding Button ONLY**

  Scenario: Account Under Review
    Then Show: **Account Under Review paragraph ONLY**

  Scenario: Normal User (No Deposit Yet)
    Then Show: Explore Assets Banner
    And Hide: Performance Chart, Margin Upgrade Banner

  #################################################
  # USER FLOW: Open Orders
  #################################################

  Scenario: Displayed Elements per Order Card
    Then Order type + icon (Limit Buy / Limit Sell / Market Buy / Market Sell etc.)
    And Security: Symbol + Market (e.g., SALIK | DFM)
    And Limit price (if applicable)
    And Number of shares
    And Total value (AED)
    And Validity date

  #################################################
  # USER FLOW: Order History
  #################################################

  Scenario: Displayed Elements per Order Card
    Then Order type + icon
    And Security: Symbol + Market
    And Number of shares
    And Executed value (AED)
    And Status

  Scenario: Status Types
    Then Active
    And Canceled
    And Pending trigger
    And OMS Accepted
    And Rejected
    And Expired
    And InvalidatedByAmend
    And Filled / Partially Filled

  Scenario: Date Grouping
    Then "Today" header for today's orders

  #################################################
  # USER FLOW: Transactions
  #################################################

  Scenario: Displayed Fields
    Then Transaction description
    And Amount in AED (positive = credit, negative = debit)
    And Status (always "Completed" for historical)
    And Date grouping headers

