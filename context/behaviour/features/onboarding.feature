Feature: Onboarding & Signup Flow

  Background: Business Rules
    # G-01: Onboarding flow starts after fresh install or from Sign-up → "Create an account"
    # G-02: Two signup methods: Email + Password or UAE PASS
    # G-03: UAE PASS users skip email/phone OTP – details fetched directly from UAE PASS (email & mobile become primary)
    # G-04: After signup → Internal user created (limited access)
    # G-05: Verify Identity step mandatory for upgrade to Basic/Advanced user
    # G-06: Full 14-step questionnaire required for Advanced (Full access) user

  #################################################
  # USER FLOW: Signup Options Screen
  #################################################

  Scenario: Displayed Elements
    Then Title: Sign Up
    And Email Address field
    And Password field + Show toggle
    And Confirm Password field
    And Password strength indicators
    And Create an account button
    And "or" separator
    And Continue with UAE PASS button

  #################################################
  # USER FLOW: Post-Signup – Welcome / Limited Access Screen
  #################################################

  Scenario: Displayed Elements
    Then Title: Welcome to xCube
    And Message: "You currently have limited access. Verify your identity and complete KYC within 7 days…"
    And Checkbox: "I have read and agree to the Privacy Policy"
    And Verify account button (disabled until checkbox ticked)
    And Skip for now (limited access)

  Scenario: Tap "Verify account"
    When user tap "verify account"
    Then Verify Your Identity screen

  Scenario: Tap "Skip for now"
    When user tap "skip for now"
    Then Home with limited features

  #################################################
  # USER FLOW: Verify Your Identity Screen
  #################################################

  Scenario: Displayed Elements
    Then Title: Verify your identity
    And Message: "We're excited… This will only take few minutes"
    And Steps list: 1. Scan ID, 2. Photo verification, 3. Verify address, 4. Trading questions
    And Note: "If you wear a hijab, please ensure your head is covered…"

  Scenario: Buttons
    Then Continue with UAE PASS
    And Continue with Emirates ID
    And Continue with Passport

  Scenario: UAE PASS
    When UAE PASS
    Then Open DV Data Vault
    And fetch documents
    And skip ID scan
    And Review & Confirm

  Scenario: Emirates ID / Passport
    When Emirates ID / Passport
    Then Third-party KYC SDK (scan + selfie)
    And Review & Confirm

  #################################################
  # USER FLOW: Review & Confirm Screen
  #################################################

  Scenario: Displayed Elements
    Then Title: Review & Confirm
    And Fetched details: Country/City of birth, Emirates ID, Full name, DOB, Gender, Nationality, Expiry
    And Looks Good button

  Scenario: Tap "Looks Good"
    When user tap "looks good"
    Then Next step (Proof of Address or questionnaire)

  #################################################
  # USER FLOW: Proof of Address Screen (Optional)
  #################################################

  Scenario: Displayed Elements
    Then Title: Proof of address
    And Instruction: "The document should match… utility bill, bank statement, rental agreement or title deed."
    And Attach file button (pdf, jpg, jpeg, png)
    And Checkbox: "Provided document is not in my name" + info tooltip
    And Remind me later link
    And Continue button

  Scenario: Upload document
    When user upload document
    Then Basic user created

  Scenario: Remind later / Skip
    When Remind later / Skip
    Then Basic user created (reminder banner shown at Explore Screen)

  #################################################
  # USER FLOW: Questionnaire Screens (Steps 2–14)
  #################################################

  Scenario: Examples
    Then Employment status (Employed / Self Employed / Not Employed)
    And Holding >5% in listed companies (Yes/No)
    And Related to employee in exchange/listed company (multiple choices)
    And Annual income ranges
    And Net worth ranges
    And Sources of income (multi-select)
    And Investment experience (years)
    And Risk tolerance (Low / Moderate / High)
    And Investment time horizon
    And Investment interests (multi-select: Shares, Sukuk & Bonds, ETFs, REITs, Futures)

  Scenario: All questions mandatory
    When All questions mandatory
    Then Required for Advanced user

  Scenario: After step 14 completed
    Given After step 14 completed
    Then Advanced (Full access) user created

  Scenario: Success screen
    When Success screen
    Then Home tab (full features unlocked)

