import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getAppInfo(): { name: string; status: string } {
    return {
      name: 'LigaHub API',
      status: 'running',
    };
  }
}
