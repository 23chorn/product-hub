Feature: Futures Trading – Business Rules & Order Flow

  Background: Business Rules
    # F-01: Futures trading is only permitted for users with Margin enabled
    # F-02: No commission is charged on any futures order (Buy / Sell / Close)
    # F-03: All futures orders are single-stock futures (SSF) listed on DFM
    # F-04: Contract multiplier is fixed per contract (usually 100 or 1,000) – delivered real-time from backend
    # F-05: Lot size = 1 contract → quantity must be integer ≥ 1
    # F-06: Opposite-side orders on an existing position are treated as close-first logic (see below)
    # F-07: Tick size & decimal validation is mandatory before order preview and submission

  #################################################
  # USER FLOW: Order Entry → Confirmation Flow
  #################################################

  Scenario: Step 2 – Order Preview (Confirmation Modal)
    Then Contract code
    And Side + Order type
    And Quantity (contracts)
    And Price (or "Market")
    And Validity
    And Estimated contract value
    And Required margin impact
    And Close-first breakdown (if applicable)
    And Confirm button

