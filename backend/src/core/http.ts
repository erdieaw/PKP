import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { map } from 'rxjs/operators';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    let statusCode = 500;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';
    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();
      const body = typeof response === 'string' ? { message: response } : response as { message?: string | string[]; error?: string };
      message = body.message ?? exception.message;
      error = body.error ?? exception.name;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mappings: Record<string, [number, string]> = {
        P2002: [409, 'Resource already exists'], P2003: [400, 'Invalid resource reference'],
        P2025: [404, 'Resource not found'], P2034: [409, 'Concurrent update; retry the request'],
      };
      [statusCode, message] = mappings[exception.code] ?? [503, 'Database unavailable'];
      error = statusCode === 409 ? 'Conflict' : statusCode === 404 ? 'Not Found' : statusCode === 400 ? 'Bad Request' : 'Service Unavailable';
    } else if (exception instanceof Prisma.PrismaClientInitializationError || exception instanceof Prisma.PrismaClientRustPanicError || exception instanceof Prisma.PrismaClientUnknownRequestError) {
      statusCode = 503; message = 'Database unavailable'; error = 'Service Unavailable';
    } else if (exception && typeof exception === 'object' && 'type' in exception) {
      // Express parser errors are not Nest HttpExceptions; never echo their bodies.
      if (exception.type === 'entity.too.large') {
        statusCode = 413; message = 'Request body too large'; error = 'Payload Too Large';
      } else if (exception.type === 'entity.parse.failed') {
        statusCode = 400; message = 'Invalid request body'; error = 'Bad Request';
      }
    }
    host.switchToHttp().getResponse<Response>().status(statusCode).json({
      success: false, statusCode, message, error, meta: { timestamp: new Date().toISOString() },
    });
  }
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(map(data => ({
      success: true, statusCode: context.switchToHttp().getResponse<Response>().statusCode,
      data: data ?? null, meta: { timestamp: new Date().toISOString() },
    })));
  }
}
