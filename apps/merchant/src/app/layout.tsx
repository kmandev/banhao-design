import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '../hooks/useAuth';

export const metadata: Metadata = {
  title: 'BANHAO Merchant',
  description: 'BANHAO | บ้านเฮา — merchant order management',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
