/**
 * LIVE SUPABASE TEST — RLS verification against the real banhao-dev project.
 *
 * This is NOT the plain-PostgreSQL shim in supabase/tests/rls_profiles_test.sql.
 * It signs in through real Supabase Auth with the anon key, exactly as the
 * mobile app does, and then attempts the operations a hostile client would.
 *
 *   node supabase/tests/live-rls-check.mjs
 *
 * Requires apps/customer/.env (gitignored) with EXPO_PUBLIC_SUPABASE_URL and
 * EXPO_PUBLIC_SUPABASE_ANON_KEY. Uses the Test OTP numbers configured on the
 * dev project — no SMS is sent and no session is faked.
 *
 * Exits non-zero if any expectation fails.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// This script lives outside any package, and ESM resolves bare specifiers from
// the importing file's location — so resolve the SDK from apps/customer, which
// is the workspace that actually depends on it.
const require = createRequire(new URL('../../apps/customer/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(
  readFileSync(new URL('../../apps/customer/.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// Both numbers are configured as Supabase Test OTP entries on banhao-dev.
const USER_A = { phone: '+66812345678', token: '123456' };
const USER_B = { phone: '+66899999999', token: '654321' };

let failures = 0;

function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures++;
}

/** Signs in via real Supabase Auth. Never fabricates a session. */
async function signIn({ phone, token }) {
  const client = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: otpErr } = await client.auth.signInWithOtp({ phone });
  if (otpErr) throw new Error(`signInWithOtp failed: ${otpErr.message}`);

  const { data, error } = await client.auth.verifyOtp({ phone, token, type: 'sms' });
  if (error) throw new Error(`verifyOtp failed: ${error.message}`);
  return { client, userId: data.user.id };
}

console.log('\n=== LIVE SUPABASE TEST — banhao-dev ===\n');

const a = await signIn(USER_A);
const b = await signIn(USER_B);

check('Auth: real session established for user A', !!a.userId, a.userId);
check('Auth: real session established for user B', !!b.userId);

// --- profile creation trigger --------------------------------------------
const { data: ownProfile } = await a.client
  .from('profiles')
  .select('id, role, phone, display_name')
  .eq('id', a.userId)
  .maybeSingle();

check('Profile row auto-created by trigger', !!ownProfile);
check('profiles.id matches auth.users.id', ownProfile?.id === a.userId);
check('Role defaults to CUSTOMER', ownProfile?.role === 'CUSTOMER', String(ownProfile?.role));

// --- read isolation -------------------------------------------------------
const { data: otherProfile } = await a.client
  .from('profiles')
  .select('id')
  .eq('id', b.userId)
  .maybeSingle();

check("Customer cannot read another customer's profile", otherProfile === null);

const { data: allRows } = await a.client.from('profiles').select('id');
check('Unfiltered select returns only own row', allRows?.length === 1, `${allRows?.length} row(s)`);

// --- writes that must be rejected ----------------------------------------
const roleAttempt = await a.client.from('profiles').update({ role: 'ADMIN' }).eq('id', a.userId);
const { data: afterRole } = await a.client
  .from('profiles')
  .select('role')
  .eq('id', a.userId)
  .maybeSingle();
check(
  'Customer cannot escalate own role',
  afterRole?.role === 'CUSTOMER',
  roleAttempt.error ? `rejected: ${roleAttempt.error.code}` : `role still ${afterRole?.role}`,
);

const phoneAttempt = await a.client
  .from('profiles')
  .update({ phone: '+66800000000' })
  .eq('id', a.userId);
const { data: afterPhone } = await a.client
  .from('profiles')
  .select('phone')
  .eq('id', a.userId)
  .maybeSingle();
check(
  'Customer cannot change protected phone field',
  afterPhone?.phone !== '+66800000000',
  phoneAttempt.error ? `rejected: ${phoneAttempt.error.code}` : `phone ${afterPhone?.phone}`,
);

const idAttempt = await a.client
  .from('profiles')
  .update({ id: '00000000-0000-0000-0000-000000000000' })
  .eq('id', a.userId);
check('Customer cannot change id', !!idAttempt.error, idAttempt.error?.code);

const insertAttempt = await a.client
  .from('profiles')
  .insert({ id: '11111111-1111-1111-1111-111111111111', role: 'ADMIN' });
check('Customer cannot insert a fabricated profile', !!insertAttempt.error, insertAttempt.error?.code);

await a.client.from('profiles').delete().eq('id', a.userId);
const { data: afterDelete } = await a.client
  .from('profiles')
  .select('id')
  .eq('id', a.userId)
  .maybeSingle();
check('Customer cannot delete own profile', !!afterDelete);

// --- the one write that must succeed -------------------------------------
const newName = `QA ${Date.now()}`;
const nameAttempt = await a.client
  .from('profiles')
  .update({ display_name: newName })
  .eq('id', a.userId);
const { data: afterName } = await a.client
  .from('profiles')
  .select('display_name')
  .eq('id', a.userId)
  .maybeSingle();
check(
  'Customer CAN update own display_name',
  afterName?.display_name === newName,
  nameAttempt.error ? nameAttempt.error.message : 'updated',
);

// --- anon (signed out) ----------------------------------------------------
const anonClient = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: anonRows } = await anonClient.from('profiles').select('id');
check('Signed-out client reads no profiles', !anonRows || anonRows.length === 0);

await a.client.auth.signOut();
await b.client.auth.signOut();

console.log(`\n${failures === 0 ? 'ALL LIVE RLS CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
