'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PayoutHistoryRow, SettlementReportResponse } from '@banhao/validation';
import { ConsoleShell } from '../../components/ConsoleShell';
import { settlementRepository } from '../../repositories/settlement';
import { useStaff } from '../../hooks/useStaff';
import { copy } from '../../lib/copy';
import * as styles from '../../lib/styles';
import { previousMonday } from '../../lib/week';

/**
 * DEC-073 — pilot settlement: what each restaurant and rider is owed for a
 * week, a CSV for the bank, and a record of each manual transfer.
 *
 * No design artifact exists; plain tables in the console's style (DEC-070 Q5).
 * Amounts shown here are a display: recording sends only the item ids, and the
 * database recomputes every amount and refuses anything already paid.
 */
function baht(satang: number): string {
  const value = satang / 100;
  return `฿${Number.isInteger(value) ? value.toLocaleString('th-TH') : value.toFixed(2)}`;
}

function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(`${weekStart}T00:00:00Z`);
  return new Date(d.getTime() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function todayBangkok(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function csvFor(report: SettlementReportResponse): string {
  const rows: string[][] = [['ประเภท', 'ชื่อ', 'จำนวนรายการ', 'ยอดโอน (บาท)']];
  for (const m of report.merchants) rows.push(['ร้าน', m.name, String(m.lines.length), (m.totalSatang / 100).toFixed(2)]);
  for (const r of report.riders) rows.push(['ไรเดอร์', r.name, String(r.lines.length), (r.totalSatang / 100).toFixed(2)]);
  return rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
}

interface Party {
  partyType: 'MERCHANT' | 'RIDER';
  partyId: string;
  name: string;
  totalSatang: number;
  itemIds: string[];
  count: number;
  carried: number;
}

function Payouts() {
  const { identity } = useStaff();
  const isAdmin = identity?.staffRole === 'ADMIN';
  const [week, setWeek] = useState(previousMonday());
  const [report, setReport] = useState<SettlementReportResponse | null>(null);
  const [history, setHistory] = useState<PayoutHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Party | null>(null);
  const [paidOn, setPaidOn] = useState(todayBangkok());
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([settlementRepository.report(week), settlementRepository.history()])
      .then(([r, h]) => {
        setReport(r);
        setHistory(h);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : copy.errorTitle));
  }, [week]);

  useEffect(load, [load]);

  const parties: Party[] = report
    ? [
        ...report.merchants.map((m) => ({
          partyType: 'MERCHANT' as const,
          partyId: m.merchantId,
          name: m.name,
          totalSatang: m.totalSatang,
          itemIds: m.lines.map((l) => l.orderId),
          count: m.lines.length,
          carried: m.lines.filter((l) => l.carriedOver).length,
        })),
        ...report.riders.map((r) => ({
          partyType: 'RIDER' as const,
          partyId: r.riderId,
          name: r.name,
          totalSatang: r.totalSatang,
          itemIds: r.lines.map((l) => l.deliveryId),
          count: r.lines.length,
          carried: r.lines.filter((l) => l.carriedOver).length,
        })),
      ]
    : [];

  async function confirmTransfer() {
    if (!recording || reference.trim() === '') return;
    setSaving(true);
    setSaveError(null);
    try {
      await settlementRepository.record({
        partyType: recording.partyType,
        partyId: recording.partyId,
        weekStart: week,
        itemIds: recording.itemIds,
        paidOn,
        bankReference: reference.trim(),
      });
      setRecording(null);
      setReference('');
      load();
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : copy.errorTitle);
    } finally {
      setSaving(false);
    }
  }

  async function voidRow(row: PayoutHistoryRow) {
    const reason = window.prompt(`ยกเลิกบันทึกการโอน ${baht(row.totalSatang)} ให้ ${row.partyName}\nเหตุผล:`);
    if (!reason || reason.trim() === '') return;
    try {
      await settlementRepository.void(row.id, reason.trim());
      load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.errorTitle);
    }
  }

  function downloadCsv() {
    if (!report) return;
    const blob = new Blob(['\uFEFF' + csvFor(report)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `banhao-payouts-${week}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <h1 style={styles.title}>จ่ายเงินร้านและไรเดอร์</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" style={styles.ghostButton} onClick={() => setWeek(shiftWeek(week, -1))} data-testid="week-prev">
          ← สัปดาห์ก่อน
        </button>
        <strong data-testid="week-label">
          {report ? `${report.period.weekStart} ถึง ${report.period.weekEnd}` : week}
        </strong>
        <button type="button" style={styles.ghostButton} onClick={() => setWeek(shiftWeek(week, 1))} data-testid="week-next">
          สัปดาห์ถัดไป →
        </button>
        <button type="button" style={styles.ghostButton} onClick={downloadCsv} disabled={!report} data-testid="download-csv">
          ดาวน์โหลด CSV
        </button>
      </div>
      <p style={styles.meta}>
        นับออเดอร์และงานที่ส่งสำเร็จถึงสิ้นสัปดาห์ (จันทร์–อาทิตย์ เวลาไทย) ที่ยังไม่ได้จ่าย รวมยอดค้างจากสัปดาห์ก่อน ·
        ร้านได้ค่าอาหาร − คอมมิชชั่น · ไรเดอร์ได้ค่าไรเดอร์ของงาน
      </p>

      {error ? <p style={styles.errorText}>{error}</p> : null}
      {!report && !error ? <p style={styles.subtitle}>{copy.loading}</p> : null}

      {report ? (
        <section style={styles.panel}>
          <h2 style={styles.sectionTitle}>ยอดที่ต้องโอน</h2>
          {parties.length === 0 ? (
            <p style={styles.meta} data-testid="nothing-owed">ไม่มียอดค้างจ่าย</p>
          ) : (
            <table style={styles.table} data-testid="owed-table">
              <thead>
                <tr>
                  <th style={styles.th}>ประเภท</th>
                  <th style={styles.th}>ชื่อ</th>
                  <th style={styles.th}>รายการ</th>
                  <th style={styles.th}>ยอดโอน</th>
                  <th style={styles.th} />
                </tr>
              </thead>
              <tbody>
                {parties.map((p) => (
                  <tr key={`${p.partyType}-${p.partyId}`}>
                    <td style={styles.td}>{p.partyType === 'MERCHANT' ? 'ร้าน' : 'ไรเดอร์'}</td>
                    <td style={styles.td}>{p.name}</td>
                    <td style={styles.td}>
                      {p.count}
                      {p.carried > 0 ? <span style={styles.meta}> (ค้างจากก่อนหน้า {p.carried})</span> : null}
                    </td>
                    <td style={styles.td}>
                      <strong>{baht(p.totalSatang)}</strong>
                    </td>
                    <td style={styles.td}>
                      {isAdmin ? (
                        <button type="button" style={styles.ghostButton} onClick={() => setRecording(p)} data-testid={`record-${p.partyId}`}>
                          บันทึกว่าโอนแล้ว
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {recording ? (
        <section style={styles.panel} data-testid="record-form">
          <h2 style={styles.sectionTitle}>
            บันทึกการโอน {baht(recording.totalSatang)} ให้ {recording.name}
          </h2>
          <label style={styles.label}>
            วันที่โอน
            <input style={styles.input} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} data-testid="input-paid-on" />
          </label>
          <label style={styles.label}>
            เลขอ้างอิงจากสลิป
            <input style={styles.input} value={reference} onChange={(e) => setReference(e.target.value)} data-testid="input-reference" />
          </label>
          {saveError ? <p style={styles.errorText}>{saveError}</p> : null}
          <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
            <button
              type="button"
              style={styles.button(saving || reference.trim() === '')}
              disabled={saving || reference.trim() === ''}
              onClick={() => void confirmTransfer()}
              data-testid="button-confirm-transfer"
            >
              {saving ? 'กำลังบันทึก' : 'ยืนยันว่าโอนแล้ว'}
            </button>
            <button type="button" style={styles.ghostButton} onClick={() => setRecording(null)}>
              ยกเลิก
            </button>
          </div>
        </section>
      ) : null}

      {report && report.needsReview.length > 0 ? (
        <section style={styles.panel} data-testid="needs-review">
          <h2 style={styles.sectionTitle}>ต้องตรวจเอง (ไม่จ่ายอัตโนมัติ)</h2>
          <table style={styles.table}>
            <tbody>
              {report.needsReview.map((item) => (
                <tr key={`${item.kind}-${item.orderId}`}>
                  <td style={styles.td}>{item.orderNumber ?? item.orderId}</td>
                  <td style={styles.td}>{item.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section style={styles.panel}>
        <h2 style={styles.sectionTitle}>ประวัติการโอน</h2>
        <table style={styles.table} data-testid="payout-history">
          <thead>
            <tr>
              <th style={styles.th}>วันที่โอน</th>
              <th style={styles.th}>ให้</th>
              <th style={styles.th}>ยอด</th>
              <th style={styles.th}>เลขอ้างอิง</th>
              <th style={styles.th}>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => (
              <tr key={row.id}>
                <td style={styles.td}>{row.paidOn}</td>
                <td style={styles.td}>{row.partyName}</td>
                <td style={styles.td}>{baht(row.totalSatang)}</td>
                <td style={styles.td}>{row.bankReference}</td>
                <td style={styles.td}>
                  {row.voidedAt ? (
                    <span style={styles.meta}>ยกเลิกแล้ว: {row.voidReason}</span>
                  ) : isAdmin ? (
                    <button type="button" style={styles.ghostButton} onClick={() => void voidRow(row)}>
                      ยกเลิกบันทึก
                    </button>
                  ) : (
                    'โอนแล้ว'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default function PayoutsPage() {
  return (
    <ConsoleShell>
      <Payouts />
    </ConsoleShell>
  );
}
