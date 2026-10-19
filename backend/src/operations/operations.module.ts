import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Module({ imports: [CoreModule], controllers: [OperationsController], providers: [OperationsService], exports: [OperationsService] })
export class OperationsModule {}
