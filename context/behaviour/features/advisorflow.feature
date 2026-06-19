Feature: Advisor Hiring Flow

  Background: Business Rules
    # G-01: Internal users & Under-Review users → "Hire Advisor" banner hidden on Explore, flow completely inaccessible
    # G-02: Normal users → NAV eligibility = full portfolio NAV
    # G-03: Margin-enabled users → NAV eligibility = portfolio NAV ÷ 2
    # G-04: Advisor minimum NAV requirement is stored in CRM per advisor
    # G-05: All PDFs must open in-app (never external app or download prompt)
    # G-06: All dynamic content (advisors, fees, agreements, min NAV) fetched from backend/CRM

  #################################################
  # USER FLOW: Screen 1: Advisor Introduction
  #################################################

  Scenario: Displayed Elements
    Then Header: "Hire an xCube Advisor"
    And Descriptive text explaining sub-account and professional management
    And Checkbox: "Authorize Advisor to Utilize Margin" (default unchecked)
    And Checkbox: "I agree to the Terms & Conditions" (default unchecked)
    And Primary CTA: "Find your advisor here"

  Scenario: Terms & Conditions unchecked
    When Terms & Conditions unchecked
    Then CTA disabled

  Scenario: Terms & Conditions checked
    When Terms & Conditions checked
    Then CTA enabled

  Scenario: CTA tapped + margin enabled on account + margin checkbox unchecked
    When CTA tapped + margin enabled on account + margin checkbox unchecked
    Then Show bottom sheet "Margin Recommendation" with message about 2× eligibility; options: "Back to authorize margin" or "Proceed without margin"

  Scenario: CTA tapped + margin checkbox checked
    When CTA tapped + margin checkbox checked
    Then Proceed to Advisor Directory (margin authorized = true)

  Scenario: CTA tapped + margin not enabled on account
    When CTA tapped + margin not enabled on account
    Then Show bottom sheet "Margin Not Available"
    And only "Continue"
    And proceed (margin authorized = false)

  #################################################
  # USER FLOW: Screen 2: Advisor Directory
  #################################################

  Scenario: Displayed Elements
    Then Strategy filter dropdown (Conventional / Islamic, default = Conventional)
    And Scrollable list of advisor cards filtered by selected strategy
    And Each card shows:
    And Advisor photo, name, title, short bio
    And Allocation focus, investment direction
    And Fees: Management, Performance, Hurdle Rate (from CRM)
    And LinkedIn icon (opens external browser)
    And "Review Strategy" button (opens PDF in-app)
    And "Hire" button

  Scenario: Strategy changed
    When Strategy changed
    Then Instantly refilter advisor list

  Scenario: User's Eligible NAV < Advisor Required Minimum
    When User's Eligible NAV < Advisor Required Minimum
    Then "Hire" button disabled + display message: "Your portfolio value is below the Advisor's minimum required threshold of X AED."

  Scenario: User's Eligible NAV ≥ Advisor Required Minimum
    When User's Eligible NAV ≥ Advisor Required Minimum
    Then "Hire" button enabled

  Scenario: "Hire" tapped
    When "Hire" tapped
    Then Navigate to Advisor Authorization screen for selected advisor

  Scenario: "Review Strategy" tapped
    When "Review Strategy" tapped
    Then Open strategy PDF in-app

  #################################################
  # USER FLOW: Screen 3: Advisor Authorization
  #################################################

  Scenario: Displayed Elements
    Then Agreement text fetched from CRM
    And Fee table: Management Fee, Performance Fee, Hurdle Rate
    And Two downloadable PDFs (open in-app): Self Declaration & Authorization Agreement, Advisory Agreement
    And Acceptance checkbox: "I accept the above agreements and terms"
    And CTA: "Agree and Continue"

  Scenario: Checkbox unchecked
    When Checkbox unchecked
    Then CTA disabled

  Scenario: Checkbox checked
    When Checkbox checked
    Then CTA enabled

  Scenario: Any PDF tapped
    When Any PDF tapped
    Then Open in full-screen in-app viewer

  Scenario: "Agree and Continue" tapped
    When "Agree and Continue" tapped
    Then Navigate to Portfolio Allocation screen

  #################################################
  # USER FLOW: Screen 4: Portfolio Allocation
  #################################################

  Scenario: Displayed Elements
    Then Current withdrawal-eligible cash balance
    And Input field for cash amount + "Max" action
    And List of all long equity positions only (futures & short positions excluded)
    And Per position: symbol, company name, available quantity, input field + "Max" action
    And Real-time Total Allocated Value
    And Conditional red banner if below minimum
    And CTA: "Proceed to hire"

  Scenario: Any input changed
    When Any input changed
    Then Instantly recalculate Total Allocated Value

  Scenario: Total Allocated Value < Advisor Required Minimum
    When Total Allocated Value < Advisor Required Minimum
    Then Show red banner

  Scenario: Total Allocated Value ≥ Advisor Required Minimum AND at least one asset allocated
    When Total Allocated Value ≥ Advisor Required Minimum AND at least one asset allocated
    Then Enable CTA

  Scenario: "Max" tapped (cash or stock)
    When "Max" tapped (cash or stock)
    Then Fill with maximum available amount/quantity

  Scenario: "Proceed to hire" tapped
    When "Proceed to hire" tapped
    Then Open Allocation Confirmation modal

  #################################################
  # USER FLOW: Screen 5: Allocation Confirmation Modal
  #################################################

  Scenario: Displayed Elements
    Then Table of allocated stocks (symbol, quantity, current value)
    And Total Allocated Value (highlighted)
    And "Cancel" and "Confirm Hiring" buttons

  Scenario: "Confirm Hiring" tapped
    When "Confirm Hiring" tapped
    Then Submit hiring request to backend with advisor ID, margin flag, cash amount, and stock allocations

  Scenario: API success
    When API success
    Then Navigate to Hiring Success screen

  Scenario: API failure
    When API failure
    Then Show error toast, keep modal open

  #################################################
  # USER FLOW: Screen 6: Hiring Success Screen
  #################################################

  Scenario: Displayed Elements
    Then Descriptive text explaining sub-account and professional management
    And Title: "Advisor Hired Successfully"
    And Sub-account allocated value summary
    And CTA: "Back to Explore"

