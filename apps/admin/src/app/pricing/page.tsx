'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DELIVERY_FEE_MAX_SATANG,
  DELIVERY_FEE_MIN_SATANG,
  deliveryFeeSettingRequestSchema,
  previewDeliveryFee,
  type DeliveryFeeSetting,
  type DeliveryFeeSettingsResponse,
} from '@banhao/validation';
import { ConsoleShell } from '../../components/ConsoleShell';
import { pricingRepository } from '../../repositories/pricing';
import { useStaff } from '../../hooks/useStaff';
import { copy } from '../../lib/copy';
import * as styles from '../../lib/styles';

/**
 * DEC-070 §2 / DEC-071 — the delivery fee, set from the back office.
 *
 * No design artifact exists for this screen; it is a plain form in the
 * console's existing style. Every value is checked twice: here, to show the
 * admin what a setting means before saving, and by the API, which refuses
 * anything outside ฿15–35 and anyone who is not ADMIN. The preview shows, at
 * ฿50 / ฿100 / ฿300 of food, what the customer pays for delivery, what the
 * rider earns (80%, at least ฿12) and what BANHAO keeps — never a negative
 * number, because the band makes a loss impossible.
 */
const PREVIEW_SUBTOTALS = [5000, 10000, 30000];

function baht(satang: number): string {
  const value = satang / 100;
  return `฿${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function toSatang(input: string): number | null {
  if (input.trim() === '') return null;
  const value = Number(input);
  return Number.isFinite(value) ? Math.round(value * 100) : Number.NaN;
}

function describe(setting: DeliveryFeeSetting): string {
  if (setting.mode === 'FIXED') return `คงที่ ${baht(setting.fixedSatang)}`;
  const parts = [`${setting.percentBasisPoints / 100}% ของค่าอาหาร`];
  if (setting.minSatang !== null) parts.push(`ขั้นต่ำ ${baht(setting.minSatang)}`);
  if (setting.maxSatang !== null) parts.push(`สูงสุด ${baht(setting.maxSatang)}`);
  return parts.join(' · ');
}

function Pricing() {
  const { identity } = useStaff();
  const isAdmin = identity?.staffRole === 'ADMIN';

  const [data, setData] = useState<DeliveryFeeSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [fixedBaht, setFixedBaht] = useState('15');
  const [percent, setPercent] = useState('8');
  const [minBaht, setMinBaht] = useState('');
  const [maxBaht, setMaxBaht] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setLoadError(null);
    pricingRepository
      .deliveryFee()
      .then(setData)
      .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : copy.errorTitle));
  }, []);

  useEffect(load, [load]);

  const draft = useMemo(() => {
    const body =
      mode === 'FIXED'
        ? { mode, fixedSatang: toSatang(fixedBaht), reason }
        : {
            mode,
            percentBasisPoints: Math.round(Number(percent) * 100),
            minSatang: toSatang(minBaht),
            maxSatang: toSatang(maxBaht),
            reason,
          };
    return deliveryFeeSettingRequestSchema.safeParse(body);
  }, [mode, fixedBaht, percent, minBaht, maxBaht, reason]);

  const draftPreview = useMemo(() => {
    if (!draft.success) return null;
    const { reason: _reason, ...setting } = draft.data;
    return previewDeliveryFee(setting as DeliveryFeeSetting, PREVIEW_SUBTOTALS);
  }, [draft]);

  async function save() {
    if (!draft.success) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      setData(await pricingRepository.setDeliveryFee(draft.data));
      setReason('');
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : copy.errorTitle);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div style={styles.panel}>
        <p style={styles.errorText}>{loadError}</p>
        <button type="button" style={styles.ghostButton} onClick={load}>
          {copy.retry}
        </button>
      </div>
    );
  }
  if (!data) return <p style={styles.subtitle}>{copy.loading}</p>;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={styles.title}>ค่าส่ง</h1>

      <section style={styles.panel} data-testid="delivery-fee-current">
        <h2 style={styles.sectionTitle}>ค่าที่ใช้อยู่ตอนนี้</h2>
        <p style={{ fontSize: 18, fontWeight: 700, margin: '8px 0' }}>{describe(data.current)}</p>
        <p style={styles.meta}>
          ค่าส่งอยู่ระหว่าง {baht(data.bounds.minSatang)}–{baht(data.bounds.maxSatang)} เสมอ · ไรเดอร์ได้{' '}
          {data.bounds.riderShareBasisPoints / 100}% ของค่าส่ง ขั้นต่ำ {baht(data.bounds.riderFloorSatang)} ·
          ออเดอร์ที่สร้างแล้วไม่เปลี่ยน
        </p>
        <PreviewTable rows={data.preview} testId="delivery-fee-current-preview" />
      </section>

      {isAdmin ? (
        <section style={styles.panel} data-testid="delivery-fee-form">
          <h2 style={styles.sectionTitle}>เปลี่ยนค่าส่ง</h2>
          <div style={{ display: 'flex', gap: 16, margin: '12px 0' }}>
            <label style={styles.label}>
              <input type="radio" checked={mode === 'FIXED'} onChange={() => setMode('FIXED')} /> คงที่
            </label>
            <label style={styles.label}>
              <input type="radio" checked={mode === 'PERCENT'} onChange={() => setMode('PERCENT')} /> เปอร์เซ็นต์ของค่าอาหาร
            </label>
          </div>

          {mode === 'FIXED' ? (
            <label style={styles.label}>
              ค่าส่ง (บาท, {DELIVERY_FEE_MIN_SATANG / 100}–{DELIVERY_FEE_MAX_SATANG / 100})
              <input
                style={styles.input}
                inputMode="decimal"
                value={fixedBaht}
                onChange={(e) => setFixedBaht(e.target.value)}
                data-testid="input-fixed"
              />
            </label>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={styles.label}>
                เปอร์เซ็นต์ของค่าอาหาร
                <input style={styles.input} inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} data-testid="input-percent" />
              </label>
              <label style={styles.label}>
                ขั้นต่ำ (บาท, ไม่ใส่ได้)
                <input style={styles.input} inputMode="decimal" value={minBaht} onChange={(e) => setMinBaht(e.target.value)} data-testid="input-min" />
              </label>
              <label style={styles.label}>
                สูงสุด (บาท, ไม่ใส่ได้)
                <input style={styles.input} inputMode="decimal" value={maxBaht} onChange={(e) => setMaxBaht(e.target.value)} data-testid="input-max" />
              </label>
            </div>
          )}

          <label style={{ ...styles.label, display: 'block', marginTop: 8 }}>
            เหตุผล
            <textarea style={styles.textarea} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-reason" />
          </label>

          {draftPreview ? (
            <>
              <p style={{ ...styles.meta, marginTop: 8 }}>ถ้าบันทึกค่านี้:</p>
              <PreviewTable rows={draftPreview} testId="delivery-fee-draft-preview" />
            </>
          ) : (
            <p style={styles.errorText} data-testid="delivery-fee-invalid">
              ค่าไม่ถูกต้อง: ค่าส่งต้องอยู่ระหว่าง ฿15–35 และต้องใส่เหตุผล
            </p>
          )}

          {saveError ? <p style={styles.errorText}>{saveError}</p> : null}
          {saved ? <p style={styles.meta} data-testid="delivery-fee-saved">บันทึกแล้ว ใช้กับออเดอร์ใหม่ตั้งแต่ตอนนี้</p> : null}

          <button
            type="button"
            style={{ ...styles.button(!draft.success || saving), marginTop: 12 }}
            disabled={!draft.success || saving}
            onClick={() => void save()}
            data-testid="button-save-delivery-fee"
          >
            {saving ? 'กำลังบันทึก' : 'บันทึกค่าส่งใหม่'}
          </button>
        </section>
      ) : (
        <p style={styles.meta} data-testid="delivery-fee-read-only">
          เฉพาะ ADMIN เท่านั้นที่เปลี่ยนค่าส่งได้
        </p>
      )}

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>ประวัติการเปลี่ยน</h2>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>เมื่อ</th>
              <th style={styles.th}>ค่า</th>
              <th style={styles.th}>เหตุผล</th>
            </tr>
          </thead>
          <tbody>
            {data.history.map((row) => (
              <tr key={row.id}>
                <td style={styles.td}>{new Date(row.createdAt).toLocaleString('th-TH')}</td>
                <td style={styles.td}>{describe(row)}</td>
                <td style={styles.td}>{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function PreviewTable({
  rows,
  testId,
}: {
  rows: { foodSubtotalSatang: number; deliveryFeeSatang: number; riderEarningSatang: number; banhaoDeliveryMarginSatang: number }[];
  testId: string;
}) {
  return (
    <table style={styles.table} data-testid={testId}>
      <thead>
        <tr>
          <th style={styles.th}>ค่าอาหาร</th>
          <th style={styles.th}>ค่าส่ง (ลูกค้าจ่าย)</th>
          <th style={styles.th}>ไรเดอร์ได้</th>
          <th style={styles.th}>BANHAO เหลือจากค่าส่ง</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.foodSubtotalSatang}>
            <td style={styles.td}>{baht(row.foodSubtotalSatang)}</td>
            <td style={styles.td}>{baht(row.deliveryFeeSatang)}</td>
            <td style={styles.td}>{baht(row.riderEarningSatang)}</td>
            <td style={styles.td}>{baht(row.banhaoDeliveryMarginSatang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PricingPage() {
  return (
    <ConsoleShell>
      <Pricing />
    </ConsoleShell>
  );
}
