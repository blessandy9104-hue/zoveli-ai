import { test, expect } from '@playwright/test';

test.describe('Web accessibility', () => {
  test('exposes landmarks, labels, live regions, and a skip link', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Zoveli AI' })).toBeVisible();
    await expect(page.getByRole('log', { name: 'Conversation' })).toHaveAttribute(
      'aria-live',
      'polite'
    );
    await expect(page.getByLabel('Message')).toHaveAttribute('data-testid', 'chat-input');
    await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Interface theme' })).toBeVisible();
    await expect(page.getByTestId('theme-option-daylight')).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await expect(page.getByTestId('tools-list')).toHaveAttribute('aria-busy', 'false');

    const skip = page.getByRole('link', { name: 'Skip to chat' });
    await skip.focus();
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await skip.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('reports a failed request, restores the composer, and does not persist the error', async ({
    page,
  }) => {
    await page.goto('/');
    await page.route('**/api/chat', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.abort();
    });

    await page.getByLabel('Message').fill('hello');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('send-button')).toBeDisabled();
    await expect(page.getByTestId('assistant-message').last()).toContainText(
      'could not reach the local server'
    );
    await expect(page.getByTestId('send-button')).toBeEnabled();
    await expect(page.getByTestId('send-button')).toHaveText('Send');
    await expect(page.getByLabel('Message')).toBeFocused();

    await page.reload();
    await expect(page.getByTestId('assistant-message')).toHaveCount(0);
    await expect(page.getByTestId('user-message').last()).toContainText('hello');
  });

  test('restores verified badges from local history and announces clearing', async ({ page }) => {
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          reply: 'hello back',
          verified: true,
          model: 'test-model',
          local: true,
        }),
      })
    );
    await page.goto('/');
    await page.getByLabel('Message').fill('hi');
    await page.getByTestId('send-button').click();
    await expect(page.getByTestId('assistant-message').last()).toContainText('hello back');

    await page.reload();
    await expect(page.getByTestId('verification-badge')).toHaveCount(1);
    await expect(page.getByTestId('reply-meta')).toContainText('via test-model');

    await page.getByTestId('chat-clear').click();
    await expect(page.locator('#chat-status')).toHaveText('Chat history cleared.');
    await expect(page.getByTestId('user-message')).toHaveCount(0);
    await expect(page.getByLabel('Message')).toBeFocused();
  });

  test('theme changes update native color scheme and are announced', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('theme-option-midnight').click();
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
    await expect(page.locator('#theme-status')).toHaveText('Theme: Midnight');

    await page.getByTestId('theme-option-daylight').click();
    await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
    await expect(page.locator('#theme-status')).toHaveText('Theme: Daylight');
  });

  test('reduced motion skips smooth scroll and the animated backdrop', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.locator('html')).not.toHaveClass(/lenis/);

    await page.getByTestId('theme-option-unicorn').click();
    await expect(page.locator('html')).toHaveClass(/us-fallback/);
    expect(await page.evaluate(() => document.getElementById('us-sdk'))).toBeNull();
  });

  test('login form is labeled, announces progress, and focuses the code field', async ({
    page,
  }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email address')).toHaveAttribute('autocomplete', 'email');
    await expect(page.getByTestId('login-status')).toHaveAttribute('role', 'status');
    await expect(page.getByLabel('6-digit login code')).toHaveAttribute(
      'autocomplete',
      'one-time-code'
    );

    await page.getByLabel('Email address').fill(`a11y-${Date.now()}@proton.me`);
    await page.getByTestId('login-send').click();
    await expect(page.getByTestId('login-status')).toContainText('Code sent');
    await expect(page.getByLabel('6-digit login code')).toBeFocused();
  });
});
