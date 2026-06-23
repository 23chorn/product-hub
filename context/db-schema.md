---
stages: [solution_architect, story_decomposition, tech_refinement, qa_engineer]
---
# xCube Database Schemas

This document contains the full schema for all 10 databases in the xCube platform. Each database corresponds to a microservice domain.

## Contents

1. [xCubeCMS — Content Management & Configuration](#1-xcubecms--content-management--configuration)
   - [tbl_Configuration](#tbl_configuration)
   - [tbl_BrokerageFees](#tbl_brokeragefees)
   - [tbl_CBBankDetails](#tbl_cbbankdetails)
   - [tbl_ContactInformation](#tbl_contactinformation)
   - [tbl_Content](#tbl_content)
   - [tbl_Countries](#tbl_countries)
   - [tbl_CuratedListCategory](#tbl_curatedlistcategory)
   - [tbl_CuratedListItem](#tbl_curatedlistitem)
   - [tbl_FAQ](#tbl_faq)
   - [tbl_MarketTiming](#tbl_markettiming)
   - [tbl_MarketTimingDetails](#tbl_markettimingdetails)
   - [tbl_UserComplaint](#tbl_usercomplaint)
   - [tbl_UserComplaintDocument](#tbl_usercomplaintdocument)
2. [xCubeMarketData — Market Data Service](#2-xcubemarketdata--market-data-service)
   - [tbl_PopularCompany](#tbl_popularcompany)
   - [tbl_WatchList](#tbl_watchlist)
   - [tbl_WatchListItem](#tbl_watchlistitem)
   - [FIDS](#fids)
   - [RICS](#rics)
   - [DoryAuthResponse](#doryauthresponse)
   - [tbl_CustomHighlights](#tbl_customhighlights)
3. [xCubeAdminPanel — Admin Portal](#3-xcubeadminpanel--admin-portal)
   - [AspNetUsers](#aspnetusers)
   - [AspNetRoles](#aspnetroles)
   - [AspNetUserRoles](#aspnetuserroles)
   - [AspNetRoleClaims](#aspnetroleclaims)
   - [AspNetUserClaims](#aspnetuserclaims)
   - [AspNetUserLogins](#aspnetuserlogins)
   - [AspNetUserTokens](#aspnetusertokens)
   - [SeriLogs (AdminPanel)](#serilogs-adminpanel)
4. [xCubeNotification — Notification Service](#4-xcubenotification--notification-service)
   - [tbl_Notification](#tbl_notification)
   - [tbl_NotificationTemplate](#tbl_notificationtemplate)
   - [tbl_OTP](#tbl_otp)
   - [tbl_UsersDeviceInfo](#tbl_usersdeviceinfo)
   - [tbl_BlockedUser](#tbl_blockeduser)
5. [xCubeOnboarding — Onboarding / KYC Service](#5-xcubeonboarding--onboarding--kyc-service)
   - [tbl_UserDetail](#tbl_userdetail)
   - [tbl_UserUnderReview](#tbl_userunderreview)
   - [tbl_UserUnderReviewDocuments](#tbl_userunderreviewdocuments)
   - [tbl_DocumentRequestedFromUser](#tbl_documentrequestedfromuser)
   - [tbl_UserChangeRequest](#tbl_userchangerequest)
   - [tbl_UserChangeRequestDocument](#tbl_userchangerequestdocument)
   - [tbl_FailedRequest](#tbl_failedrequest)
   - [tbl_UserOnboardingWarning](#tbl_useronboardingwarning)
   - [tbl_UqudoScreening](#tbl_uqudoscreening)
6. [xCubePortfolio — Portfolio Service](#6-xcubeportfolio--portfolio-service)
   - [tbl_MarginRequest](#tbl_marginrequest)
7. [xCubeWallet — Wallet Service](#7-xcubewallet--wallet-service)
   - [tbl_DepositsRequest](#tbl_depositsrequest)
   - [tbl_WithdrawalsRequest](#tbl_withdrawalsrequest)
   - [tbl_IBANDetails](#tbl_ibandetails)
   - [tbl_CreditCardDetails](#tbl_creditcarddetails)
8. [xCubeIPO — IPO Service](#8-xcubeipo--ipo-service)
   - [tbl_IPO](#tbl_ipo)
   - [tbl_IPOStates](#tbl_ipostates)
   - [tbl_IPO_States_WorkFlow](#tbl_ipo_states_workflow)
   - [tbl_TimeLineStatus](#tbl_timelinestatus)
   - [tbl_IPO_TimeLineStatus](#tbl_ipo_timelinestatus)
   - [tbl_Documents](#tbl_documents)
   - [tbl_IPO_Documents](#tbl_ipo_documents)
   - [tbl_PaymentMethods](#tbl_paymentmethods)
   - [tbl_IPO_Subscription](#tbl_ipo_subscription)
   - [tbl_IPO_Transactions](#tbl_ipo_transactions)
   - [tbl_IPO_AllocationDetails](#tbl_ipo_allocationdetails)
   - [tbl_IPO_UserNotificationSubscription](#tbl_ipo_usernotificationsubscription)
9. [xCubeLogs — Centralised Logging](#9-xcubelogs--centralised-logging)
   - [Serilogs](#serilogs)
10. [xCubePaymentGateway — CB Payment Gateway](#10-xcubepaymentgateway--cb-payment-gateway)
    - [tbl_CBPaymentTransactions](#tbl_cbpaymenttransactions)

---

## 1. xCubeCMS — Content Management & Configuration

Stores runtime configuration, CMS content, reference data, market timings, curated stock lists, FAQs, and user complaints.

### tbl_Configuration
Key-value store for runtime settings (e.g. popular companies rolling interval, OTP config).

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK, identity |
| ReferenceId | UNIQUEIDENTIFIER | default NEWID() |
| ConfigurationKey | NVARCHAR(300) | unique |
| ConfigurationValue | NVARCHAR(MAX) | |
| Description | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate | DATETIME | default GETUTCDATE() |
| CreatedBy | BIGINT | default 0 |
| ModifiedDate | DATETIME | |
| ModifiedBy | BIGINT | |

**Notable config keys:**
- `POPULAR_COMPANIES_ROLLING_INTERVAL` — days lookback window for popular stocks (default: 30)
- `POPULAR_COMPANIES_NO_OF_COMPANIES` — max results for list view (default: 3)
- `POPULAR_COMPANIES_SEARCH_NO_OF_COMPANIES` — max results for search (default: 5)

---

### tbl_BrokerageFees
Fee breakdown per country and exchange.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CountryName | NVARCHAR(1000) | |
| ExchangeName | NVARCHAR(1000) | |
| EquityDerivativeType | INT | |
| TotalFeesPerTrade | VARCHAR(500) | |
| OrderFees | VARCHAR(500) | |
| BrokerageCommission | VARCHAR(500) | |
| DFMCommission | VARCHAR(500) | |
| SCACommission | VARCHAR(500) | |
| CDSCommission | VARCHAR(500) | |
| IsExclusiveOfVAT | BIT | default 1 |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_CBBankDetails
Central Bank / payment bank list used for deposit flows.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| BankId | NVARCHAR(50) | unique |
| BankName | NVARCHAR(200) | |
| BankNameInArabic | NVARCHAR(200) | |
| LogoURL | NVARCHAR(MAX) | |
| Description | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(50) | |

---

### tbl_ContactInformation
Support contact details (email, phone, etc.).

| Column | Type | Notes |
|---|---|---|
| Id | INT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| ContactType | INT | e.g. EmailSupport, PhoneSupport |
| ContactValue | NVARCHAR(1000) | |
| ContactTimings | NVARCHAR(1000) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_Content
Generic CMS content blocks (text, links, descriptions).

| Column | Type | Notes |
|---|---|---|
| Id | INT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| ContentPurposeType | INT | |
| ContentDataType | INT | |
| ContentCode | NVARCHAR(300) | unique |
| ContentValue | NVARCHAR(300) | |
| ContentText | NVARCHAR(1000) | |
| ContentDescription | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_Countries
Country reference data including dial codes and currency.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CountryName | NVARCHAR(150) | |
| CountryCode | NVARCHAR(50) | |
| AlphaTwoCharacter | NVARCHAR(2) | ISO 3166-1 alpha-2 |
| AlphaThreeCharacter | NVARCHAR(3) | ISO 3166-1 alpha-3 |
| CountryDialingCode | NVARCHAR(10) | |
| PhoneNumberMaxLength | INT | |
| CurrencyCode | NVARCHAR(5) | |
| CurrencyName | NVARCHAR(100) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_CuratedListCategory
Categories for editorially curated stock lists (e.g. "Top Picks", "Dividend Stocks").

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CategoryCode | VARCHAR(500) | unique |
| CategoryName | NVARCHAR(500) | |
| CategoryDescription | NVARCHAR(1000) | |
| LogoPath | NVARCHAR(MAX) | |
| VisitCount | INT | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_CuratedListItem
Individual stock symbols belonging to a curated category.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CategoryCode | VARCHAR(500) | FK → tbl_CuratedListCategory |
| Symbol | NVARCHAR(300) | stock RIC / symbol |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_FAQ
FAQ entries for in-app help.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| Question | NVARCHAR(MAX) | |
| Answer | NVARCHAR(MAX) | |
| AnswerContentType | NVARCHAR(MAX) | e.g. HTML, plain text |
| IsActive | BIT | default 1 |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(200) | |

---

### tbl_MarketTiming
Trading session windows with per-session order permission flags.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| SessionName | NVARCHAR(200) | |
| Description | NVARCHAR(MAX) | |
| StartTime | TIME | |
| EndTime | TIME | |
| Timezone | NVARCHAR(100) | |
| IsActive | BIT | default 1 |
| AllowNewOrder | INT | |
| AllowAmendment | BIT | default 1 |
| AllowCancellation | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(200) | |

---

### tbl_MarketTimingDetails
Simplified market open/close times per market name.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| MarketName | NVARCHAR(MAX) | |
| OpeningTime | NVARCHAR(50) | |
| ClosingTime | NVARCHAR(50) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UserComplaint
User-submitted complaints.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| UserEmailId | NVARCHAR(500) | |
| OmsCustomerId | VARCHAR(100) | |
| Message | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UserComplaintDocument
Documents attached to user complaints.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| UserComplaintId | BIGINT | FK → tbl_UserComplaint |
| DocumentName | NVARCHAR(500) | |
| DocumentReason | NVARCHAR(MAX) | |
| FilePath | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

## 2. xCubeMarketData — Market Data Service

Stores watchlists, popular companies, market data field mappings (FIDS/RICS), auth tokens, and custom highlights.

### tbl_PopularCompany
Tracks view and buy counts per stock to power the "popular stocks" feature.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CompanySymbol | NVARCHAR(300) | indexed |
| CompanyName | NVARCHAR(1000) | |
| NumberOfVisits | BIGINT | cumulative count |
| LastVisitedDate | DATETIME | indexed; used for rolling window filter |
| PopularBasedOnType | INT | 1 = view, 2 = buy |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

**Key behaviour:** `sp_GetPopularCompanies` filters to `LastVisitedDate >= now - POPULAR_COMPANIES_ROLLING_INTERVAL days`, ordered by `NumberOfVisits DESC`.

---

### tbl_WatchList
User-defined watchlists.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| UserEmailId | NVARCHAR(500) | indexed |
| OMSCustomerId | VARCHAR(100) | indexed |
| Name | NVARCHAR(300) | |
| Logo | NVARCHAR(MAX) | icon/emoji from mobile |
| SequenceNumber | BIGINT | display order |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | default GETUTCDATE() |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_WatchListItem
Individual stock entries within a watchlist.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| WatchListId | BIGINT | FK → tbl_WatchList; indexed |
| CompanySymbol | NVARCHAR(300) | |
| IsActive | BIT | default 1 |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### FIDS
Reuters field ID (FID) mappings to internal API fields.

| Column | Type | Notes |
|---|---|---|
| ID | INT | PK |
| U_ID | NVARCHAR(MAX) | |
| FID_ID | NVARCHAR(MAX) | Reuters FID identifier |
| MAPPED_API | NVARCHAR(MAX) | internal API field name |
| DISPLAY_NAME | NVARCHAR(MAX) | |
| MODIFIED_DATE | DATETIME2 | |
| IS_ACTIVE | BIT | |

---

### RICS
Reuters Instrument Code (RIC) mappings.

| Column | Type | Notes |
|---|---|---|
| ID | INT | PK |
| U_ID | NVARCHAR(MAX) | |
| RIC_ID | NVARCHAR(MAX) | Reuters RIC code |
| MAPPED_API | NVARCHAR(MAX) | |
| DISPLAY_NAME | NVARCHAR(MAX) | |
| SLB_COST | DECIMAL(10,5) | |
| COMPANY_NAME | NVARCHAR(MAX) | |
| LOGO_PATH | NVARCHAR(MAX) | |
| TYPE | NVARCHAR(50) | e.g. equity, ETF |
| BCAST_REF | NVARCHAR(50) | |
| UNDERLYING_ASSET | NVARCHAR(50) | |
| MODIFIED_DATE | DATETIME2 | |
| IS_ACTIVE | BIT | |

---

### DoryAuthResponse
Cached Dory (market data feed) authentication tokens.

| Column | Type | Notes |
|---|---|---|
| id | INT | PK |
| sid | NVARCHAR(MAX) | session ID |
| expiresAt | INT | Unix timestamp |
| token | NVARCHAR(MAX) | |

---

### tbl_CustomHighlights
Admin-pinned or auto-generated market highlight articles.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| MarketDataArticleId | NVARCHAR(100) | |
| Title | NVARCHAR(MAX) | |
| Description | NVARCHAR(MAX) | |
| Body | NVARCHAR(MAX) | |
| Symbol | NVARCHAR(MAX) | associated stock symbol |
| PictureUrl | NVARCHAR(MAX) | |
| AddedByType | NVARCHAR(50) | |
| IsPinned | BIT | |
| ArticleDateTime | DATETIME | |
| IsActive | BIT | |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(50) | |

---

## 3. xCubeAdminPanel — Admin Portal

Standard ASP.NET Core Identity tables for admin user management, plus an admin-local Serilog table.

### AspNetUsers
| Column | Type |
|---|---|
| Id | NVARCHAR(450) PK |
| UserName | NVARCHAR(256) |
| NormalizedUserName | NVARCHAR(256) |
| Email | NVARCHAR(256) |
| NormalizedEmail | NVARCHAR(256) |
| EmailConfirmed | BIT |
| PasswordHash | NVARCHAR(MAX) |
| SecurityStamp | NVARCHAR(MAX) |
| ConcurrencyStamp | NVARCHAR(MAX) |
| PhoneNumber | NVARCHAR(MAX) |
| PhoneNumberConfirmed | BIT |
| TwoFactorEnabled | BIT |
| LockoutEnd | DATETIMEOFFSET(7) |
| LockoutEnabled | BIT |
| AccessFailedCount | INT |

### AspNetRoles
| Column | Type |
|---|---|
| Id | NVARCHAR(450) PK |
| Name | NVARCHAR(256) |
| NormalizedName | NVARCHAR(256) |
| ConcurrencyStamp | NVARCHAR(MAX) |

### AspNetUserRoles
| Column | Type | Notes |
|---|---|---|
| UserId | NVARCHAR(450) PK | FK → AspNetUsers |
| RoleId | NVARCHAR(450) | FK → AspNetRoles |

### AspNetRoleClaims
| Column | Type | Notes |
|---|---|---|
| Id | INT PK | |
| RoleId | NVARCHAR(450) | FK → AspNetRoles |
| ClaimType | NVARCHAR(MAX) | |
| ClaimValue | NVARCHAR(MAX) | |

### AspNetUserClaims
| Column | Type | Notes |
|---|---|---|
| Id | INT PK | |
| UserId | NVARCHAR(450) | FK → AspNetUsers |
| ClaimType | NVARCHAR(MAX) | |
| ClaimValue | NVARCHAR(MAX) | |

### AspNetUserLogins
| Column | Type | Notes |
|---|---|---|
| LoginProvider | NVARCHAR(128) PK | |
| ProviderKey | NVARCHAR(128) | |
| ProviderDisplayName | NVARCHAR(MAX) | |
| UserId | NVARCHAR(450) | FK → AspNetUsers |

### AspNetUserTokens
| Column | Type | Notes |
|---|---|---|
| UserId | NVARCHAR(450) PK | FK → AspNetUsers |
| LoginProvider | NVARCHAR(128) | |
| Name | NVARCHAR(128) | |
| Value | NVARCHAR(MAX) | |

### SeriLogs (AdminPanel)
Serilog sink table for the admin panel service.

| Column | Type |
|---|---|
| Id | INT PK |
| Message | NVARCHAR(MAX) |
| Level | NVARCHAR(MAX) |
| TimeStamp | DATETIME |
| Exception | NVARCHAR(MAX) |
| Properties | NVARCHAR(MAX) |
| CorrelationId | VARCHAR(MAX) |

---

## 4. xCubeNotification — Notification Service

Manages push, SMS, and email notifications, OTP, device registrations, and blocked users.

### tbl_Notification
Log of all sent notifications.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| NotificationChannelType | INT | push / SMS / email |
| NotificationChannelValue | NVARCHAR(200) | device token / phone / email |
| NotificationTemplateId | BIGINT | |
| ContentSubject | NVARCHAR(500) | |
| Content | NVARCHAR(MAX) | |
| ContentType | INT | |
| NotificationStatus | INT | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_NotificationTemplate
Reusable notification templates.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| TemplateCode | VARCHAR(200) | unique; indexed |
| ContentType | INT | |
| ContentSubject | NVARCHAR(500) | |
| ContentTemplate | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_OTP
OTP records for login, verification, and sensitive actions.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| OTPPurposeType | INT | |
| NotificationTemplateCode | VARCHAR(200) | |
| OTPValue | VARCHAR(10) | |
| OTPExpiryDateTime | DATETIME | |
| NotificationChannelType | INT | indexed |
| NotificationChannelValue | NVARCHAR(200) | indexed |
| OTPStatus | INT | default 1 |
| NoOfInvalidOTPVerificationAttempt | INT | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UsersDeviceInfo
Registered devices per user, with notification subscription flags.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CustomerNIN | NVARCHAR(100) | |
| EmailId | NVARCHAR(100) | indexed |
| DeviceOS | NVARCHAR(100) | |
| AppVersion | NVARCHAR(50) | |
| DeviceOSVersion | NVARCHAR(50) | |
| DeviceId | NVARCHAR(MAX) | |
| UserLoggedInDeviceIds | NVARCHAR(MAX) | |
| DeviceName | NVARCHAR(100) | |
| IsSMSSubscribed | BIT | default 1 |
| IsEmailSubscribed | BIT | default 1 |
| IsPushSubscribed | BIT | default 1 |
| IsActive | BIT | default 1 |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_BlockedUser
Users blocked from receiving notifications (e.g. max OTP attempts reached).

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| NotificationChannelType | INT | |
| NotificationChannelValue | NVARCHAR(200) | |
| BlockingReasonType | INT | e.g. ReachedMaxEmailOTPAttempts |
| BlockType | INT | Temporary or Permanent |
| BlockReleaseDateTime | DATETIME | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

## 5. xCubeOnboarding — Onboarding / KYC Service

Manages user registration, KYC documents, change requests, failed API calls, and under-review workflows.

### tbl_UserDetail
Core user record created during onboarding.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | VARCHAR(300) | indexed |
| MobileNumber | VARCHAR(30) | |
| Name | NVARCHAR(500) | |
| Password | NVARCHAR(MAX) | hashed |
| OMSCustomerId | NVARCHAR(500) | assigned after advance onboarding |
| NIN | NVARCHAR(500) | national ID number |
| PrimaryIBan | NVARCHAR(500) | |
| SecondaryIBan | NVARCHAR(500) | |
| EmiratesId | NVARCHAR(200) | |
| DeviceOS / AppVersion / DeviceOSVersion | VARCHAR(300) | |
| DeviceId / DeviceName | VARCHAR/NVARCHAR(300) | |
| IPAddress | VARCHAR(300) | |
| UUID | NVARCHAR(300) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UserUnderReview
Users flagged for manual review (e.g. NIN under review, sanctions list).

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| UserEmailId | NVARCHAR(500) | |
| UserMobileNumber | VARCHAR(20) | |
| OMSCustomerNumber | VARCHAR(30) | |
| UserUnderReviewReasonType | INT | e.g. NIN under review, sanctions |
| UserUnderReviewStatusType | INT | Pending / Confirm / Reject |
| NINNumber | VARCHAR(100) | |
| TrackingNumber | VARCHAR(100) | |
| PrimaryIBAN / SecondaryIBAN | VARCHAR(100) | |
| RequestFilePath | NVARCHAR(3000) | |
| DocumentRequestStatusType | INT | DocumentRequested / WaitingForReview / Reviewed |
| ResponseLog | NVARCHAR(MAX) | |
| RejectedReasonType | INT | |
| RejectedReason | NVARCHAR(MAX) | |
| AdvancedOnboardingStatus | INT | default 1 |
| IsSubscribedForStatusChangeNotification | BIT | default 0 |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UserUnderReviewDocuments
Documents submitted by or requested from users under review.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| UserUnderReviewId | BIGINT | indexed |
| DocumentType | VARCHAR(30) | |
| DocumentName | NVARCHAR(200) | |
| FilePath | NVARCHAR(MAX) | |
| AdminProvidedReason | NVARCHAR(4000) | |
| UserProvidedReason | NVARCHAR(4000) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_DocumentRequestedFromUser
Admin-initiated document requests tied to a change request.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| OMSCustomerNumber | VARCHAR(500) | indexed |
| UserEmailId | NVARCHAR(1000) | indexed |
| RequestedReasonTypeId | INT | |
| ChangeRequestType | INT | |
| ChangeRequestId | BIGINT | |
| RequestedReason | NVARCHAR(MAX) | |
| RequestedDocumentName | NVARCHAR(300) | |
| RequestedStatusType | INT | default 1 (DocumentRequested) |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UserChangeRequest
User-initiated change requests (address update, name change, etc.).

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| UserEmailId | NVARCHAR(500) | indexed |
| OMSCustomerId | NVARCHAR(100) | |
| CustomerId | NVARCHAR(100) | |
| ChangeRequestType | INT | |
| ChangeRequestReasonType | INT | |
| ChangeRequestReason | NVARCHAR(MAX) | |
| RequestObject | IMAGE | serialised request payload |
| ChangeRequestStatusType | INT | default 1 (Pending) |
| ChangeRequestRejectedReason | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UserChangeRequestDocument
Supporting documents for a user change request.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| UserChangeRequestId | BIGINT | indexed |
| UserProvidedReasonType | INT | |
| UserProvidedReason | NVARCHAR(MAX) | |
| FileExtension | VARCHAR(50) | |
| CustomerIdType | INT | EmiratesId, Passport, Proof of address, etc. |
| DocumentName | NVARCHAR(300) | |
| DocumentPath | VARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_FailedRequest
Log of failed onboarding API calls for retry/investigation.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | VARCHAR(300) | indexed |
| MobileNumber | VARCHAR(30) | indexed |
| Name | NVARCHAR(500) | |
| ApiRequestType | INT | 1=BasicOnboarding, 2=DocumentUploads, 3=AdvanceOnboarding |
| ApiRequestFilePath | NVARCHAR(3000) | |
| IsRequestSucceed | BIT | |
| NIN / Iban / SecIBan / OMSCustomerId / CRMTrackingNumber | VARCHAR(200) | |
| ResponseLog | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UserOnboardingWarning
Non-fatal warnings logged during the onboarding process.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | VARCHAR(300) | indexed |
| MobileNumber | VARCHAR(30) | indexed |
| Name | NVARCHAR(500) | |
| ApiRequestType | INT | 1=Basic, 2=DocumentUploads, 3=Advance |
| NIN / Iban / SecIBan / OMSCustomerId | VARCHAR(200) | |
| Message | NVARCHAR(MAX) | |
| IsActive | BIT | default 1 |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

### tbl_UqudoScreening
Raw request/response log for Uqudo KYC identity screening.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| Email | VARCHAR(300) | |
| MobileNumber | VARCHAR(30) | |
| CustomerName | NVARCHAR(500) | |
| Request | NVARCHAR(MAX) | raw request payload |
| Response | NVARCHAR(MAX) | raw response payload |
| CreatedDate / ModifiedDate | DATETIME | |
| CreatedBy / ModifiedBy | BIGINT | |

---

## 6. xCubePortfolio — Portfolio Service

### tbl_MarginRequest
Requests from users to enable margin trading.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | NVARCHAR(100) | indexed |
| CustomerId | NVARCHAR(100) | indexed |
| CustomerName | NVARCHAR(200) | |
| RequestedOn | DATETIME | default GETUTCDATE() |
| RequestStatus | NVARCHAR(50) | |
| Comments | NVARCHAR(MAX) | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

## 7. xCubeWallet — Wallet Service

Manages deposits, withdrawals, IBAN details, and stored card tokens.

### tbl_DepositsRequest
Records of deposit requests submitted by users.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | NVARCHAR(100) | indexed |
| IBAN | NVARCHAR(200) | |
| DepositType | NVARCHAR(100) | |
| CurrencyCode | NVARCHAR(50) | |
| Amount | MONEY | |
| Fees | MONEY | |
| TotalDepositAmount | MONEY | |
| DFNRequestStatus | NVARCHAR(50) | status from DFN/OMS |
| IsSuccess | BIT | |
| Message | NVARCHAR(MAX) | |
| ErrorCode | NVARCHAR(50) | |
| IsActive | BIT | default 1 |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_WithdrawalsRequest
Records of withdrawal requests submitted by users.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | NVARCHAR(100) | indexed |
| IBAN | NVARCHAR(200) | |
| IBANDetailsId | BIGINT | indexed; FK to tbl_IBANDetails |
| BeneficiaryName | NVARCHAR(100) | |
| BeneficiaryAddress | NVARCHAR(MAX) | |
| WithdrawalType | NVARCHAR(50) | |
| RequestType | INT | |
| Reason | NVARCHAR(250) | |
| CurrencyCode | NVARCHAR(50) | |
| Amount | MONEY | |
| Fees | MONEY | |
| TotalWithdrawalAmount | MONEY | |
| WithdrawalStatus | NVARCHAR(50) | |
| DFNPaymentStatus | NVARCHAR(50) | |
| Comments | NVARCHAR(MAX) | |
| CreditForRejectionStatus | NVARCHAR(MAX) | |
| PrimaryIBAN | NVARCHAR(200) | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_IBANDetails
Saved bank account / IBAN details per user.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CustomerId | BIGINT | |
| EmailId | NVARCHAR(100) | indexed |
| IBAN | NVARCHAR(MAX) | |
| BankName | NVARCHAR(250) | |
| SWIFTCode | NVARCHAR(100) | |
| Address / City / State / ZIP / Country | NVARCHAR | |
| CountryISO | NVARCHAR(50) | |
| BankCode / Branch / BranchCode / AdditionalCode | NVARCHAR | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_CreditCardDetails
Tokenised credit card details (no raw PAN stored).

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CustomerId | BIGINT | |
| EmailId | NVARCHAR(100) | |
| OrderRefNumber | NVARCHAR(100) | |
| MaskedPan | NVARCHAR(250) | last 4 digits only |
| Expiry | NVARCHAR(50) | |
| CardHolderName | NVARCHAR(100) | |
| Scheme | NVARCHAR(100) | Visa / Mastercard etc. |
| CardToken | NVARCHAR(100) | payment gateway token |
| RecaptureCsc | BIT | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

## 8. xCubeIPO — IPO Service

Manages IPO listings, subscriptions, allocations, timelines, and documents.

### tbl_IPO
Master IPO record.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| Code | NVARCHAR(100) | |
| Name | NVARCHAR(100) | indexed |
| LogoURL | NVARCHAR(250) | |
| CompanyName | NVARCHAR(250) | |
| Description | NVARCHAR(MAX) | |
| CompanyWebsiteURL | NVARCHAR(250) | |
| SharePrice | NVARCHAR(50) | |
| TotalSharesOffered | BIGINT | |
| IPOStateTypeId | BIGINT | current state |
| ProposedSymbol | NVARCHAR(MAX) | |
| ExchangeCode | NVARCHAR(50) | |
| MinimumShareApplicable | BIGINT | |
| MaximumAmount / MinimumAmount | MONEY | |
| ShareMultiplier / AmountMultiplier | MONEY | |
| SubscriptionFeesPercentage | DECIMAL(18,2) | |
| CurrencyCode | NVARCHAR(20) | |
| CurrentTimelineStatus | NVARCHAR(100) | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_IPOStates
Lookup table for IPO lifecycle states.

| Column | Type |
|---|---|
| Id | BIGINT PK |
| ReferenceId | UNIQUEIDENTIFIER |
| State | NVARCHAR(100) |
| Description | NVARCHAR(250) |
| IsActive | BIT |
| CreatedOn / ModifiedOn | DATETIME |
| CreatedBy / ModifiedBy | NVARCHAR(100) |

---

### tbl_IPO_States_WorkFlow
Audit trail of state transitions for an IPO.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| IPOId | BIGINT | FK → tbl_IPO (cascade delete) |
| IPOStateId | BIGINT | FK → tbl_IPOStates (cascade delete) |
| Comments | NVARCHAR(250) | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_TimeLineStatus
Lookup for IPO milestone types (e.g. "Subscription Open", "Allocation").

| Column | Type |
|---|---|
| Id | BIGINT PK |
| ReferenceId | UNIQUEIDENTIFIER |
| Title | NVARCHAR(200) |
| Description | NVARCHAR(250) |
| IsActive | BIT |
| CreatedOn / ModifiedOn | DATETIME |
| CreatedBy / ModifiedBy | NVARCHAR(100) |

---

### tbl_IPO_TimeLineStatus
IPO-specific timeline milestones with dates.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| IPOId | BIGINT | FK → tbl_IPO |
| TimeLineStatusId | BIGINT | FK → tbl_TimeLineStatus (cascade delete) |
| Description | NVARCHAR(250) | |
| Duration | NVARCHAR(250) | |
| StartDate / EndDate | DATETIME | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_Documents
Document type definitions used across IPO docs.

| Column | Type |
|---|---|
| Id | BIGINT PK |
| ReferenceId | UNIQUEIDENTIFIER |
| Name | NVARCHAR(200) |
| IsActive | BIT |
| CreatedOn / ModifiedOn | DATETIME |
| CreatedBy / ModifiedBy | NVARCHAR(100) |

---

### tbl_IPO_Documents
Links IPO records to their documents (prospectus, etc.).

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| IPOId | BIGINT | FK → tbl_IPO (cascade delete) |
| DocumentId | BIGINT | FK → tbl_Documents (cascade delete) |
| URL | NVARCHAR(MAX) | file URL |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_PaymentMethods
Lookup of payment method types available for IPO subscription.

| Column | Type |
|---|---|
| Id | INT PK |
| ReferenceId | UNIQUEIDENTIFIER |
| PaymentType | NVARCHAR(100) |
| Description | NVARCHAR(200) |
| IsActive | BIT |
| CreatedOn / ModifiedOn | DATETIME |
| CreatedBy / ModifiedBy | NVARCHAR(100) |

---

### tbl_IPO_Subscription
User subscriptions to an IPO.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| CustomerId | NVARCHAR(100) | |
| CustomerNIN | NVARCHAR(100) | |
| SubscriptionIPONumber | NVARCHAR(100) | |
| IPOId | BIGINT | FK → tbl_IPO (cascade delete) |
| ExpectedNoOfShares | BIGINT | |
| TargetPrice | NVARCHAR(100) | |
| TotalSubscriptionAmount / SubscriptionFees / TotalAmount | MONEY | |
| SubscribedOn | DATETIME | |
| SubscriptionEndDate | DATETIME | |
| PaymentMethodTypeId | INT | FK → tbl_PaymentMethods (cascade delete) |
| TransactionId | NVARCHAR(100) | |
| PaymentStatus | NVARCHAR(50) | |
| CurrencyCode | NVARCHAR(20) | |
| SubscriptionStatus | INT | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_IPO_Transactions
Financial transaction records for IPO subscriptions.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| IPOSubscriptionId | BIGINT | FK → tbl_IPO_Subscription (cascade delete) |
| Type | NVARCHAR(50) | |
| Amount | MONEY | |
| CurrencyCode | NVARCHAR(20) | |
| Description | NVARCHAR(250) | |
| Status | NVARCHAR(100) | |
| TransactionReference | NVARCHAR(250) | |
| TransactionCode | NVARCHAR(50) | |
| IsActive | BIT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_IPO_AllocationDetails
Share allocation results after IPO closes.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| IPOId | BIGINT | FK → tbl_IPO (cascade delete) |
| CustomerNIN | NVARCHAR(100) | |
| CustomerName | NVARCHAR(100) | |
| SharesAllocated | BIGINT | |
| CashBalance | MONEY | |
| Status | TINYINT | |
| NotificationStatus | TINYINT | |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

### tbl_IPO_UserNotificationSubscription
Tracks which users opted in for IPO status push notifications.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | NVARCHAR(100) | |
| IPOId | BIGINT | FK → tbl_IPO (cascade delete) |
| TemplateCode | NVARCHAR(200) | |
| NotificationStatus | INT | default 0 |
| IsActive | BIT | default 1 |
| CreatedOn / ModifiedOn | DATETIME | |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |

---

## 9. xCubeLogs — Centralised Logging

### Serilogs
Enriched Serilog sink table used across all services.

| Column | Type | Notes |
|---|---|---|
| Id | INT | PK |
| EmailId | VARCHAR(500) | |
| CustomerId | VARCHAR(100) | |
| MobileNumber | VARCHAR(30) | |
| Message | NVARCHAR(MAX) | |
| SectionName | VARCHAR(1000) | service section tag |
| DeviceUUID | VARCHAR(1000) | |
| RequestSource / RequestDestination | VARCHAR(4000) | |
| APIEndpoint | VARCHAR(4000) | |
| CorrelationId | VARCHAR(4000) | |
| ClientIp | VARCHAR(300) | |
| DeviceInfo | VARCHAR(300) | |
| Parameter | VARCHAR(MAX) | request parameters (masked) |
| Level | NVARCHAR(MAX) | Info / Warning / Error |
| TimeStamp | DATETIME | |
| Exception | NVARCHAR(MAX) | |
| Properties | NVARCHAR(MAX) | full Serilog properties JSON |
| HostName | NVARCHAR(MAX) | |
| ElapsedTime | VARCHAR(50) | request duration |

---

## 10. xCubePaymentGateway — CB Payment Gateway

### tbl_CBPaymentTransactions
Central Bank payment gateway transaction log.

| Column | Type | Notes |
|---|---|---|
| Id | BIGINT | PK |
| ReferenceId | UNIQUEIDENTIFIER | |
| EmailId | NVARCHAR(200) | |
| TransactionId | NVARCHAR(100) | |
| IBAN | NVARCHAR(200) | |
| Amount / Fees / TotalAmount | MONEY | |
| BankId | NVARCHAR(200) | |
| NIN | NVARCHAR(200) | |
| Language | NVARCHAR(200) | |
| Currency | NVARCHAR(200) | |
| PaymentStatus | NVARCHAR(50) | |
| ResponseCode | NVARCHAR(10) | |
| ResponseMessage | NVARCHAR(MAX) | |
| RetreivalReferenceNo | NVARCHAR(200) | |
| Response | NVARCHAR(MAX) | raw gateway response |
| CreatedOn / ModifiedOn | DATETIME | default GETUTCDATE() |
| CreatedBy / ModifiedBy | NVARCHAR(100) | |
