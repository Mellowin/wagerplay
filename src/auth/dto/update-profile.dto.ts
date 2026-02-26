import { IsOptional, Length, IsIn, IsString } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @Length(1, 20, { message: 'Display name must be between 1 and 20 characters' })
  displayName?: string;

  @IsOptional()
  @IsIn(['male', 'female', ''], { message: 'Gender must be male, female, or empty' })
  gender?: 'male' | 'female' | '';

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
