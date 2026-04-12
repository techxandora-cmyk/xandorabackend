import { expect, test } from "@playwright/test";

const demoUser = {
  email: process.env.DEMO_ADMIN_EMAIL || "demo.ops@xandora.local",
  password: process.env.DEMO_ADMIN_PASSWORD || "DemoPass!123",
};

async function loginToWorkspace(page, { workspaceLabel, email, password, waitFor }) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(workspaceLabel, "i") }).first().click();
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: new RegExp(`Open ${workspaceLabel}`, "i") }).click();
  if (waitFor) {
    await page.waitForURL(waitFor);
  }
}

test("demo operator can open retail pages", async ({ page }) => {
  await loginToWorkspace(page, {
    workspaceLabel: "Xandora Retail",
    email: demoUser.email,
    password: demoUser.password,
    waitFor: /\/$/,
  });

  await expect(page.getByText("Overview").first()).toBeVisible();

  await page.goto("/billing");
  await expect(page.getByText("Billing").first()).toBeVisible();
  await expect(page.getByText("Billing History", { exact: true })).toBeVisible();

  await page.goto("/stock");
  await expect(page.getByRole("heading", { name: /^Stock$/i })).toBeVisible();
  await expect(page.getByText("Stock visibility stays in Retail.")).toBeVisible();

  await page.goto("/inventory");
  await page.waitForURL(/\/stock$/);
  await expect(page.getByRole("heading", { name: /^Stock$/i })).toBeVisible();
});

test("demo operator can open laundry pages", async ({ page }) => {
  await loginToWorkspace(page, {
    workspaceLabel: "Xandora Laundry",
    email: demoUser.email,
    password: demoUser.password,
    waitFor: /\/laundry$/,
  });

  await expect(page.getByRole("heading", { name: /Fabric lifecycle control without the clutter/i })).toBeVisible();
  await expect(page.getByText("Dashboard", { exact: true })).toBeVisible();

  await page.goto("/laundry/inbound");
  await expect(page.getByText("Inbound Scanner")).toBeVisible();

  await page.goto("/laundry/outbound");
  await expect(page.getByText("Outbound Scanner")).toBeVisible();

  await page.goto("/laundry/data-entry");
  await expect(page.getByText("Build the fabric master directly inside Xandora.")).toBeVisible();
});

test("demo operator can open stock audit pages", async ({ page }) => {
  await loginToWorkspace(page, {
    workspaceLabel: "Xandora Stock Audit",
    email: demoUser.email,
    password: demoUser.password,
    waitFor: /\/stock-audit$/,
  });

  await expect(page.getByRole("heading", { name: /Audit-ready stock visibility without the noise/i })).toBeVisible();
  await expect(page.getByText("Count control")).toBeVisible();

  await page.goto("/stock-audit/sessions");
  await expect(page.getByText("Start, monitor, and close stock audit sessions cleanly.")).toBeVisible();

  await page.goto("/stock-audit/findings");
  await expect(page.getByText("Review scanned items, discrepancies, and priority follow-up.")).toBeVisible();
});
