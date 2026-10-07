import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/auth/auth.decorators.js';
import { AppService } from './app.service.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @Public()
    getAppInfo(): { name: string; status: string } {
        return this.appService.getAppInfo();
    }
}
