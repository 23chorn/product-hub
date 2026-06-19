Feature: Bank Transfer Deposit Screen

  Background: Business Rules
    # G-01: Bank Transfer deposit is offline – user copies details and transfers money externally via their bank
    # G-02: No real-time payment gateway – deposit reflected only after bank processing (usually 1–2 business days)
    # G-03: All account details are static (from backend) and displayed exactly as provided
    # G-04: Copy icons allow one-tap copy of individual fields
    # G-05: "Copy Details" button copies all fields in formatted text for easy pasting into bank app

  #################################################
  # USER FLOW: Screen: Bank Transfer Deposit (Your Account Information)
  #################################################

  Scenario: Entry
    Then From Deposit screen → Bank Transfer option

