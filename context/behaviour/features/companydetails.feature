Feature: Company Detail Screen

  #################################################
  # USER FLOW: Overview
  #################################################

  Scenario: Key Features
    Then Live price & movement with colour-coded changes and pre-market/auction support
    And Embedded TradingView chart with candlestick/line toggle, multiple time intervals, and full-screen option
    And Holdings & open orders sections (conditional – shown only if user has position or active orders)
    And Refinitiv-powered sections: Overview metrics, financial statements (annual/quarterly), earnings scatter plot, and multi-period performance returns
    And Profile & curated categories: Company description, sector, ISIN, and tappable curated lists (e.g., Shariah Compliant, Bluechip)
    And Related content: "People Also Pick" horizontal scroll and News & Market Updates with "See All" navigation
    And Sticky trade button (hidden for Internal/Under Review users) for direct Buy/Sell access

