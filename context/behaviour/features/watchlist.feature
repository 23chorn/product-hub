Feature: Watchlist Main Screen

  #################################################
  # USER FLOW: Empty State (Normal Users Only – Zero Watchlists)
  #################################################

  Scenario: Displayed Elements
    Then Illustration
    And Heading: "Your watchlist will appear here"
    And Subtext: "Create a watchlist to track your favorite securities"
    And CTA Button: "Create your first watchlist" → opens Create Watchlist Flow

  #################################################
  # USER FLOW: Watchlist Tabs (Horizontal Scrollable)
  #################################################

  Scenario: Displayed Elements per Tab
    Then Watchlist Name
    And Number of securities in parentheses (e.g., "My Stocks (12)")
    And Selected tab highlighted

  #################################################
  # USER FLOW: Watchlist Options (Kebab Menu ⋯ on Each Tab)
  #################################################

  Scenario: 1. Rename Watchlist (Normal Users Only)
    Then Opens modal
    And Pre-filled with current name
    And Validation Rules (real-time):
    And Cannot be empty
    And Cannot contain special characters: `\ / : * ? " < >`
    And Leading/trailing spaces automatically trimmed
    And Min length: 1 character | Max length: 30 characters (recommended)
    And Buttons: **Cancel** / **Done** (Done enabled only if valid)

  Scenario: 2. Add / Edit Securities (Normal Users Only)
    Then Navigates to full-screen security selector
    And Securities already in watchlist appear at top with checkmark
    And Search bar (filters by symbol & name)
    And Header shows real-time count: "X Selected"
    And No-result state if search yields nothing
    And **Save** → updates watchlist and returns

  Scenario: 3. Edit Columns (Normal Users Only)
    Then Opens column customization screen
    When User can:
    Then Toggle columns ON/OFF
    And Drag to reorder (drag handle)
    And Tap "+" → opens category browser (Price Changes, Fundamentals, Prices & Volume)
    And Select column → returns and adds it to list
    And **Save** applies changes instantly to all watchlists (global column preference)

  #################################################
  # USER FLOW: Securities Table
  #################################################

  Scenario: Displayed Elements
    Then One row per security in selected watchlist
    And Columns as per user's Edit Columns configuration
    And Company name + symbol always pinned as first column (non-removable)

  Scenario: Tap column header
    When user tap column header
    Then Cycles: Default
    And Ascending
    And Descending
    And Default

  Scenario: Sort key for Symbol column
    When Sort key for Symbol column
    Then Use "RIC" value

  Scenario: Sort key for all other columns
    When Sort key for all other columns
    Then Use backend "Code" value

  Scenario: Sorted column
    When Sorted column
    Then Visual indicator shown (arrow ↑↓)

  #################################################
  # USER FLOW: Create New Watchlist Flow (Normal Users Only)
  #################################################

  Scenario: Step 1 – Enter Name
    Then Same validation rules as Rename Watchlist
    And "Continue" disabled until valid name entered

  Scenario: Step 2 – Select Securities
    Then Full security list (DFM + ADX)
    And Multi-select with real-time counter
    And Search supported
    And "Next" enabled when at least 1 security selected

