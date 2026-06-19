Feature: Trading Flow – Stocks, ETFs & Futures

  Background: Business Rules
    # T-01: Minimum order value = 300 AED (For Stocks & ETFs only – no minimum for Futures)
    # T-02: Sell button is displayed only if user has > 0 shares of the security (For Stocks and ETFs)
    # T-03: All prices and amounts are displayed and calculated in AED
    # T-04: Short Sell button if security is short sell enabled and user account is margin enabled
    # T-05: No commission for Futures
    # T-06: Market Price orders use xCube's internal "Market Price Limit Order" logic with maximum 5% deviation protection from prevailing market price
    # T-07: Limit price input must obey exchange-specific tick size rules
    # T-08: Futures trading requires margin-enabled account
    # T-09: Futures use contracts instead of shares; value = Price × Multiplier

  #################################################
  # USER FLOW: Screen Flow – Buy & Sell (Stocks & ETFs)
  #################################################

  Scenario: Instrument Overview Screen
    Then Show "Buy" button always
    And Show "Sell" button only if user's holding quantity > 0
    And Tapping Buy or Sell → opens Select Order Type bottom sheet

  #################################################
  # USER FLOW: Order Entry – Limit Price (Buy or Sell)
  #################################################

  Scenario: Displayed Elements
    Then Last price, Margin/Cash toggle, Market/Limit toggle
    And Buying Power (Buy) or Available Quantity (Sell)
    And Market Depth (Best Bid / Best Ask)
    And Limit price input (pre-filled with last price)
    And Number of shares input
    And Estimated amount (real-time)
    And "Continue" button
    And "Deposit funds" link (conditional)

  #################################################
  # USER FLOW: Margin Toggle / Buying Power Bottom Sheet (Margin-Enabled Accounts Only)
  #################################################

  Scenario: Trigger
    When User taps the "Margin" label (top-right) or the Buying Power value → opens Buying Power bottom sheet

  Scenario: Buying Power Bottom Sheet – Displayed Elements
    Then Title: **Buying Power**
    And Total Buying Power: AED 1,115,756.35 (bold)
    And Breakdown: Cash: AED 1,105,756.35 / Available Margin: AED 10,000.00
    And Toggle: Use Margin → Subtitle: "Margin is money that you borrow from xCube" → Default state: ON
    And Primary CTA changes dynamically:
    And Toggle OFF → "Trade without margin"
    And Toggle ON → "Trade with margin"

  Scenario: Regular (non-margin)
    When Regular (non-margin)
    Then Hidden

  Scenario: Margin-enabled
    When Margin-enabled
    Then Always visible

  Scenario: Use Margin = OFF
    When Use Margin = OFF
    Then Cash balance only

  Scenario: Use Margin = ON
    When Use Margin = ON
    Then Cash + Available Margin

  #################################################
  # USER FLOW: Order Confirmation Modal
  #################################################

  Scenario: Displayed Elements
    Then Symbol + Buy/Sell
    And Quantity
    And Validity (1 Day default | 1 Week | 1 Month)
    And Limit Price
    And Commission (final calculated)
    And Total Amount (highlighted)
    And Confirmation text
    And "Confirm" button

  #################################################
  # USER FLOW: Futures Trading Flow
  #################################################

  Scenario: Entry Point
    Then From Futures Contract Detail screen → sticky bottom buttons:
    And Buy (Long) – Green
    And Sell (Short) – Red

  #################################################
  # USER FLOW: Order Entry Screen – Futures Specific
  #################################################

  Scenario: Displayed Elements
    Then Title: Buy {CONTRACT} or Sell {CONTRACT} (e.g., Buy SALIKF26)
    And Current Offer / Bid price at top
    And Margin / Limit toggle (pre-selected from previous choice)
    And Market Depth section
    And Limit price input (pre-filled with last price) – always 3 decimal places
    And Number of contracts input (integer ≥ 1)
    And Estimated Order Value = Price × Contracts × Multiplier (real-time)
    And Required margin (real-time from backend)
    And "Continue" button
    And "Deposit" link (if required margin > buying power)

