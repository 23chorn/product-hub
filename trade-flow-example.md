# Feature: Retail Stock Purchasing
Last Updated: 2026-04-12
Owner: Product Team

## User Flow: Purchasing a full share with sufficient funds
As a logged-in retail user
I want to buy a whole share of a stock
So that I can add it to my portfolio

### Scenario: Successful Market Buy Order

**Given** the user has a verified account
**And** their available cash balance is greater than or equal to the current market price of the stock
**When** they navigate to the stock's detail page
**And** they enter an integer value of `1` or greater into the "Shares" input field
**And** they click the "Confirm Purchase" button
**Then** the system executes a market buy order
**And** their cash balance is immediately deducted by the purchase price
**And** the stock is added to their portfolio positions
**And** a Slack/Push notification receipt is sent to the user