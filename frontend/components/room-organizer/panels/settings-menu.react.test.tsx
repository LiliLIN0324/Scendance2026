// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AboutDialog } from './about-dialog';

afterEach(cleanup);

it('copies the injected build identity and does not invent a version', async () => {
  vi.stubEnv('NEXT_PUBLIC_SCENDANCE_VERSION', '9.9.9-test');
  vi.stubEnv('NEXT_PUBLIC_SCENDANCE_COMMIT', 'abc123def456');
  const write = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: write } });
  render(<AboutDialog open onClose={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /复制版本信息/ }));
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith('Scendance 9.9.9-test\n提交 abc123def456'));
  expect(screen.queryByText('4.17.12')).toBeNull();
  vi.unstubAllEnvs();
});
