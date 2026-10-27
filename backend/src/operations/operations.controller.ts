import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveYearDto, ActiveYearResponseDto } from './operations.dto';
import { Role } from '@prisma/client';
import { Actor, CurrentActor, Roles } from '../core/auth.decorators';
import { ActionPlanDto, ArchiveQuery, AssignmentDto, AuditQuery, BulkMonthlyDto, BulkTargetsDto, CreateHealthCenterDto, CreateUserDto, CreateYearDto, FeedbackDto, IdParam, IndicatorQuery, LockYearDto, MonthlyQuery, PaginationQuery, RecommendationQuery, ResetPasswordDto, ReviewWorkflowDto, TenantQuery, UpdateHealthCenterDto, UpdateUserDto, WorkflowDto, YearParam, YearQuery } from './operations.dto';
import { OperationsService } from './operations.service';
import { WorkflowConflictFilter } from './workflow-conflict.filter';

@ApiTags('Operations')
@ApiBearerAuth()
@Controller()
@UseFilters(WorkflowConflictFilter)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true, transformOptions: { enableImplicitConversion: false } }))
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get('master/indicators') @ApiTags('Master')
  @ApiOperation({ summary: 'Read the indicator catalogue', description: 'Defaults to active indicators in active sections. Administrators may includeArchived=true. Pagination is optional; without page/limit all matching indicators are returned.' })
  indicators(@CurrentActor() actor: Actor, @Query() query: IndicatorQuery) { return this.operations.indicators(actor, query); }

  @Get('master/sections') @ApiTags('Master')
  sections(@CurrentActor() actor: Actor, @Query() query: ArchiveQuery) { return this.operations.sections(actor, query); }

  @Get('master/years') @ApiTags('Master')
  years() { return this.operations.years(); }

  @Get('master/active-year') @ApiTags('Master')
  @ApiOkResponse({ type: ActiveYearResponseDto })
  activeYear() { return this.operations.activeYear(); }

  @Put('master/active-year') @Roles(Role.DINKES_ADMIN) @ApiTags('Master')
  @ApiOkResponse({ type: ActiveYearResponseDto })
  setActiveYear(@CurrentActor() actor: Actor, @Body() dto: ActiveYearDto) { return this.operations.setActiveYear(actor, dto); }

  @Post('master/years') @Roles(Role.DINKES_ADMIN) @ApiTags('Master')
  createYear(@CurrentActor() actor: Actor, @Body() dto: CreateYearDto) { return this.operations.createYear(actor, dto); }

  @Patch('master/years/:year') @Roles(Role.DINKES_ADMIN) @ApiTags('Master')
  setYear(@CurrentActor() actor: Actor, @Param() params: YearParam, @Body() dto: LockYearDto) { return this.operations.setYear(actor, params.year, dto); }

  @Delete('master/years/:year') @Roles(Role.DINKES_ADMIN) @ApiTags('Master')
  deleteYear(@CurrentActor() actor: Actor, @Param() params: YearParam) { return this.operations.deleteYear(actor, params.year); }

  @Get('health-centers') @ApiTags('Master')
  healthCenters(@CurrentActor() actor: Actor, @Query() query: TenantQuery) { return this.operations.healthCenters(actor, query.healthCenterId); }

  @Post('health-centers') @Roles(Role.DINKES_ADMIN) @ApiTags('Master')
  createHealthCenter(@CurrentActor() actor: Actor, @Body() dto: CreateHealthCenterDto) { return this.operations.createHealthCenter(actor, dto); }

  @Patch('health-centers/:id') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('Master')
  updateHealthCenter(@CurrentActor() actor: Actor, @Param() params: IdParam, @Body() dto: UpdateHealthCenterDto) { return this.operations.updateHealthCenter(actor, params.id, dto); }

  @Delete('health-centers/:id') @Roles(Role.DINKES_ADMIN) @ApiTags('Master')
  deleteHealthCenter(@CurrentActor() actor: Actor, @Param() params: IdParam) { return this.operations.deleteHealthCenter(actor, params.id); }

  @Get('users/admin-puskesmas') @Roles(Role.DINKES_ADMIN) @ApiTags('Users')
  admins(@CurrentActor() actor: Actor, @Query() query: PaginationQuery) { return this.operations.users(actor, Role.ADMIN_PUSKESMAS, query); }

  @Post('users/admin-puskesmas') @Roles(Role.DINKES_ADMIN) @ApiTags('Users')
  createAdmin(@CurrentActor() actor: Actor, @Body() dto: CreateUserDto) { return this.operations.createUser(actor, Role.ADMIN_PUSKESMAS, dto); }

  @Get('users/pics') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('Users')
  pics(@CurrentActor() actor: Actor, @Query() query: PaginationQuery) { return this.operations.users(actor, Role.PIC, query); }

  @Post('users/pics') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('Users')
  createPic(@CurrentActor() actor: Actor, @Body() dto: CreateUserDto) { return this.operations.createUser(actor, Role.PIC, dto); }

  @Patch('users/:id') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('Users')
  updateUser(@CurrentActor() actor: Actor, @Param() params: IdParam, @Body() dto: UpdateUserDto) { return this.operations.updateUser(actor, params.id, dto); }

  @Delete('users/:id') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('Users')
  deleteUser(@CurrentActor() actor: Actor, @Param() params: IdParam, @Query() query: TenantQuery) { return this.operations.deleteUser(actor, params.id, query.healthCenterId); }

  @Post('users/:id/reset-password') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('Users')
  resetPassword(@CurrentActor() actor: Actor, @Param() params: IdParam, @Body() dto: ResetPasswordDto) { return this.operations.resetPassword(actor, params.id, dto); }

  @Get('targets/annual/:year') @ApiTags('Targets')
  annualTargets(@CurrentActor() actor: Actor, @Param() params: YearParam, @Query() query: TenantQuery) { return this.operations.annualTargets(actor, params.year, query.healthCenterId); }

  @Put('targets/annual/:year/bulk') @Roles(Role.ADMIN_PUSKESMAS) @ApiTags('Targets')
  @ApiOperation({ summary: 'Atomically persist annual targets', description: 'Rejects changes with 409 when annual targets are locked, any tenant period is submitted/verified, or affected indicators already have monthly records. Existing records are not silently left with stale scores.' })
  saveTargets(@CurrentActor() actor: Actor, @Param() params: YearParam, @Body() dto: BulkTargetsDto) { return this.operations.saveTargets(actor, params.year, dto); }

  @Post('targets/annual/:year/lock') @Roles(Role.ADMIN_PUSKESMAS) @ApiTags('Targets')
  lockTargets(@CurrentActor() actor: Actor, @Param() params: YearParam, @Body() dto: TenantQuery) { return this.operations.lockTargets(actor, params.year, dto.healthCenterId); }

  @Get('pic-assignments') @ApiTags('PIC Assignments')
  assignments(@CurrentActor() actor: Actor, @Query() query: YearQuery) { return this.operations.assignments(actor, query); }

  @Put('pic-assignments/bulk') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('PIC Assignments')
  saveAssignments(@CurrentActor() actor: Actor, @Body() dto: AssignmentDto) { return this.operations.saveAssignments(actor, dto); }

  @Delete('pic-assignments/:indicatorId') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('PIC Assignments')
  deleteAssignment(@CurrentActor() actor: Actor, @Param('indicatorId') indicatorId: string, @Query() query: YearQuery) { return this.operations.deleteAssignment(actor, indicatorId, query); }

  @Get('records/monthly') @ApiTags('Monthly Records')
  monthlyRecords(@CurrentActor() actor: Actor, @Query() query: MonthlyQuery) { return this.operations.monthlyRecords(actor, query); }

  @Put('records/monthly') @Roles(Role.ADMIN_PUSKESMAS, Role.PIC) @ApiTags('Monthly Records')
  @ApiOperation({ summary: 'Atomically save monthly numerators and calculate scores', description: 'Compatibility mode: annual population and target are prorated by 12. Explicit annual targets required; zero denominators or zero targets produce null metrics. PIC writes require an assignment. Evidence must already have been finalized by integrations. Every edit resets syncStatus to NOT_SYNCED.' })
  saveMonthly(@CurrentActor() actor: Actor, @Body() dto: BulkMonthlyDto) { return this.operations.saveMonthly(actor, dto); }

  @Get('workflow/periods') @ApiTags('Workflow')
  periods(@CurrentActor() actor: Actor, @Query() query: YearQuery) { return this.operations.periods(actor, query); }

  @Post('workflow/submit') @Roles(Role.ADMIN_PUSKESMAS) @ApiTags('Workflow')
  @ApiOperation({ summary: 'Submit a complete period and retain an immutable snapshot', description: 'A quarter covers January through quarter * 3; a monthly period covers one month. All active indicators require explicit targets and non-null scored records. Locks all annual targets. Existing verified child periods are allowed.' })
  submit(@CurrentActor() actor: Actor, @Body() dto: WorkflowDto) { return this.operations.workflow(actor, 'submit', dto); }

  @Post('workflow/verify') @Roles(Role.DINKES_ADMIN) @ApiTags('Workflow')
  verify(@CurrentActor() actor: Actor, @Body() dto: ReviewWorkflowDto) { return this.operations.workflow(actor, 'verify', dto); }

  @Post('workflow/revise') @Roles(Role.DINKES_ADMIN) @ApiTags('Workflow')
  @ApiOperation({ summary: 'Request revision of a submitted period', description: 'Requires revisionNote and expectedRevision. Returns 409 with transitive overlapping protected dependencies unless cascadeDependencies=true. Cascading atomically invalidates dependencies with full snapshot audits and returns invalidatedPeriods.' })
  revise(@CurrentActor() actor: Actor, @Body() dto: ReviewWorkflowDto) { return this.operations.workflow(actor, 'revise', dto); }

  @Post('workflow/reopen') @Roles(Role.DINKES_ADMIN) @ApiTags('Workflow')
  @ApiOperation({ summary: 'Reopen a verified period with a reason', description: 'Requires reason and expectedRevision. Retains the old snapshot in the period and full audit details. Returns 409 with transitive overlapping protected dependencies unless cascadeDependencies=true. Cascading atomically invalidates dependencies and returns invalidatedPeriods. Locked years reject every transition, including verify.' })
  reopen(@CurrentActor() actor: Actor, @Body() dto: ReviewWorkflowDto) { return this.operations.workflow(actor, 'reopen', dto); }

  @Get('recommendations') @ApiTags('Recommendations')
  recommendations(@CurrentActor() actor: Actor, @Query() query: RecommendationQuery) { return this.operations.recommendations(actor, query); }

  @Post('recommendations/feedback') @Roles(Role.DINKES_ADMIN) @ApiTags('Recommendations')
  feedback(@CurrentActor() actor: Actor, @Body() dto: FeedbackDto) { return this.operations.feedback(actor, dto); }

  @Patch('recommendations/:id/action-plan') @Roles(Role.ADMIN_PUSKESMAS) @ApiTags('Recommendations')
  actionPlan(@CurrentActor() actor: Actor, @Param() params: IdParam, @Body() dto: ActionPlanDto) { return this.operations.actionPlan(actor, params.id, dto); }

  @Get('audit-logs') @Roles(Role.ADMIN_PUSKESMAS, Role.DINKES_ADMIN) @ApiTags('Audit Logs')
  auditLogs(@CurrentActor() actor: Actor, @Query() query: AuditQuery) { return this.operations.auditLogs(actor, query); }
}
