# Earning Target Engine: "How much must I earn per day and per week?"

This is the core of the app. It runs as plain, tested maths (SQL function
`compute_earning_target()` in [`0008_functions.sql`](../../wealthpilot/supabase/migrations/0008_functions.sql)). The AI explains the result but
does not produce it.

## 1. Formula

All amounts are **monthly take-home** equivalents. Anything yearly is divided by 12, and
anything paid daily is multiplied by 365/12 (30.42).

```
Required monthly (R) =
    Fixed obligations     EMIs + rent + insurance (annual/12) + utilities + subscriptions
  + Card debt payoff      planned monthly payoff of revolving card debt (0 if you pay in full)
  + Kids' education       school fees (annual/12) + tuition + books + transport
  + Daily needs           average daily spend × 30.42
  + Sinking funds         holidays/12 + festivals/12 + planned purchases ÷ months left
  + Investing             SIPs + emergency-fund top-up + goal SIPs (college, FI)
  × (1 + safety buffer)   default 5%

Daily Earning Target (DET)   = R × 12 / 365          (calendar day)
Working-day target           = R × 12 / working days per year  (e.g. 26 × 12 = 312)
Weekly target                = DET × 7
Gross target (before tax)    = take-home target / (1 − effective tax rate)
```

Card *spending* already counts as daily needs or bills. Only revolving debt you are
paying off goes in "Card debt payoff", so nothing is counted twice.

## 2. Worked example (family of 4)

| Bucket | Item | Monthly ₹ |
|--------|------|----------:|
| Fixed | Home loan EMI | 21,500 |
| Fixed | Car loan EMI | 9,800 |
| Fixed | Electricity, water, gas | 3,200 |
| Fixed | Phone, internet, OTT | 1,900 |
| Fixed | Term + health insurance (₹36,000/yr) | 3,000 |
| Kids | School fees, 2 kids (₹1,20,000/yr) | 10,000 |
| Kids | Tuition, books, school bus | 4,000 |
| Daily | Groceries, milk, fuel, medicine (₹550/day) | 16,730 |
| Sinking | Holiday fund (₹90,000/yr) | 7,500 |
| Sinking | Festivals and gifts (₹36,000/yr) | 3,000 |
| Invest | Equity SIP (financial freedom) | 8,000 |
| Invest | Emergency fund top-up | 2,000 |
| Invest | Kids' college SIP | 3,000 |
| | **Subtotal** | **93,630** |
| | Safety buffer 5% | 4,682 |
| | **Required monthly (R)** | **98,312** |

| Target | Value |
|--------|------:|
| **Per day (calendar)** | **₹3,233** |
| **Per week** | **₹22,631** |
| Per working day (26 days/month) | ₹3,782 |
| Per month | ₹98,312 |

## 3. Financial freedom (FI) number and Freedom Date

```
Living cost at freedom  = today's monthly cost − EMIs that will be closed
                          − school costs that will end − investing contributions
FI number               = living cost × 12 × 25      (the 4% safe-withdrawal rule;
                                                      use 30× for extra safety)
Freedom %               = current invested corpus / FI number
Years to FI (n)         solves  P(1+r)ⁿ + C·((1+r)ⁿ − 1)/r = FI number
                         P = corpus today, C = yearly investing, r = real return (after inflation)
```

Example: living cost at freedom ₹35,330/month, so the FI number is **₹1.06 Cr** (in today's
rupees). With a corpus of ₹36 L, Freedom is **34%** done. Investing ₹8,000/month at a 5%
real return gives about **16.8 years, around Jul 2043**.

## 4. "Increase that": growth plan

The app tracks **actual earned per day** against the DET and shows the gap. The Earning
Coach then proposes levers, each with its effect on the Freedom Date:

| Lever | Example | Effect |
|-------|---------|--------|
| Earn more | +₹500/day invested (≈ ₹15,200/month) | Freedom moves from **2043 to about 2038** (11.6 yrs) |
| Cut waste (Cost Cutter) | Cancel unused subscriptions, avoid card interest and late fees | Lowers DET directly |
| Step-up SIP | +10% SIP every year with salary hikes | Pulls the Freedom Date earlier |
| Prepay costly debt | Card/personal loan > 14% before investing | Guaranteed "return" |
| Close an EMI | When a loan ends, redirect the EMI into a SIP | Same lifestyle, faster freedom |
| Raise the target on purpose | Set "stretch DET" = DET × 1.15 | Surplus goes to the FI goal automatically |

Each week the Home card shows: **target · actual · gap · one action**.
