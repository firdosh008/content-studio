import { test, expect } from '@playwright/test'

test('an anonymous visitor is redirected to login', async ({ page }) => {
  await page.goto('/brands')
  await expect(page).toHaveURL(/\/login/)
})

test('the login page offers email sign-in', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByRole('button', { name: /send.*link/i })).toBeVisible()
})
