# Stripe environment configuration

Configure these values independently in each API deployment (Render, preview, or local environment).

## Test deployment

- `STRIPE_MODE=test`
- `STRIPE_SECRET_KEY`: a Stripe test secret key (`sk_test_...` or `rk_test_...`)
- `STRIPE_WEBHOOK_SECRET`: signing secret from the TEST webhook endpoint
- `STRIPE_PRICE_STARTER_UPFRONT`
- `STRIPE_PRICE_STARTER_MONTHLY`
- `STRIPE_PRICE_PROFESSIONAL_UPFRONT`
- `STRIPE_PRICE_PROFESSIONAL_MONTHLY`
- `STRIPE_PRICE_ENTERPRISE_UPFRONT`
- `STRIPE_PRICE_ENTERPRISE_MONTHLY`
- `STRIPE_PRICE_ENTERPRISE_ANNUAL`

All price variables must contain Price IDs created in the same Stripe TEST account as the test secret key.

## Live deployment

Use the same variable names, but set `STRIPE_MODE=live`, provide a LIVE secret key and use only Price IDs from the same LIVE Stripe account. Use the signing secret from the LIVE webhook endpoint.

## Safety rules

- Do not copy LIVE Price IDs or webhook secrets into a TEST deployment.
- Do not copy TEST Price IDs or webhook secrets into a LIVE deployment.
- The API checks that `STRIPE_MODE` matches the secret-key prefix and refuses to create Checkout sessions if the mode or any required Price ID is missing.
- Price IDs are never hard-coded in the source. There is no fallback to the former LIVE IDs.
- Configure secrets in the deployment's secret/environment settings; never commit secret values.
- Automatic tax is not enabled by this change. Tax treatment must be confirmed separately before production billing.
