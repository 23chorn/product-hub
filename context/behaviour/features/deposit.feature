Feature: Deposit Screen

  Background: Business Rules
    # G-01: Saved cards (Debit/Credit) appear at the top after first successful transaction
    # G-02: Saved cards show masked number (e.g., **** 1234) and expiry

  #################################################
  # USER FLOW: Deposit Methods List
  #################################################

  Scenario: 1. Bank Transfer
    Then Icon: Bank building
    And Title: Bank Transfer
    And Subtitle: "Deposit using your account information"
    And Behaviour: → Bank Transfer Deposit Flow (IBAN/details display)

  Scenario: 2. Online Banking
    Then Icon: Laptop
    And Title: Online Banking
    And Subtitle: "Deposit from your UAE bank account online"
    And Behaviour: → Online Banking Gateway (list of supported banks)

  Scenario: 3. Debit Card
    Then Icon: Debit card
    And Title: Debit Card
    And "New" badge (green) – visible only until first successful debit card deposit
    And Subtitle: "Deposit using your Debit Card"
    And Behaviour: → Card Entry / Payment Gateway

  #################################################
  # USER FLOW: Saved Cards Section (Conditional – Top of List)
  #################################################

  Scenario: Visibility
    Then Shown only if user has previously saved card(s) after a successful deposit
    And Appears above the standard method list

  Scenario: Each Saved Card Row
    Then Card icon (Visa / Mastercard based on type)
    And Masked card number (e.g., \*\*\*\* \*\*\*\* \*\*\*\* 1234)
    And Expiry date
    And Card type label (Debit / Credit)

  Scenario: Tap saved card
    When user tap saved card
    Then Pre-fill and proceed directly to amount entry / confirmation

  Scenario: Swipe saved card
    When Swipe saved card
    Then Option to remove saved card

