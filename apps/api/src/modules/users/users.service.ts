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
 * its own guards, and needs to read a profile before a request's role is known.
 * RLS still protects direct client access to the same table.
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
   * schema and this code have drifted. Fail closed to the least-privileged role
   * rather than trusting an unrecognised value.
   */
  private parseRole(value: string, userId: string): Role {
    if (isRole(value)) {
      return value;
    }

    this.logger.error(`Unknown role "${value}" on profile ${userId}; defaulting to CUSTOMER`);
    return 'CUSTOMER';
  }
}
