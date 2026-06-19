Feature: Market Depth Screen

  Background: Business Rules
    # G-01: All prices in AED, 3 decimal places for most securities (follows exchange tick rules)
    # G-02: Bid side = Green, Offer side = Red
    # G-03: Data source: Real-time DFM/ADX order book feed (same as used in trading engine)
    # G-04: Updates pushed via WebSocket – no polling
    # G-05: Trade button visibility: Hidden for Internal & Under Review users
    # G-06: Pre-market & auction periods (15 min before open/close) show auction depth instead of normal book

  #################################################
  # USER FLOW: Depth Chart (Embedded Web Component)
  #################################################

  Scenario: Chart Type
    Then Market depth / cumulative order book chart
    And Green shaded area = cumulative bids (left side)
    And Red shaded area = cumulative asks (right side)
    And X-axis = Price
    And Y-axis = Cumulative Volume

  #################################################
  # USER FLOW: Sticky Bottom Bar (Always Visible While Scrolling)
  #################################################

  Scenario: Today's Stats
    Then Today's Volume
    And Today's Traded Value

