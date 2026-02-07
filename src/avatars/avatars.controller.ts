import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'path';
import { readdirSync, readFileSync } from 'fs';

@Controller('avatars')
export class AvatarsController {
  private readonly avatarsPath = join(process.cwd(), 'public', 'avatars');

  @Get()
  getAvatarsList() {
    try {
      const files = readdirSync(this.avatarsPath);
      const avatars = files
        .filter(file => file.endsWith('.svg'))
        .map(file => ({
          id: file.replace('.svg', ''),
          url: `/avatars/${file}`,
          gender: file.startsWith('male') ? 'male' : file.startsWith('female') ? 'female' : 'neutral',
        }));
      
      return { avatars };
    } catch (error) {
      return { avatars: [] };
    }
  }

  @Get(':filename')
  getAvatar(@Res() res: Response, @Param('filename') filename: string) {
    try {
      const filePath = join(this.avatarsPath, filename);
      const content = readFileSync(filePath, 'utf-8');
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(content);
    } catch (error) {
      res.status(404).send('Avatar not found');
    }
  }
}
