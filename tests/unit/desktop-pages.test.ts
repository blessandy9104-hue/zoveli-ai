import { describe, expect, it } from 'vitest';
import { renderHomePage, renderLoginPage } from '../../apps/desktop/src/server/pages';

describe('desktop pages', () => {
  it('renders the chat shell with startup onboarding markup', () => {
    const page = renderHomePage({
      status: '<p data-testid="onboarding-status">ready</p>',
      panel: '<section data-testid="onboarding">setup</section>',
    });

    expect(page).toContain('<!doctype html>');
    expect(page).toContain('data-testid="chat-log"');
    expect(page).toContain('id="composer"');
    expect(page).toContain('data-testid="onboarding-status"');
    expect(page).toContain('data-testid="onboarding"');
    expect(page).toContain('/vendor/lenis.min.js');
    expect(page).toContain('data-testid="theme-switcher"');
  });

  it('renders and caches the login page', () => {
    const page = renderLoginPage();
    expect(renderLoginPage()).toBe(page);
    expect(page).toContain('<title>Zoveli AI — log in</title>');
    expect(page).toContain('data-testid="login-email"');
    expect(page).toContain('data-testid="login-code"');
    expect(page).toContain('/vendor/lenis.min.js');
    expect(page).toContain('data-testid="theme-switcher"');
  });
});
