import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService, type UserProfileDto } from './users.service.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { CurrentUser, type RequestUser } from '../common/decorators/auth.decorators.js';

/** `/api/v1/users` — the caller's own account (no user ids are exposed). */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Profile + progress summary for the caller' })
  findMe(@CurrentUser() user: RequestUser): Promise<UserProfileDto> {
    return this.users.findMe(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update display name, avatar or username' })
  updateMe(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileDto> {
    return this.users.updateMe(user.id, dto);
  }
}