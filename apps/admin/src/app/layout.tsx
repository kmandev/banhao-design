import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '../hooks/useAuth';

export const metadata: Metadata = {
  title: 'BANHAO Admin',
  description: 'BANHAO | บ้านเฮา — ศูนย์ควบคุมโดยมนุษย์',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      {/* line-height 1.6 is a Thai typography requirement, not a preference —
          Admin design package § 15. */}
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
