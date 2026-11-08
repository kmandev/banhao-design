'use client';

import { useCallback, useEffect, useState } from 'react';
import type { EarningsResponse } from '@banhao/validation';
import { apiClient } from '../lib/apiClient';

/**
 * DEC-073 / DEC-070 Q5 — the restaurant's earnings: each delivered order of
 * the week (food − 10% commission) and whether BANHAO has transferred it,
 * everything still owed, and recent transfers. Read-only. No design artifact
 * exists (UX-SPEC M-13 is LATER); a plain table in the app's style.
 */
function baht(satang: number): string {
  const value = satang / 100;
  return `฿${Number.isInteger(value) ? value.toLocaleString('th-TH') : value.toFixed(2)}`;
}

export function currentMonday(now: Date = new Date()): string {
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const sinceMonday = (bkk.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() - sinceMonday)).toISOString().slice(0, 10);
}

function shiftWeek(weekStart: string, weeks: number): string {
  return new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + weeks * 7 * 86400000).toISOString().slice(0, 10);
}

const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #EFE7DC', fontSize: 14, textAlign: 'left' };
const card: React.CSSProperties = { background: '#fff', border: '1px solid #E9E0D5', borderRadius: 16, padding: 16 };
const button: React.CSSProperties = { border: '1px solid #E9E0D5', background: '#fff', borderRadius: 10, padding: '6px 12px', cursor: 'pointer', fontSize: 14 };

export function EarningsView({ restaurantId }: { restaurantId: string }) {
  const [week, setWeek] = useState(currentMonday());
  const [data, setData] = useState<EarningsResponse | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setError(false);
    setData(null);
    apiClient
      .request<EarningsResponse>(`/api/v1/merchant/restaurants/${restaurantId}/earnings?week=${week}`)
      .then(setData)
      .catch(() => setError(true));
  }, [restaurantId, week]);

  useEffect(load, [load]);

  return (
    <div style={{ display: 'grid', gap: 16 }} data-testid="earnings-view">
      <h1 style={{ fontSize: 22, margin: 0 }}>รายได้</h1>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button type="button" style={button} onClick={() => setWeek(shiftWeek(week, -1))} data-testid="earnings-prev">
          ← สัปดาห์ก่อน
        </button>
        <strong>{data ? `${data.period.weekStart} ถึง ${data.period.weekEnd}` : week}</strong>
        <button type="button" style={button} onClick={() => setWeek(shiftWeek(week, 1))} data-testid="earnings-next">
          สัปดาห์ถัดไป →
        </button>
      </div>

      {error ? (
        <div style={card}>
          โหลดรายได้ไม่สำเร็จ{' '}
          <button type="button" style={button} onClick={load}>
            ลองอีกครั้ง
          </button>
        </div>
      ) : null}
      {!data && !error ? <p>กำลังโหลด…</p> : null}

      {data ? (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={card} data-testid="earnings-week-total">
              <div style={{ fontSize: 13, color: '#7A6D5F' }}>รายได้สัปดาห์นี้</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{baht(data.weekTotalSatang)}</div>
            </div>
            <div style={card} data-testid="earnings-outstanding">
              <div style={{ fontSize: 13, color: '#7A6D5F' }}>รอโอนทั้งหมด</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{baht(data.outstandingSatang)}</div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: '#7A6D5F', margin: 0 }}>
            รายได้ต่อออเดอร์ = ค่าอาหาร − ค่าคอมมิชชั่น 10% · BANHAO โอนให้สัปดาห์ละครั้ง
          </p>

          <div style={card}>
            {data.lines.length === 0 ? (
              <p style={{ margin: 0 }} data-testid="earnings-empty">ยังไม่มีออเดอร์ที่ส่งสำเร็จในสัปดาห์นี้</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="earnings-table">
                <thead>
                  <tr>
                    <th style={cell}>ออเดอร์</th>
                    <th style={cell}>ค่าอาหาร</th>
                    <th style={cell}>คอมมิชชั่น</th>
                    <th style={cell}>รายได้</th>
                    <th style={cell}>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line) => (
                    <tr key={line.id}>
                      <td style={cell}>{line.orderNumber}</td>
                      <td style={cell}>{baht(line.foodSatang ?? 0)}</td>
                      <td style={cell}>−{baht(line.commissionSatang ?? 0)}</td>
                      <td style={cell}>
                        <strong>{baht(line.amountSatang)}</strong>
                      </td>
                      <td style={cell}>{line.paid ? 'โอนแล้ว' : 'รอโอน'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={card}>
            <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>การโอนล่าสุด</h2>
            {data.payouts.length === 0 ? (
              <p style={{ margin: 0 }}>ยังไม่มีการโอน</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }} data-testid="earnings-payouts">
                <tbody>
                  {data.payouts.map((p) => (
                    <tr key={`${p.paidOn}-${p.bankReference}`}>
                      <td style={cell}>{p.paidOn}</td>
                      <td style={cell}>{baht(p.totalSatang)}</td>
                      <td style={cell}>{p.items} ออเดอร์</td>
                      <td style={cell}>อ้างอิง {p.bankReference}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
