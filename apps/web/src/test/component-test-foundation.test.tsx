import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

function InteractiveExample() {
  const [enabled, setEnabled] = useState(false);

  return <button onClick={() => setEnabled(true)}>{enabled ? 'Enabled' : 'Enable'}</button>;
}

describe('component test foundation', () => {
  it('renders a component and handles a real user interaction', async () => {
    const user = userEvent.setup();
    render(<InteractiveExample />);

    await user.click(screen.getByRole('button', { name: 'Enable' }));

    expect(screen.getByRole('button', { name: 'Enabled' })).toBeInTheDocument();
  });
});
