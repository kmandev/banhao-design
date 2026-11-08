import { Injectable, Logger } from '@nestjs/common';
import type { RegisterPushTokenRequest } from '@banhao/validation';
import { SupabaseService } from '../../supabase/supabase.service';
import { DomainError } from '../../common/errors/domain-error';

/**
 * LAUNCH_PLAN 1.1 — the caller's own device push tokens.
 *
 * A token is owned by whoever last registered it: registering moves it to the
 * caller and clears any revocation (a phone that changes hands stops notifying
 * the previous owner). Revoking is scoped to the caller, so one user can never
 * switch off another's device.
 */
@Injectable()
export class PushTokensService {
  private readonly logger = new Logger(PushTokensService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async register(userId: string, request: RegisterPushTokenRequest): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.supabase.admin.from('push_tokens').upsert(
      {
        user_id: userId,
        token: request.token,
        platform: request.platform,
        app: request.app,
        last_seen_at: now,
        revoked_at: null,
      },
      { onConflict: 'token' },
    );
    if (error) {
      this.logger.error(`push_tokens upsert failed for user ${userId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Push token registration failed' });
    }
  }

  async revoke(userId: string, token: string): Promise<void> {
    const { error } = await this.supabase.admin
      .from('push_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('token', token)
      .eq('user_id', userId)
      .is('revoked_at', null);
    if (error) {
      this.logger.error(`push_tokens revoke failed for user ${userId}: ${error.message}`);
      throw new DomainError('INTERNAL_ERROR', { message: 'Push token revocation failed' });
    }
  }
}
