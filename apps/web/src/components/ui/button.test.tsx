import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { Button } from './button';

test('renders a button with text', () => {
  render(<Button>Click Me</Button>);
  
  const button = screen.getByRole('button', { name: /click me/i });
  expect(button).toBeInTheDocument();
  expect(button).toHaveClass('inline-flex'); // Tailwind class from standard Shadcn UI button
});
