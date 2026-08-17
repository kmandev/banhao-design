import { Global, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { CapabilitiesService } from './capabilities.service';

@Global()
@Module({
  providers: [UsersService, CapabilitiesService],
  exports: [UsersService, CapabilitiesService],
})
export class UsersModule {}
