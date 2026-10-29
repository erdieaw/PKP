import { Body, Controller, Get, Module, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentActor, Roles } from '../core/auth.decorators';
import type { Actor } from '../core/auth.decorators';
import { CoreModule } from '../core/core.module';
import { PeriodRecapQuery, SavePeriodRecapDto } from './recaps.dto';
import { RecapsService } from './recaps.service';

@ApiTags('Period recaps')
@ApiBearerAuth()
@Controller('records/period-recaps')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class RecapsController {
  constructor(private readonly recaps: RecapsService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() query: PeriodRecapQuery) {
    return this.recaps.list(actor, query);
  }

  @Put()
  @Roles(Role.ADMIN_PUSKESMAS, Role.PIC)
  save(@CurrentActor() actor: Actor, @Body() dto: SavePeriodRecapDto) {
    return this.recaps.save(actor, dto);
  }
}

@Module({ imports: [CoreModule], controllers: [RecapsController], providers: [RecapsService], exports: [RecapsService] })
export class RecapsModule {}
