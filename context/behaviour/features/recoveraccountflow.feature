Feature: Account Recovery Flow

  Background: Business Rules
    # G-01: Advanced recovery is triggered from Sign-In Screen → "Forgot Password?" → "Recover Account"
    # G-02: Recovery requires identity verification via Uqudo KYC (Emirates ID or Passport)
    # G-03: On successful KYC → user can set new email (cannot reuse old or non-existent) and new phone number (cannot reuse old)
    # G-04: All new email & phone must be verified via OTP
    # G-05: New password must be set (with confirmation) – cannot be the same as any previous password
    # G-06: On Uqudo failure → show error: "No account exists with these details"

  #################################################
  # USER FLOW: Screen 1: Restore Access to the Account
  #################################################

  Scenario: Displayed Elements
    Then Title: **Restore access to the account**
    And Message: "You can change your email and password by providing your ID and taking a selfie."
    And Primary CTA: **Start Verification**
    And Secondary: **Contact Support**

  Scenario: Tap "Start Verification"
    When user tap "start verification"
    Then Screen 2

  #################################################
  # USER FLOW: Screen 2: How Would You Like to Verify Your Identity?
  #################################################

  Scenario: Displayed Elements
    Then Title: **How would you like to verify your identity?**
    And Button 1: Continue with Emirates ID
    And Button 2: Continue with Passport

  Scenario: Tap either option
    When user tap either option
    Then Launch Uqudo KYC SDK flow (ID scan + selfie)

  #################################################
  # USER FLOW: Screen 3: Uqudo KYC Process (External SDK)
  #################################################

  Scenario: Success
    When Success
    Then Proceed to Screen 4

  Scenario: Failure / no match
    When Failure / no match
    Then Show full-screen error: "No account exists with these details" — Buttons: Retry (back to Screen 2) / Contact Support

  #################################################
  # USER FLOW: Screen 4: Set New Email & Password
  #################################################

  Scenario: Displayed Elements
    Then Title: **Create new credentials**
    And New Email field
    And New Password field + strength indicator
    And Confirm Password field
    And "Continue" button

  Scenario: All inputs valid
    When All inputs valid
    Then Send Email OTP
    And Screen 5

  #################################################
  # USER FLOW: Screen 5: Email OTP Verification
  #################################################

  Scenario: Displayed Elements
    Then Standard 6-digit OTP screen
    And Subtitle: "We've sent an OTP to [newemail@...]"

  Scenario: Valid OTP entered
    When Valid OTP entered
    Then Proceed to Screen 6

  Scenario: Invalid OTP
    When Invalid OTP
    Then Standard OTP errors + resend option

  #################################################
  # USER FLOW: Screen 6: Set New Phone Number
  #################################################

  Scenario: Displayed Elements
    Then Phone number input (+971 dropdown)
    And "Continue" button

  Scenario: Validation
    Then Cannot be old phone number
    And Must be valid UAE mobile format

  Scenario: Valid phone entered
    When Valid phone entered
    Then Send Phone OTP
    And Screen 7

  #################################################
  # USER FLOW: Screen 7: Phone OTP Verification
  #################################################

  Scenario: Displayed Elements
    Then Standard 6-digit OTP screen
    And Subtitle: "We've sent an OTP to +971..."

  Scenario: Valid OTP entered
    When Valid OTP entered
    Then Account recovery complete

  Scenario: On success
    When On success
    Then Show success toast: "Account recovered successfully"

  Scenario: After toast
    When After toast
    Then Redirect to Sign-In Screen (user logs in with new credentials)

  Scenario: Notification
    When Notification
    Then Send Account Recovery email to new address

