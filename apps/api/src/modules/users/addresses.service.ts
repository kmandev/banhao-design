import { Injectable, Logger } from '@nestjs/common';
import type { CreateAddressInput, UpdateAddressInput } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

/** `public.addresses`, as selected by this service. */
interface AddressRow {
  id: string;
  label: string | null;
  recipient_name: string;
  recipient_phone: string;
  address_line: string;
  landmark: string | null;
  instructions: string | null;
  lat: number | null;
  lng: number | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** The client-facing shape. Deliberately omits `user_id` — it is always "you". */
export interface Address {
  id: string;
  label: string | null;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  landmark: string | null;
  instructions: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const ADDRESS_COLUMNS =
  'id, label, recipient_name, recipient_phone, address_line, landmark, instructions, lat, lng, is_default, created_at, updated_at';

/**
 * Saved delivery addresses, always scoped to one user.
 *
 * **Ownership is a query filter, not a check.** Every statement below carries
 * `user_id = <verified JWT subject>` in its `WHERE`/`INSERT`, so another user's
 * row is not merely rejected — it is never selected in the first place. There is
 * no code path where a client-supplied id or user id decides whose data is
 * touched, which is what makes read/update/delete isolation structural rather
 * than something a future edit could accidentally drop.
 *
 * Runs on the service-role client (RLS bypassed), so this scoping *is* the
 * enforcement for API callers; the equivalent RLS policies remain in force for
 * the direct-from-client read path and are unchanged by this service.
 */
@Injectable()
export class AddressesService {
  private readonly logger = new Logger(AddressesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Active addresses, default first, then newest. Archived rows never appear. */
  async list(userId: string): Promise<Address[]> {
    const { data, error } = await this.supabase.admin
      .from('addresses')
      .select(ADDRESS_COLUMNS)
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false })
      .returns<AddressRow[]>();

    if (error) {
      this.fail('list', userId, error.message);
    }

    return (data ?? []).map(toAddress);
  }

  /**
   * One address, scoped to its owner — for a caller (Phase E-2's
   * `OrdersService`) that needs to confirm a specific id is genuinely usable
   * before snapshotting it, not to render a list.
   *
   * Same ownership-as-a-query-filter shape as every other method here:
   * `user_id` and `archived_at is null` are in the `WHERE`, so a foreign or
   * archived id is never selected, not merely rejected after the fact.
   * Returns `null` for "does not exist" and "belongs to someone else" alike —
   * the caller cannot distinguish them, matching `update`/`archive`'s own
   * `NOT_FOUND` precedent.
   */
  async getOwned(userId: string, addressId: string): Promise<Address | null> {
    const { data, error } = await this.supabase.admin
      .from('addresses')
      .select(ADDRESS_COLUMNS)
      .eq('id', addressId)
      .eq('user_id', userId)
      .is('archived_at', null)
      .maybeSingle<AddressRow>();

    if (error) {
      this.fail('getOwned', userId, error.message);
    }

    return data ? toAddress(data) : null;
  }

  async create(userId: string, input: CreateAddressInput): Promise<Address> {
    // Clear first, then insert. The reverse order would momentarily hold two
    // default rows and be refused by `addresses_one_default_idx`. Doing it this
    // way, an interruption leaves the user with no default — recoverable by
    // setting one — rather than a write the index rejects outright.
    if (input.isDefault) {
      await this.clearDefault(userId);
    }

    const { data, error } = await this.supabase.admin
      .from('addresses')
      .insert({
        user_id: userId,
        label: input.label ?? null,
        recipient_name: input.recipientName,
        recipient_phone: input.recipientPhone,
        address_line: input.addressLine,
        landmark: input.landmark ?? null,
        instructions: input.instructions ?? null,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        is_default: input.isDefault ?? false,
      })
      .select(ADDRESS_COLUMNS)
      .maybeSingle<AddressRow>();

    if (error) {
      this.fail('create', userId, error.message);
    }

    if (!data) {
      throw new DomainError('INTERNAL_ERROR', { message: 'Address insert returned no row' });
    }

    return toAddress(data);
  }

  async update(userId: string, addressId: string, input: UpdateAddressInput): Promise<Address> {
    if (input.isDefault === true) {
      await this.clearDefault(userId, addressId);
    }

    const patch = toPatch(input);

    const { data, error } = await this.supabase.admin
      .from('addresses')
      .update(patch)
      .eq('id', addressId)
      .eq('user_id', userId)
      .is('archived_at', null)
      .select(ADDRESS_COLUMNS)
      .maybeSingle<AddressRow>();

    if (error) {
      this.fail('update', userId, error.message);
    }

    // No row matched. Indistinguishable, on purpose, between "does not exist"
    // and "belongs to someone else": telling them apart would confirm the
    // existence of another user's address to anyone who guessed an id.
    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Address not found' });
    }

    return toAddress(data);
  }

  /**
   * Archives an address.
   *
   * The database refuses hard deletes on this table — there is no DELETE grant
   * or policy, by design (migration `20260811000011`, §13): an order snapshots
   * its address text at creation, so removing a row must never be able to
   * rewrite delivery history. `archived_at` is the only removal path, and this
   * method is what `DELETE /me/addresses/:id` means.
   */
  async archive(userId: string, addressId: string): Promise<void> {
    const { data, error } = await this.supabase.admin
      .from('addresses')
      .update({ archived_at: new Date().toISOString(), is_default: false })
      .eq('id', addressId)
      .eq('user_id', userId)
      .is('archived_at', null)
      .select('id')
      .maybeSingle<{ id: string }>();

    if (error) {
      this.fail('archive', userId, error.message);
    }

    if (!data) {
      throw new DomainError('NOT_FOUND', { message: 'Address not found' });
    }
  }

  /**
   * Drops the default flag from the user's other addresses.
   *
   * `except` keeps an update that re-asserts default on the row already holding
   * it from clearing itself first.
   */
  private async clearDefault(userId: string, except?: string): Promise<void> {
    let query = this.supabase.admin
      .from('addresses')
      .update({ is_default: false })
      .eq('user_id', userId)
      .eq('is_default', true)
      .is('archived_at', null);

    if (except) {
      query = query.neq('id', except);
    }

    const { error } = await query;

    if (error) {
      this.fail('clearDefault', userId, error.message);
    }
  }

  private fail(operation: string, userId: string, message: string): never {
    this.logger.error(`Address ${operation} failed for ${userId}: ${message}`);
    throw new DomainError('INTERNAL_ERROR', { message: `Address ${operation} failed` });
  }
}

function toAddress(row: AddressRow): Address {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipient_name,
    recipientPhone: row.recipient_phone,
    addressLine: row.address_line,
    landmark: row.landmark,
    instructions: row.instructions,
    lat: row.lat,
    lng: row.lng,
    isDefault: row.is_default,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps validated input to column names, including only keys actually present so
 * a partial update never blanks a field the caller did not mention.
 */
function toPatch(input: UpdateAddressInput): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  if ('label' in input) patch.label = input.label ?? null;
  if ('recipientName' in input) patch.recipient_name = input.recipientName;
  if ('recipientPhone' in input) patch.recipient_phone = input.recipientPhone;
  if ('addressLine' in input) patch.address_line = input.addressLine;
  if ('landmark' in input) patch.landmark = input.landmark ?? null;
  if ('instructions' in input) patch.instructions = input.instructions ?? null;
  if ('lat' in input) patch.lat = input.lat ?? null;
  if ('lng' in input) patch.lng = input.lng ?? null;
  if ('isDefault' in input) patch.is_default = input.isDefault;

  return patch;
}
