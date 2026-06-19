Feature: Account Screen

  Background: Business Rules
    # G-01: All amounts in AED with thousand separators and 2 decimal places
    # G-02: Eye icon toggles all monetary values on this screen (including Total Balance, Buying Power, Withdrawable Cash, Margin Used, transaction amounts)
    # G-03: "Withdrawable Cash" tooltip changes dynamically based on advisor request status
    # G-04: "Withdraw" button disabled if hiring request is pending

  #################################################
  # USER FLOW: Quick Action Buttons
  #################################################

  Scenario: Deposit Button
    Then Icon: Down arrow
    And Label: Deposit
    And Style: Primary blue CTA
    And Action: → Deposit Flow (Bank Transfer, Credit Card, Debit Card, Online Banking, Saved Card)

  #################################################
  # USER FLOW: Account Breakdown Card
  #################################################

  Scenario: Buying Power
    Then Label: Buying Power
    And Value: Cash + Available Margin
    And Hidden by Eye icon

  Scenario: Withdrawable Cash
    Then Label: Withdrawable Cash
    And Value: Immediately withdrawable cash
    And Info icon (i) → tooltip
    And Hidden by Eye icon

  #################################################
  # USER FLOW: Recent Transactions Section
  #################################################

  Scenario: Displayed Elements
    Then Section title: **Recent Transactions**

