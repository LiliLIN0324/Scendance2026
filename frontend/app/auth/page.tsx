'use client';

import { useRouter } from 'next/navigation';
import { IntroPage } from '@/components/intro/intro-page';
import { safeReturnPath, useAuth } from '@/lib/auth-provider';

export default function AuthPage(): JSX.Element {
  const { controller, ready, error } = useAuth()!;
  const router = useRouter();

  function enterWorkspace(): void {
    router.replace(safeReturnPath(new URLSearchParams(window.location.search).get('next')));
  }

  const demoEmail = process.env.NEXT_PUBLIC_DEMO_EMAIL?.trim() ?? '';
  const demoPassword = process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? '';
  const demoAccount = demoEmail && demoPassword ? { email: demoEmail, password: demoPassword } : undefined;

  return <IntroPage controller={controller} ready={ready} authError={error} demoAccount={demoAccount} onEnter={() => router.push('/?local=1')} onAuthenticated={enterWorkspace} />;
}
