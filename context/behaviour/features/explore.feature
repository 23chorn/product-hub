Feature: Explore (Main Screen)

  #################################################
  # USER FLOW: IPO Card Section
  #################################################

  Scenario: Visibility Logic
    Then Only shown under the selected market tab
    And If no IPOs in that market → section completely hidden

  Scenario: Each IPO Card
    Then Company logo
    And Company name
    And IPO Price (e.g., AED 1.40 or "TBA")
    And Total Offer Shares (compact: K/M/B)
    And Subscription Status Button → Label & style changes by phase:

  #################################################
  # USER FLOW: Trending Stocks Section
  #################################################

  Scenario: Per Card
    Then Company logo
    And Company name
    And Price change (%) – color coded

  #################################################
  # USER FLOW: Custom Highlights Carousel
  #################################################

  Scenario: Per Item
    Then Image (fixed aspect ratio)
    And Heading (max 80 characters)
    And Date
    And Scroll direction: LTR (English) / RTL (Arabic)

  #################################################
  # USER FLOW: Market Updates Carousel
  #################################################

  Scenario: Per Item
    Then Heading (max 120 characters)
    And Date
    And Scroll direction: LTR (English) / RTL (Arabic)

  #################################################
  # USER FLOW: Curated Lists Section
  #################################################

  Scenario: Displayed Elements
    Then List of curated watchlists
    And Per list: Title, number of symbols

