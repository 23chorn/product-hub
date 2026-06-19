Feature: More Screen

  Background: Business Rules
    # G-01: All menu items are tappable and navigate to specified sub-pages or actions
    # G-02: Biometric toggle visibility and behaviour strictly follow user login method and device capabilities
    # G-03: Language change applies immediately across the entire app
    # G-04: Sign Out clears session and returns to Sign-In screen
    # G-05: All sub-pages support back navigation to More screen
    # G-06: Biometric toggle not visible if user logged in with UAE PASS

  #################################################
  # USER FLOW: Profile & Settings Section
  #################################################

  Scenario: Toggle ON
    When Toggle ON
    Then Prompt system biometric enrollment if needed

  Scenario: Toggle OFF
    When Toggle OFF
    Then Disable biometric login

  #################################################
  # USER FLOW: Sign Out
  #################################################

  Scenario: Displayed Elements
    Then **Sign Out** (red text)

  Scenario: Tap "Sign Out"
    When user tap "sign out"
    Then Confirmation bottom sheet: "Are you sure you want to sign out?"

  Scenario: Tap "Cancel"
    When user tap "cancel"
    Then Dismiss bottom sheet

  Scenario: Tap "Sign Out" (confirm)
    When user tap "sign out" (confirm)
    Then Clear session
    And redirect to Sign-In screen

