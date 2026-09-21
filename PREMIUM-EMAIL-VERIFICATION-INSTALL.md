# Premium Cards: email instead of SMS

This update removes the SMS requirement. A verified account email identifies the member. The mobile number remains a unique, admin-entered contact detail and is no longer labelled SMS-verified. Existing cards, stamps, reward reservations and history are retained.

## 1. Apply the database change

- If Premium Cards is already installed: run the **entire** `migrations/20260921b_premium_email_verification.sql` in Supabase SQL Editor. This is the incremental patch.
- If Premium Cards has never been installed: run the **entire** updated `migrations/20260921_premium_cards.sql` instead. It still requires the existing production role function and compatible JSONB store_orders.items schema.

Do not run just a highlighted portion of a function. Both paths are rerunnable.

## 2. Configure email delivery in Supabase

1. Enable the Email provider and **Confirm Email**. Do not disable verification to bypass a delivery error. Existing accounts that were previously auto-confirmed are not proof that an email was delivered; ask those customers to use the new email link before issuing membership.
2. Configure custom SMTP for production customer emails. Supabase's default mail service is restricted and not suitable for general customer delivery. SMS provider configuration is no longer needed for Premium Cards.
3. Keep `{{ .ConfirmationURL }}` in the **Magic Link** email template. This release sends a clickable verification/sign-in link, not a numeric email OTP.
4. Set Site URL to your production site and add this exact allowed redirect URL:
   `https://chococravings.netlify.app/store?premium-card=1`
5. Use a sender address/domain authorized by your mail provider. SMTP credentials belong in Supabase, never in JavaScript.

References:
- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/auth-smtp

## 3. Replace website files and redeploy

Replace these complete files at your site root:

- premium-cards.js
- premium-cards.css
- store.html
- checkadminbadge-override.js
- table-service-patch.js
- sw.js

Deploy them together, then reload the store online. Existing Premium Cards functionality and the multi-item payment popup are retained.

## Customer and admin flow

1. Customer signs in using their existing account and opens **My Premium Card**.
2. Customer clicks **Send email verification link**. It sends only to the current signed-in account email; it does not create another account.
3. Customer opens the email link. It returns to the store's Premium Card screen. The email template must contain the link and the redirect must be allowed as above.
4. Admin issues the card using that account email, customer name and contact mobile. Already email-confirmed accounts can be issued immediately; a verified phone is not required.
5. Customers still generate the existing five-minute visit/reward code inside their authenticated account. Those codes are shown in the app, not emailed on every visit. Staff use them to assign pieces or reserve the permitted reward.

If sending fails, the app shows the actual email-provider error. Check Supabase Auth logs, SMTP credentials, allowed recipients/rate limits and spam folders. Changing from SMS to email does not itself configure email delivery. No live email was sent or delivery tested while preparing this package.

## Verification

Local tests cover email-required issuance with no verified phone, normalized contact numbers, existing card preservation, repeat application of the SQL patch, code generation/assignment without SMS, the email link request and its return URL, alongside the existing premium daily-stamp/reward tests.

The previous stock-trigger acceptance check still applies before enabling complimentary reward redemption: verify that adding a zero-price complimentary item to an existing order decrements stock once and that cancellation restores it once. This email update does not change the existing stock or cost-report behavior.
