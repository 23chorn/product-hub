Feature: Global Business Rules (Applicable Across All Screens)

  Background: Business Rules
    # G-01: Splash screen is shown on every app launch
    # G-02: Language selection is shown only once after fresh install
    # G-03: Valid session → always land on Locked Screen (Screen 7)
    # G-04: UAE PASS users never see OTP or Biometric Enable Prompt
    # G-05: Biometric can only be enabled by Email+Password users and only once
    # G-06: Post-login mandatory checks are executed in strict order and block navigation until resolved
    # G-07: All permissions (Push, Biometric) are requested at the exact moments defined below
    # G-08: Force Update and Maintenance Mode checks are performed immediately after Splash and take highest priority
    # G-09: Check Flag for UAE Pass Login and Signup

  #################################################
  # USER FLOW: Screen 1: Splash Screen
  #################################################

  Scenario: Displayed Elements
    Then Full-screen blue gradient
    And Centered white xCube logo

  Scenario: Every app launch
    When Every app launch
    Then Show splash for minimum 1.5 seconds
    And proceed to next screen

  Scenario: No user interaction possible
    When No user interaction possible
    Then –

  #################################################
  # USER FLOW: Screen 2: Language Selection Screen
  #################################################

  Scenario: Displayed Elements
    Then Two large full-width buttons: **English** | **العربية**

  Scenario: First app open after fresh installation
    When First app open after fresh installation
    Then Show this screen

  Scenario: Language already chosen before
    When Language already chosen before
    Then Skip permanently
    And go to Screen 3

  Scenario: User selects language
    When User selects language
    Then Save choice permanently
    And proceed to Screen 3

  #################################################
  # USER FLOW: Screen 3: Welcome / Intro Screen (First-Time or After Logout)
  #################################################

  Scenario: Displayed Elements
    Then Large xCube logo + tagline
    And Primary blue button: **Sign up**
    And Outlined button: **Sign in**

  Scenario: Screen load (iOS only)
    When Screen load (iOS only)
    Then Request App Tracking Transparency

  Scenario: Tap Sign up or Sign in
    When user tap sign up or sign in
    Then Request Push Notification permission (iOS & Android)
    And go to Screen 4

  Scenario: Explicit logout from app
    When Explicit logout from app
    Then Show this screen again

  #################################################
  # USER FLOW: Screen 4: Sign-In Screen
  #################################################

  Scenario: Displayed Elements
    Then Email field
    And Password field + Show/Hide toggle
    And "Forgot Password?" link
    And Blue **Sign in** button
    And "Continue with UAE PASS" button (with UAE PASS logo)

  Scenario: Email + Password
    When Email + Password
    Then Screen 5 (OTP)

  Scenario: UAE PASS
    When UAE PASS
    Then Native UAE PASS flow
    And instant success
    And Home (skip OTP & Biometric)

  #################################################
  # USER FLOW: Screen 5: OTP Verification (Email + Password Only)
  #################################################

  Scenario: Displayed Elements
    Then Title: "Enter the code from the message"
    And Masked phone number
    And 6 large digit boxes (auto-advance)
    And Resend timer + "Resend code" link

  Scenario: 3
    When 3
    Then OTP disabled for 1 minute

  Scenario: 5
    When 5
    Then OTP disabled for 5 minutes

  Scenario: More than 5
    When More than 5
    Then Account permanently locked
    And show error screen

  Scenario: Correct OTP
    When Correct OTP
    Then Screen 6 (Biometric Enable Prompt) or direct to Home

  #################################################
  # USER FLOW: Screen 6: Biometric Enable Prompt (Only Once – Email + Password Users)
  #################################################

  Scenario: Displayed Elements
    Then Face ID / Touch ID icon
    And Title: "Use Biometrics"
    And Subtitle: "Login faster and more securely"
    And Primary: **Use Biometrics**
    And Secondary: **Setup Later From Settings**

  Scenario: First successful Email + Password login
    When First successful Email + Password login
    Then Show this screen

  Scenario: User logged in via UAE PASS
    When User logged in via UAE PASS
    Then Never shown

  Scenario: User chooses "Use Biometrics"
    When User chooses "Use Biometrics"
    Then Trigger native iOS/Android biometric permission
    And store choice

  Scenario: User chooses "Setup Later"
    When User chooses "Setup Later"
    Then Skip permanently (never ask again on this device)

  #################################################
  # USER FLOW: Screen 7: Locked Screen (Every Subsequent App Open with Valid Session)
  #################################################

  Scenario: Displayed Elements
    Then Blue gradient background
    And Centered xCube logo
    And Masked email at top (e.g., no\*\*\*ad@xcube.ae)
    And "Continue with UAE PASS" (solid white button)
    And "Continue with Password" (outlined button)

  Scenario: Tap "Continue with UAE PASS"
    When user tap "continue with uae pass"
    Then Instant login
    And Home

  Scenario: Tap "Continue with Password"
    When user tap "continue with password"
    Then Open password modal
    And OTP (if required)
    And Home

  Scenario: Biometric enabled (Email + Password user)
    When Biometric enabled (Email + Password user)
    Then Native Face ID / Touch ID prompt auto-triggers on screen entry
    And Home

  Scenario: User originally onboarded via UAE PASS
    When User originally onboarded via UAE PASS
    Then Biometric prompt never appears

  #################################################
  # USER FLOW: Pre-Authentication Screens
  #################################################

  Scenario: Force Update Screen
    Then Title: "Update Required"
    And Body text (from backend): e.g., "A new version of xCube is available with important improvements and bug fixes."
    And Primary CTA: **Update Now**

