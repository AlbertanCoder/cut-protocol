// Regression for the QC gauntlet v2 SSRF finding (2026-07-23): the recipe-URL
// importer validated protocol but not the host, so it would fetch loopback /
// link-local / private-network addresses. isBlockedHost now refuses them before
// any fetch. Pure — no network.
const test = require("node:test");
const assert = require("node:assert");
const { isBlockedHost } = require("../../src/lib/recipeImporter.js");

test("SSRF guard blocks loopback / link-local / private hosts", () => {
  for (const h of ["localhost", "127.0.0.1", "127.1.2.3", "0.0.0.0", "169.254.169.254", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "::1", "fd00::1", "fe80::1", "app.localhost"]) {
    assert.equal(isBlockedHost(h), true, `${h} should be blocked`);
  }
});

test("SSRF guard allows real public recipe hosts", () => {
  for (const h of ["www.budgetbytes.com", "cooking.nytimes.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.167.0.1", "203.0.113.10"]) {
    assert.equal(isBlockedHost(h), false, `${h} should be allowed`);
  }
});
