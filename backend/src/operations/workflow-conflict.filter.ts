import { ArgumentsHost, Catch, ConflictException } from '@nestjs/common';
import { Response } from 'express';
import { ApiExceptionFilter } from '../core/http';

@Catch(ConflictException)
export class WorkflowConflictFilter extends ApiExceptionFilter {
  override catch(exception: ConflictException, host: ArgumentsHost) {
    const body = exception.getResponse();
    if (typeof body !== 'object' || !('dependencies' in body)) return super.catch(exception, host);
    host.switchToHttp().getResponse<Response>().status(409).json({
      success: false, statusCode: 409, message: exception.message, error: 'Conflict',
      dependencies: body.dependencies, meta: { timestamp: new Date().toISOString() },
    });
  }
}
