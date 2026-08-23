/**
 * In-memory `AddressRepository` — fixture binding, for tests and offline UI
 * work (Phase DQ-04).
 *
 * Mirrors `mockCart.ts`'s shape: a factory holding closed-over mutable state,
 * plus a default singleton bound only into `mockRepositories`, never into the
 * live `repositories` object.
 */

import type { Address } from '../mocks/types';
import { addresses as seedAddresses } from '../mocks/data';
import type { AddressPatchInput, AddressRepository, AddressWriteInput } from './types';

const LATENCY_MS = 250;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

const ADDRESS_GLYPH = '📍';

function buildAddress(id: string, input: AddressWriteInput): Address {
  const rawLabel = input.label ?? null;
  const landmark = input.landmark ?? null;

  return {
    id,
    label: rawLabel ?? input.recipientName,
    glyph: ADDRESS_GLYPH,
    line: landmark ? `${input.addressLine} · ${landmark}` : input.addressLine,
    isDefault: input.isDefault ?? false,
    rawLabel,
    recipientName: input.recipientName,
    recipientPhone: input.recipientPhone,
    addressLine: input.addressLine,
    landmark,
    instructions: input.instructions ?? null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
  };
}

/** Builds an in-memory address repository. Each call gets its own isolated state. */
export function createMockAddressRepository(seed: Address[] = seedAddresses): AddressRepository {
  let addresses = seed.map((address) => ({ ...address }));
  let sequence = 0;

  return {
    listAddresses: () => delay(addresses.map((address) => ({ ...address }))),

    async createAddress(input: AddressWriteInput): Promise<Address> {
      sequence += 1;

      if (input.isDefault) {
        addresses = addresses.map((address) => ({ ...address, isDefault: false }));
      }

      const created = buildAddress(`mock-address-${sequence}`, input);
      addresses = [...addresses, created];
      return delay({ ...created });
    },

    async updateAddress(addressId: string, patch: AddressPatchInput): Promise<Address> {
      const existing = addresses.find((address) => address.id === addressId);
      if (!existing) throw new Error('Address not found');

      if (patch.isDefault === true) {
        addresses = addresses.map((address) =>
          address.id === addressId ? address : { ...address, isDefault: false },
        );
      }

      const merged = buildAddress(addressId, {
        label: 'label' in patch ? patch.label : existing.rawLabel,
        recipientName: patch.recipientName ?? existing.recipientName,
        recipientPhone: patch.recipientPhone ?? existing.recipientPhone,
        addressLine: patch.addressLine ?? existing.addressLine,
        landmark: 'landmark' in patch ? patch.landmark : existing.landmark,
        instructions: 'instructions' in patch ? patch.instructions : existing.instructions,
        lat: 'lat' in patch ? patch.lat : existing.lat,
        lng: 'lng' in patch ? patch.lng : existing.lng,
        isDefault: patch.isDefault ?? existing.isDefault,
      });

      addresses = addresses.map((address) => (address.id === addressId ? merged : address));
      return delay({ ...merged });
    },

    async archiveAddress(addressId: string): Promise<void> {
      addresses = addresses.filter((address) => address.id !== addressId);
      await delay(undefined);
    },
  };
}

export const mockAddressRepository: AddressRepository = createMockAddressRepository();
