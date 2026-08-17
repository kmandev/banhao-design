import { Injectable, Logger } from '@nestjs/common';
import type { Role, UserProfile } from '@banhao/types';
import { isRole } from '@banhao/types';
import { SupabaseService } from '../../supabase/supabase.service';

interface ProfileRow {
  id: string;
  role: string;
  phone: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Reads application user profiles.
 *
 * Uses the service-role client deliberately: the API enforces authorization in
 * its own guards, and needs to read a profile before a request's capabilities
 * are known. RLS still protects direct client access to the same table.
 *
 * **`role` here is NOT an authorization input** (DEC-033 / DEC-APP-004). It is
 * the deprecated legacy `profiles.role` column, carried only so the existing
 * `GET /api/v1/me` client contract keeps working. Authorization is resolved
 * from domain membership by {@link CapabilitiesService}; nothing in the guard
 * chain reads this field.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async findById(id: string): Promise<UserProfile | null> {
    const { data, error } = await this.supabase.admin
      .from('profiles')
      .select('id, role, phone, display_name, created_at, updated_at')
      .eq('id', id)
      .maybeSingle<ProfileRow>();

    if (error) {
      this.logger.error(`Failed to load profile ${id}: ${error.message}`);
      return null;
    }

    if (!data) {
      return null;
    }

    return this.toProfile(data);
  }

  private toProfile(row: ProfileRow): UserProfile {
    return {
      id: row.id,
      role: this.parseRole(row.role, row.id),
      phone: row.phone,
      displayName: row.display_name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * The database constrains role via an enum, so an unknown value means the
   * schema and this code have drifted. Falls back to the least-privileged value
   * rather than trusting an unrecognised one.
   *
   * @deprecated Presentation only — this value authorizes nothing (DEC-APP-004).
   */
  private parseRole(value: string, userId: string): Role {
    if (isRole(value)) {
      return value;
    }

    this.logger.error(`Unknown role "${value}" on profile ${userId}; defaulting to CUSTOMER`);
    return 'CUSTOMER';
  }
}
