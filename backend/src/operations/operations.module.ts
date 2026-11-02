import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';
import { MonthlyObservationsController } from './monthly-observations.controller';
import { MonthlyObservationsService } from './monthly-observations.service';

@Module({ imports: [CoreModule], controllers: [OperationsController, MonthlyObservationsController], providers: [OperationsService, MonthlyObservationsService], exports: [OperationsService] })
export class OperationsModule {}
