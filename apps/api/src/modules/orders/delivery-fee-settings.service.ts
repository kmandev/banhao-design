import { Injectable, Logger } from '@nestjs/common';
import {
  DELIVERY_FEE_MAX_SATANG,
  DELIVERY_FEE_MIN_SATANG,
  RIDER_EARNING_FLOOR_SATANG,
  RIDER_SHARE_BASIS_POINTS,
  previewDeliveryFee,
  type DeliveryFeeSetting,
  type DeliveryFeeSettingRequest,
  type DeliveryFeeSettingsResponse,
} from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';
import { getCorrelationId } from '../../common/correlation/correlation';
import { uuidSchema } from '@banhao/validation';

interface SettingRow {
  id: string;
  mode: string;
  fixed_satang: number | null;
  percent_basis_points: number | null;
  min_satang: number | null;
  max_satang: number | null;
  reason: string;
  created_by: string | null;
  created_at: string;
}

type StoredSetting = DeliveryFeeSetting & { id: string; reason: string; createdAt: string; createdBy: string | null };

const COLUMNS = 'id, mode, fixed_satang, percent_basis_points, min_satang, max_satang, reason, created_by, created_at';

/** Sample baskets for the admin preview: ฿50, ฿100, ฿300 of food. */
const PREVIEW_SUBTOTALS = [5000, 10000, 30000] as const;

/**
 * DEC-070 §2 / DEC-071 — reads and changes the delivery-fee setting.
 *
 * The newest `delivery_fee_settings` row is in force. A change is a new row,
 * never an edit, plus an `audit_logs` row naming the staff member and reason.
 * Reading fails closed: with no readable, well-formed setting, no order is
 * priced (order creation fails before `create_order()` is called).
 */
@Injectable()
export class DeliveryFeeSettingsService {
  private readonly logger = new Logger(DeliveryFeeSettingsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** The setting in force. Throws INTERNAL_ERROR rather than guessing a fee. */
  async current(): Promise<DeliveryFeeSetting> {
    const rows = await this.readNewest(1);
    const row = rows[0];
    if (!row) {
      this.logger.error('delivery_fee_settings has no row; refusing to price an order');
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery fee is not configured' });
    }
    return toSetting(row);
  }

  async overview(): Promise<DeliveryFeeSettingsResponse> {
    const rows = await this.readNewest(20);
    if (rows.length === 0) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery fee is not configured' });
    }
    const history = rows.map(toStored);
    return {
      current: history[0] as StoredSetting,
      history,
      preview: previewDeliveryFee(history[0] as StoredSetting, PREVIEW_SUBTOTALS),
      bounds: {
        minSatang: DELIVERY_FEE_MIN_SATANG,
        maxSatang: DELIVERY_FEE_MAX_SATANG,
        riderShareBasisPoints: RIDER_SHARE_BASIS_POINTS,
        riderFloorSatang: RIDER_EARNING_FLOOR_SATANG,
      },
    };
  }

  /** Appends a new setting (ADMIN only — enforced by the route) and audits it. */
  async change(staffUserId: string, request: DeliveryFeeSettingRequest): Promise<DeliveryFeeSettingsResponse> {
    const before = await this.current();

    const insert =
      request.mode === 'FIXED'
        ? { mode: 'FIXED', fixed_satang: request.fixedSatang }
        : {
            mode: 'PERCENT',
            percent_basis_points: request.percentBasisPoints,
            min_satang: request.minSatang,
            max_satang: request.maxSatang,
          };

    const { data, error } = await this.supabase.admin
      .from('delivery_fee_settings')
      .insert({ ...insert, reason: request.reason, created_by: staffUserId })
      .select(COLUMNS)
      .maybeSingle<SettingRow>();

    if (error || !data) {
      this.logger.error(`delivery_fee_settings insert failed: ${error?.message ?? 'no row'}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery fee change failed' });
    }

    const correlationId = uuidSchema.safeParse(getCorrelationId());
    const { error: auditError } = await this.supabase.admin.from('audit_logs').insert({
      actor_type: 'OPERATOR',
      actor_id: staffUserId,
      action: 'DeliveryFeeSettingChanged',
      entity_type: 'delivery_fee_settings',
      entity_id: data.id,
      before,
      after: toSetting(data),
      reason: request.reason,
      correlation_id: correlationId.success ? correlationId.data : null,
      source: 'api',
    });
    if (auditError) {
      // The setting row itself names the staff member, time and reason, so the
      // change is still attributable; the audit row is the cross-domain index.
      this.logger.error(`audit_logs insert failed for delivery fee change ${data.id}: ${auditError.message}`);
    }

    return this.overview();
  }

  private async readNewest(limit: number): Promise<SettingRow[]> {
    const { data, error } = await this.supabase.admin
      .from('delivery_fee_settings')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(limit)
      .returns<SettingRow[]>();

    if (error) {
      this.logger.error(`delivery_fee_settings read failed: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Delivery fee is unavailable' });
    }
    return data ?? [];
  }
}

function toSetting(row: SettingRow): DeliveryFeeSetting {
  if (row.mode === 'FIXED' && row.fixed_satang !== null) {
    return { mode: 'FIXED', fixedSatang: row.fixed_satang };
  }
  if (row.mode === 'PERCENT' && row.percent_basis_points !== null) {
    return {
      mode: 'PERCENT',
      percentBasisPoints: row.percent_basis_points,
      minSatang: row.min_satang,
      maxSatang: row.max_satang,
    };
  }
  throw new DomainError('INTERNAL_ERROR', { message: 'Delivery fee setting is malformed' });
}

function toStored(row: SettingRow): StoredSetting {
  return { ...toSetting(row), id: row.id, reason: row.reason, createdAt: row.created_at, createdBy: row.created_by };
}
