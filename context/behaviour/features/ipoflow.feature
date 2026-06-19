Feature: IPO Subscription Flow

  Background: Business Rules
    # G-01: External links (website, prospectus, documents) always open in device default browser (no in-app browser)
    # G-02: IPO is completely removed from app when status = Listing
    # G-03: Subscribe button visibility controlled by backend flag for subscription window
    # G-04: Subscription Summary section shown only if user has ≥1 active subscription request
    # G-05: All dates in DD MMM YYYY or DD MMMM YYYY format (user locale)
    # G-01: Flow is triggered from IPO Detail screen → Subscription button
    # G-02: First-time subscriber → mandatory IBAN provision
    # G-03: Returning subscriber → optional IBAN update or user already used IBAN
    # G-04: Minimum subscription amount, increment/multiplier, and fees are per-IPO (backend config)
    # G-05: Subscription request is final – cannot be modified or cancelled after confirmation
    # G-06: Allocation disclaimer must be accepted via checkbox before submission

  #################################################
  # USER FLOW: Subscription Summary Section (Conditional)
  #################################################

  Scenario: Visibility
    Then Shown only if user has active subscription request(s)
    And If multiple requests → show all (scrollable list)

  Scenario: Each Summary Card (Blue Highlighted)
    Then Label: Your Request
    And Requested Total Amount (large bold)
    And Request Timestamp (DD MMM YYYY, HH:MM AM/PM)
    And Allocated Amount (right-aligned preview, tappable)
    And Expected Listing Date

  Scenario: Tap allocated amount row
    When user tap allocated amount row
    Then Subscription Request Detail screen (requested amount, timestamp, payment method, status, allocated amount)

  Scenario: User has subscribed at least once
    When User has subscribed at least once
    Then Subscribe button becomes "New Request"

  #################################################
  # USER FLOW: Key Documents Section
  #################################################

  Scenario: List of Cards
    Then ITF Announcement
    And Prospectus
    And Listing Announcement
    And Offer Price Press Release
    And Others (dynamic from backend)

  #################################################
  # USER FLOW: Sticky Bottom Bar (Always Visible)
  #################################################

  Scenario: Upcoming
    When Upcoming
    Then Enable Notifications

  Scenario: Subscription
    When Subscription
    Then Subscribe / New Request (if already subscribed)

  Scenario: Allocation
    When Allocation
    Then Hidden

  Scenario: Listing
    When Listing
    Then IPO removed from app

  #################################################
  # USER FLOW: Screen 1: Provide IBAN (First-Time Subscribers Only)
  #################################################

  Scenario: Displayed Elements
    Then Title: **Provide IBAN**
    And Description: Regulatory requirement explanation
    And IBAN text field
    And Checkbox: "I confirm that I am the beneficial owner of the bank account associated with the IBAN listed above."
    And Continue button

  #################################################
  # USER FLOW: Screen 2: Update IBAN (Returning Subscribers Only)
  #################################################

  Scenario: Displayed Elements
    Then Title: **Would you like to update your IBAN?**
    And Previously saved IBAN (masked or full)
    And Proceed without updating (primary)
    And Update (secondary)

  Scenario: Proceed without updating
    When Proceed without updating
    Then Request to Buy IPO

  Scenario: Update
    When Update
    Then Provide IBAN screen (same as first-time)

  #################################################
  # USER FLOW: Screen 3: Request to Buy IPO
  #################################################

  Scenario: Displayed Elements
    Then Company logo + name
    And Share Price: TBA or actual value
    And Available cash balance
    And Amount in AED input (numeric or scroll wheel)
    And Minimum amount hint: "Minimum amount is AED X,XXX"
    And Fee note (appears after minimum met): "A subscription fee of AED X.XX will be applied"
    And Margin note (if applicable): "Your margin utilization may increase if you subscribe to more than AED X,XXX"
    And Continue button

  #################################################
  # USER FLOW: Screen 4: Review & Confirm
  #################################################

  Scenario: Displayed Elements
    Then Title: **Review and Confirm**
    And Description: "This request is final and cannot be modified."
    And Subscription Request Details card:
    And Share Price
    And Subscription Amount
    And Subscription Fees
    And Total Amount
    And Allocation disclaimer (grey box): "Final allocation of shares will be announced on {DATE}. Unallocated amounts will be refunded."
    And Checkbox: "I have read and accept the prospectus and xCube terms and conditions."
    And Confirm button

  Scenario: Checkbox unchecked
    When Checkbox unchecked
    Then Confirm disabled

  Scenario: Checkbox checked
    When Checkbox checked
    Then Confirm enabled

  Scenario: Tap Confirm
    When user tap confirm
    Then Submit to backend
    And Subscription Completion screen

  #################################################
  # USER FLOW: Screen 5: Subscription Completion (Done Screen)
  #################################################

  Scenario: Displayed Elements
    Then Company logo
    And Success title: **Your Subscription Request is Complete**
    And Message: "You requested to buy {COMPANY} shares for AED {AMOUNT}."
    And Allocation note: "The final allocation of shares will be announced on {DATE}."
    And Done button

  Scenario: Tap Done
    When user tap done
    Then Return to IPO Detail screen

  Scenario: IPO Detail after return
    When IPO Detail after return
    Then Shows Subscription Summary Card with user's request details

