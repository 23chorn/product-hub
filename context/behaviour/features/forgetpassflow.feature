Feature: Forgot Password Flow

  Background: Business Rules
    # G-01: Password recovery is initiated from Sign-In Screen → "Forgot Password?"
    # G-02: Recovery uses registered email followed by registered mobile for dual verification
    # G-03: Upon successful verification, a temporary password is sent via email
    # G-04: After first login with temporary password, Force Set New Password screen is mandatory and non-bypassable
    # G-05: All OTPs are 6-digit, time-limited (5 minutes), with resend option
    # G-06: Failed attempts follow escalating lockout (same as login OTP)
    # G-07: New password cannot be the same as any previous password on Force Set New Password screen

  #################################################
  # USER FLOW: Screen 1: Enter Registered Email
  #################################################

  Scenario: Displayed Elements
    Then Title: **Forgot Password?**
    And Email input field (pre-filled if possible)
    And "Continue" button

  #################################################
  # USER FLOW: Screen 2: Email OTP Verification
  #################################################

  Scenario: Displayed Elements
    Then Title: **Enter the code from email**
    And Subtitle: "We've sent an OTP to no\*\*\*ad@xcube.ae"
    And 6-digit input boxes
    And Resend timer + "Open Mail App" link
    And "Continue" button

  Scenario: Valid OTP entered
    When Valid OTP entered
    Then Proceed to Screen 3 (Mobile OTP)

  Scenario: Resend tapped
    When Resend tapped
    Then New OTP sent to email

  #################################################
  # USER FLOW: Screen 3: Mobile OTP Verification
  #################################################

  Scenario: Displayed Elements
    Then Title: **Enter the code from the message**
    And Subtitle: "We've sent an OTP to +97\*\*\*\*\*\*66"
    And 6-digit input boxes
    And Resend timer

  Scenario: Valid OTP entered
    When Valid OTP entered
    Then Show Success Popup (Screen 4)

  Scenario: On success
    When On success
    Then Backend generates and emails temporary password

  #################################################
  # USER FLOW: Screen 4: Success Confirmation Popup
  #################################################

  Scenario: Displayed Elements
    Then Title: **Success**
    And Message: "Details sent to your email"
    And "Ok" button

  Scenario: Tap "Ok"
    When user tap "ok"
    Then Dismiss popup
    And return to Sign-In Screen

  Scenario: Next step for user
    When Next step for user
    Then Check email for temporary password

  #################################################
  # USER FLOW: Force Set New Password Screen (Mandatory & Non-Bypassable)
  #################################################

  Scenario: Displayed Elements
    Then Title: **Set New Password**
    And New Password field + strength indicator
    And Confirm Password field
    And "Continue" button

  Scenario: Tap "Continue" (success)
    When user tap "continue" (success)
    Then Password updated
    And user logged in
    And Home tab

  Scenario: Screen bypass attempt
    When Screen bypass attempt
    Then Not possible – user cannot access any other screen until new password is set

