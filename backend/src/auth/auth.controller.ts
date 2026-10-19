import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import { Actor, CurrentActor, Public } from '../core/auth.decorators';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto, RefreshDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post('login') @HttpCode(200) @Header('Cache-Control', 'no-store')
  login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Public() @Post('refresh') @HttpCode(200) @Header('Cache-Control', 'no-store')
  refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto.refreshToken); }
  @Post('logout') @HttpCode(200)
  logout(@CurrentActor() actor: Actor) { return this.auth.logout(actor); }
  @Get('me') @Header('Cache-Control', 'no-store')
  me(@CurrentActor() actor: Actor) { return this.auth.me(actor); }
  @Post('change-password') @HttpCode(200)
  changePassword(@CurrentActor() actor: Actor, @Body() dto: ChangePasswordDto) { return this.auth.changePassword(actor, dto); }
}
