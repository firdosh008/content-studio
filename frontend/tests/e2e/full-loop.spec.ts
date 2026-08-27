import { test, expect, type Page } from '@playwright/test'
import { ADMIN_STATE, MEMBER_STATE, e2eEnv } from './global-setup'

/**
 * The full PRD §5 loop against the real stack.
 *
 * Requires: the backend (`docker compose up`) with open-design, one enabled
 * coding-agent provider, a brand named by E2E_BRAND (default "Ladder") whose
 * DESIGN.md and VOICE.md are written, and seeded users with passwords:
 *   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD   (role admin)
 *   E2E_MEMBER_EMAIL / E2E_MEMBER_PASSWORD (role member — for the role split)
 * plus NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY.
 * Without them every test here skips; auth.spec.ts still runs.
 */
const env = e2eEnv()
const BRAND = process.env.E2E_BRAND ?? 'Ladder'
const GENERATION_TIMEOUT = 300_000

test.skip(!env, 'E2E env not set (see full-loop.spec.ts header)')

async function openBrand(page: Page) {
  await page.goto('/brands')
  await page.getByRole('link', { name: BRAND, exact: true }).click()
}

async function createBriefWithDraftCopy(page: Page, brief: string, copy: string) {
  await openBrand(page)
  await page.getByRole('link', { name: 'Briefs' }).click()
  await page.getByRole('link', { name: /new brief/i }).first().click()
  await page.getByLabel('Brief', { exact: true }).fill(brief)
  await page.getByRole('button', { name: /save brief/i }).click()
  await expect(page).toHaveURL(/\/briefs\/[^/]+$/)
  await page.getByLabel('Copy', { exact: true }).fill(copy)
  await page.getByRole('button', { name: /save copy/i }).click()
  await expect(page.getByText('Draft')).toBeVisible()
  return page.url()
}

test.describe('admin full loop', () => {
  test.use({ storageState: ADMIN_STATE })

  test('a brief goes all the way to an export, surviving a reload mid-generation', async ({ page }) => {
    test.setTimeout(GENERATION_TIMEOUT + 120_000)
    await createBriefWithDraftCopy(
      page,
      'Announce the pricing change to existing customers.',
      'Prices change on 1 March. Here is what moves and why.',
    )

    // Approval is an admin right (PRD §3). Design unlocks only after it.
    await page.getByRole('button', { name: /approve copy/i }).click()
    await expect(page.getByText('Approved')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Design' })).toBeVisible()

    await page.getByLabel('Artifact').selectOption('carousel')
    await page.getByLabel('Model').selectOption({ index: 1 })
    await page.getByRole('button', { name: /^generate/i }).click()

    // A single artifact routes to its page, which owns the live progress.
    await expect(page).toHaveURL(/\/artifacts\/[^/]+$/)
    const artifactUrl = page.url()
    await expect(page.getByRole('progressbar')).toBeVisible()

    // PRD 7.1 — reload mid-generation and recover via the Artifacts list.
    await openBrand(page)
    await page.getByRole('link', { name: 'Artifacts' }).click()
    await page.getByRole('link', { name: /carousel/i }).first().click()
    await expect(page).toHaveURL(artifactUrl)

    await expect(page.getByText(/quality checks (passed|failed)/i)).toBeVisible({
      timeout: GENERATION_TIMEOUT,
    })
    await page.getByRole('button', { name: /submit for review/i }).click()
    await page.getByRole('button', { name: /^approve$/i }).click()
    await expect(page.getByText('Approved. Iterating creates a new version.')).toBeVisible()
    await expect(page.getByRole('link', { name: /download/i }).first()).toBeVisible()
  })

  test('design stays locked while the copy is a draft', async ({ page }) => {
    await createBriefWithDraftCopy(page, 'Draft only.', 'Unapproved words.')
    await expect(page.getByText('Design unlocks once the copy is approved.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Design' })).toHaveCount(0)
  })
})

test.describe('honest role split', () => {
  test.skip(!env?.member, 'E2E_MEMBER_EMAIL / E2E_MEMBER_PASSWORD not set')

  test('member creates and submits, admin approves, member exports', async ({ browser }) => {
    test.setTimeout(GENERATION_TIMEOUT + 180_000)
    const memberContext = await browser.newContext({ storageState: MEMBER_STATE })
    const adminContext = await browser.newContext({ storageState: ADMIN_STATE })
    const member = await memberContext.newPage()
    const admin = await adminContext.newPage()

    // Member: brief + hand-written copy. No approve button for a member.
    const briefUrl = await createBriefWithDraftCopy(
      member,
      'Member-authored brief for the role split.',
      'Member-written copy awaiting an admin.',
    )
    await expect(member.getByRole('button', { name: /approve copy/i })).toHaveCount(0)

    // Admin: approve the copy.
    await admin.goto(briefUrl)
    await admin.getByRole('button', { name: /approve copy/i }).click()
    await expect(admin.getByText('Approved')).toBeVisible()

    // Member: generate (open to every member), then submit for review.
    await member.reload()
    await expect(member.getByRole('region', { name: 'Design' })).toBeVisible()
    await member.getByLabel('Artifact').selectOption('carousel')
    await member.getByLabel('Model').selectOption({ index: 1 })
    await member.getByRole('button', { name: /^generate/i }).click()
    await expect(member).toHaveURL(/\/artifacts\/[^/]+$/)
    const artifactUrl = member.url()
    await expect(member.getByText(/quality checks (passed|failed)/i)).toBeVisible({
      timeout: GENERATION_TIMEOUT,
    })
    await member.getByRole('button', { name: /submit for review/i }).click()
    await expect(member.getByText('Waiting on an admin.')).toBeVisible()
    await expect(member.getByRole('button', { name: /^approve$/i })).toHaveCount(0)

    // Admin: approve the artifact.
    await admin.goto(artifactUrl)
    await admin.getByRole('button', { name: /^approve$/i }).click()
    await expect(admin.getByText('Approved. Iterating creates a new version.')).toBeVisible()

    // Member: the final export is now available.
    await member.reload()
    await expect(member.getByRole('link', { name: /download/i }).first()).toBeVisible()
    await expect(member.getByText(/working exports/i)).toHaveCount(0)

    await memberContext.close()
    await adminContext.close()
  })
})
