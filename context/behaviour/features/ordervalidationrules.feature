Feature: Order Validation Rules

  Background: Business Rules
    # V-01: Buying Power check required for all Buy orders (Market & Limit)
    # V-02: Holdings check required for all Sell orders (Market & Limit) on Stocks
    # V-04: Short Sell supported only on Stocks, ETF
    # V-05: Validation failure → disable Confirm button + show specific error
    # V-06: Futures and Short Sell require Margin-enabled account
    # V-07: Order Modification not allowed for Futures and Short Sell orders

