import { expect, test } from "@playwright/test";

const masterAdmin = {
  email: process.env.E2E_MASTER_ADMIN_EMAIL || "admin@xandora.local",
  password: process.env.E2E_MASTER_ADMIN_PASSWORD || "ChangeMe!123",
};

const companyAdmin = {
  email: process.env.E2E_COMPANY_ADMIN_EMAIL || "ops@northline-retail.local",
  password: process.env.E2E_COMPANY_ADMIN_PASSWORD || "ChangeMe!123",
};

async function loginToWorkspace(page, { workspaceLabel, email, password }) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(workspaceLabel, "i") }).first().click();
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: new RegExp(`Open ${workspaceLabel}`, "i") }).click();
}

test("master admin can open the admin portal overview", async ({ page }) => {
  await loginToWorkspace(page, {
    workspaceLabel: "Xandora Admin Portal",
    email: masterAdmin.email,
    password: masterAdmin.password,
  });

  await page.waitForURL(/\/admin$/);
  await expect(page.getByText("Master Overview")).toBeVisible();
  await expect(page.getByText("Customer Companies")).toBeVisible();
  await expect(page.getByText("Customers", { exact: true })).toBeVisible();
});

test("company admin can open billing and stock workspaces", async ({ page }) => {
  await loginToWorkspace(page, {
    workspaceLabel: "Xandora Retail",
    email: companyAdmin.email,
    password: companyAdmin.password,
  });

  await expect(page.getByText("Overview").first()).toBeVisible();

  await page.goto("/billing");
  await expect(page.getByText("Live POS validation control")).toBeVisible();
  await expect(page.getByText("Billing History", { exact: true })).toBeVisible();

  await page.goto("/stock");
  await expect(page.getByRole("heading", { name: /^Stock$/i })).toBeVisible();
  await expect(page.getByText("Stock visibility stays in Retail.")).toBeVisible();

  await page.goto("/inventory");
  await page.waitForURL(/\/stock$/);
  await expect(page.getByRole("heading", { name: /^Stock$/i })).toBeVisible();
});
