Feature: Full Screen Chart Screen

  Background: Business Rules
    # G-01: Chart is rendered via TradingView WebView (same instance/config as Company Detail small chart)
    # G-02: Indicators are global – applied to all securities
    # G-03: Drawings are per-security – never shared between symbols
    # G-04: All user preferences (indicators, drawings, chart type, theme) are saved automatically on change
    # G-06: Data source, colours, price feed, and real-time updates must exactly match the small chart

  #################################################
  # USER FLOW: Fixed Header (Always Visible)
  #################################################

  Scenario: Displayed Elements
    Then Back arrow (←)
    And Security Name (e.g., EMAAR)
    And Symbol + Market (e.g., EMAAR | DFM)

  Scenario: Tap back
    When user tap back
    Then Return to previous screen (usually Company Detail)

  Scenario: On exit
    When On exit
    Then All settings are auto-saved

  #################################################
  # USER FLOW: Indicators (Global – Same for All Securities)
  #################################################

  Scenario: Persistence Logic
    Then Added/removed indicators are saved globally
    And Stored locally (EncryptedSharedPreferences / Keychain)
    And Example: User adds RSI + MACD on EMAAR → next time opens SALIK, AIRARABIA, etc., RSI + MACD are already active
    And Removal of indicator → removed for every security

  #################################################
  # USER FLOW: Drawing Tools (Per-Security Only)
  #################################################

  Scenario: Persistence Logic
    Then Drawings stored per symbol + market (key = Symbol + Market)
    And Stored locally (same storage as indicators)
    And When user returns to the same security → all drawings reappear exactly as left
    And Drawings never appear on other securities

  #################################################
  # USER FLOW: Entry & Exit
  #################################################

  Scenario: Entry Points
    Then From Company Detail → "Full Screen Chart" link
    And Deep link support (optional future)

