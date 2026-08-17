import { Global, Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { CapabilitiesService } from './capabilities.service';
import { AddressesService } from './addresses.service';
import { AddressesController } from './addresses.controller';

@Global()
@Module({
  controllers: [AddressesController],
  providers: [UsersService, CapabilitiesService, AddressesService],
  exports: [UsersService, CapabilitiesService, AddressesService],
})
export class UsersModule {}
