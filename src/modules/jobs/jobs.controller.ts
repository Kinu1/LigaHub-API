import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Public } from '../auth/auth.decorators.js';
import { JobsGuard } from './jobs.guard.js';
import { JobsRunner } from './jobs.runner.js';

@Public()
@UseGuards(JobsGuard)
@Controller('internal/jobs')
export class JobsController {
  constructor(@Inject(JobsRunner) private readonly runner: JobsRunner) {}
  @Get('emails')
  emails() {
    return this.runner.run('emails');
  }
  @Get('payments')
  payments() {
    return this.runner.run('payments');
  }
}
