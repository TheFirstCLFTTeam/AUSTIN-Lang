import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import LoginPage from '../app/login/page';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  usePathname: () => '/login',
}));

// Mock the login API
vi.mock('../services/api', () => ({
  login: vi.fn(),
}));

import { login } from '../services/api';

function renderLoginPage() {
  return render(<LoginPage />);
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- Rendering ---

  it('renders the logo', () => {
    renderLoginPage();
    const logo = screen.getByAltText('CLFT');
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute('src', '/logo.png');
  });

  it('renders the sign-in heading', () => {
    renderLoginPage();
    expect(
      screen.getByRole('heading', { name: /sign in to your account/i }),
    ).toBeInTheDocument();
  });

  it('renders email and password fields', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it('renders the sign in button', () => {
    renderLoginPage();
    expect(
      screen.getByRole('button', { name: /^sign in$/i }),
    ).toBeInTheDocument();
  });

  it('renders remember me checkbox', () => {
    renderLoginPage();
    expect(screen.getByLabelText(/remember me/i)).toBeInTheDocument();
  });

  it('renders forgot password link', () => {
    renderLoginPage();
    expect(
      screen.getByRole('button', { name: /forgot password/i }),
    ).toBeInTheDocument();
  });

  it('renders SSO buttons', () => {
    renderLoginPage();
    expect(
      screen.getByRole('button', { name: /sign in with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign in with passkey/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /sign in with sso/i }),
    ).toBeInTheDocument();
  });

  it('renders the create account link', () => {
    renderLoginPage();
    expect(screen.getByText(/new to austin-lang/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create account/i }),
    ).toBeInTheDocument();
  });

  // --- Interaction ---

  it('updates email and password inputs on change', () => {
    renderLoginPage();
    const emailInput = screen.getByLabelText(/email/i);
    const passwordInput = screen.getByLabelText(/^password$/i);

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'secret123' } });

    expect(emailInput).toHaveValue('test@example.com');
    expect(passwordInput).toHaveValue('secret123');
  });

  it('toggles the remember me checkbox', () => {
    renderLoginPage();
    const checkbox = screen.getByLabelText(/remember me/i);
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  // --- Form Submission ---

  it('calls login and navigates on successful submission', async () => {
    login.mockResolvedValueOnce({ token: 'abc', user: { id: '1' } });
    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith('test@example.com', 'password123');
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/');
    });
  });

  it('displays an error message on login failure', async () => {
    login.mockRejectedValueOnce(new Error('Invalid email or password'));
    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'wrong@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'badpassword' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('displays fallback error when error has no message', async () => {
    login.mockRejectedValueOnce({});
    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText(/login failed/i)).toBeInTheDocument();
    });
  });

  it('clears previous error on new submission attempt', async () => {
    login.mockRejectedValueOnce(new Error('Invalid email or password'));
    renderLoginPage();

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.getByText(/invalid email or password/i)).toBeInTheDocument();
    });

    login.mockResolvedValueOnce({ token: 'abc', user: { id: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/invalid email or password/i)).not.toBeInTheDocument();
    });
  });

  // --- Design System ---

  it('applies 0px border-radius to the login card (no rounding)', () => {
    const { container } = renderLoginPage();
    const card = container.querySelector('[class*="max-w"]');
    expect(card.style.borderRadius).toBe('0px');
  });

  it('uses the wallpaper background image', () => {
    const { container } = renderLoginPage();
    const bg = container.firstChild;
    expect(bg.style.backgroundImage).toContain('login_wallpaper.webp');
  });
});
