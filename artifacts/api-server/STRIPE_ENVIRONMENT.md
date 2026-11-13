# Stripe environment configuration

Configure these values independently in each API deployment (Render, preview, or local environment).

## Test deployment

- `STRIPE_MODE=test`
- `STRIPE_SECRET_KEY`: a Stripe test secret key (`sk_test_...` or `rk_test_...`)
- `STRIPE_WEBHOOK_SECRET`: signing secret from the TEST webhook endpoint
- `STRIPE_PRICE_STARTER_UPFRONT=price_1UbPKTJDV3EHTYzCuvIDn4qw`
- `STRIPE_PRICE_STARTER_MONTHLY=price_1UbPKWJDV3EHTYzCPh1c8tvA`
- `STRIPE_PRICE_PROFESSIONAL_UPFRONT=price_1UbPKZJDV3EHTYzCkHTRw74E`
- `STRIPE_PRICE_PROFESSIONAL_MONTHLY=price_1UbPKdJDV3EHTYzCKJg5awed`
- `STRIPE_PRICE_ENTERPRISE_UPFRONT=price_1UbPKgJDV3EHTYzC9epI2Lv1`
- `STRIPE_PRICE_ENTERPRISE_MONTHLY=price_1UbPKjJDV3EHTYzCK7ZN4ui4`
- `STRIPE_PRICE_ENTERPRISE_ANNUAL=price_1UbPKmJDV3EHTYzCpk9qGBDa`

Products in the TEST catalog:
- Starter: `prod_VcednCmLgnHOw4`
- Professional: `prod_VcedHNdjKTDS9U`
- Enterprise: `prod_Vcedln2bSUSIDi`

All price variables must contain Price IDs created in the same Stripe TEST account as the test secret key. The prices are configured with exclusive tax behavior, but Stripe automatic tax is not enabled and no tax registrations are configured.

## Live deployment

Use the same variable names, but set `STRIPE_MODE=live`, provide a LIVE secret key and use only Price IDs from the same LIVE Stripe account. Use the signing secret from the LIVE webhook endpoint.

## Safety rules

- Do not copy LIVE Price IDs or webhook secrets into a TEST deployment.
- Do not copy TEST Price IDs or webhook secrets into a LIVE deployment.
- The API checks that `STRIPE_MODE` matches the secret-key prefix and refuses to create Checkout sessions if the mode or any required Price ID is missing.
- Price IDs are never hard-coded in the source. There is no fallback to the former LIVE IDs.
- Configure secrets in the deployment's secret/environment settings; never commit secret values.
- Automatic tax is not enabled. Confirm tax registration and handling with the gestoría before enabling tax collection or production billing.
