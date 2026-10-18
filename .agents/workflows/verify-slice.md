# Antigravity Workflow: Verify Veract Slice

This workflow validates tests and the PayPal Sandbox integration smoke test.

## Steps

1. **Run Unit & Verifier Tests:**
   ```bash
   npx vitest run
   ```

2. **Run PayPal Sandbox Smoke Test (when credentials are set in .env):**
   ```bash
   npx tsx scripts/verify-paypal-sandbox.ts
   ```
