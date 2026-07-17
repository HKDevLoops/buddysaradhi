import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

// A simple placeholder component test to verify vitest is working
const SimpleComponent = () => <div>Hello Buddysaradhi</div>;

describe('SimpleComponent', () => {
  it('renders correctly', () => {
    render(<SimpleComponent />);
    expect(screen.getByText('Hello Buddysaradhi')).toBeInTheDocument();
  });
});
