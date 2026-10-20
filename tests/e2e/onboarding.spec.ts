import { test, expect } from '@playwright/test';

test.describe('First-run onboarding', () => {
  test('reports readiness and matches the visible status', async ({ page }) => {
    const res = await page.request.get('/api/onboarding');
    expect(res.ok()).toBeTruthy();
    const state = await res.json();
    expect(typeof state.chat.ready).toBe('boolean');
    expect(typeof state.math.ready).toBe('boolean');
    expect(state.tools).toBeGreaterThan(20);

    await page.goto('/');
    const status = page.locator('[data-testid="onboarding-status"]');
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute('data-chat-ready', String(state.chat.ready));
    await expect(status).toHaveAttribute('data-math-ready', String(state.math.ready));

    const setup = page.locator('[data-testid="onboarding"]');
    if (state.chat.ready && state.math.ready) {
      await expect(setup).toHaveCount(0);
    } else {
      await expect(setup).toBeVisible();
      if (!state.chat.ready) {
        await expect(setup).toContainText('ollama pull qwen3:4b');
      }
      if (!state.math.ready) {
        await expect(setup).toContainText('python -m pip install -e ./mathcore');
      }
    }
  });

  test('shows a setup reply without persisting it to local history', async ({ page }) => {
    await page.route('**/api/chat', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          verified: false,
          setup: true,
          reply: 'Chat is not configured yet. Local tools still work.',
        }),
      })
    );
    await page.goto('/');
    await page.fill('[data-testid="chat-input"]', 'hello');
    await page.click('[data-testid="send-button"]');
    await expect(page.locator('[data-testid="assistant-message"]').last()).toContainText(
      'not configured'
    );
    await expect(page.locator('#chat-status')).toContainText(
      'Chat model not configured'
    );
    await page.reload();
    await expect(page.locator('[data-testid="user-message"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="assistant-message"]')).toHaveCount(0);
  });
});
