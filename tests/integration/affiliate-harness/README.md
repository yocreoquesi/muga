# Affiliate Synthetic Harness — Fixtures

This directory holds the per-network fixtures consumed by
`tests/integration/affiliate-harness.test.mjs`.

For the full contract and how to add a new network, see
[`docs/affiliate-test-harness.md`](../../../docs/affiliate-test-harness.md).

Quick reference — fixture shape:

```json
{
  "network": "Display name",
  "matrix_section": "docs/affiliate-networks-matrix.md#anchor",
  "pending_resolution": "(optional) free-text reason why G1 should skip for this network — set only when there is a known design conflict between the matrix recommendation and the current codebase",
  "redirect_hosts": ["redirect1.example", "redirect2.example"],
  "redirect_url_samples": ["https://redirect1.example/click?id=1"],
  "landing_samples": [
    {
      "url": "https://merchant.example/product?attribution=x&utm_source=y",
      "expected": {
        "preserve": ["attribution"],
        "strip": ["utm_source"]
      },
      "blocked_on": "#655"
    }
  ]
}
```
