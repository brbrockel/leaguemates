import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { CurrentUser, SiteAdminOnly, type SessionUser } from '../auth/decorators.js';
import { ZodPipe } from '../common/validation.js';
import { CoursesService } from './courses.service.js';

const Course = z.object({
  name: z.string().trim().min(1).max(80),
  city: z.string().trim().max(60).nullish(),
  state: z.string().trim().max(30).nullish(),
  notes: z.string().trim().max(120).nullish(),
  website: z
    .url({ protocol: /^https?$/ })
    .max(200)
    .nullish(),
  pinned: z.boolean().optional(),
});
const Hole = z.object({
  number: z.number().int().min(1).max(18),
  par: z.number().int().min(3).max(6),
  strokeIndex: z.number().int().min(1).max(18),
  yards: z.number().int().min(50).max(700).nullish(),
});
const Layout = z.object({
  name: z.string().trim().min(1).max(40),
  tees: z.string().trim().min(1).max(20),
  holes: z
    .array(Hole)
    .refine((hs) => hs.length === 9 || hs.length === 18, 'A layout has 9 or 18 holes'),
});
const NewLayout = Layout.extend({ replaces: z.uuid().optional() });
const ImageBody = z.object({ caption: z.string().trim().max(120).optional() });
const Uuid = new ParseUUIDPipe();

/** Courses are shared by every league: anyone signed in can view them, site admins edit them. */
@Controller('courses')
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Get()
  list() {
    return this.courses.list();
  }

  @Get(':courseId')
  get(@Param('courseId', Uuid) courseId: string) {
    return this.courses.get(courseId);
  }

  @Post()
  @SiteAdminOnly()
  create(
    @CurrentUser() user: SessionUser,
    @Body(new ZodPipe(Course)) body: z.infer<typeof Course>,
  ) {
    return this.courses.create(user, body);
  }

  @Patch(':courseId')
  @SiteAdminOnly()
  update(
    @CurrentUser() user: SessionUser,
    @Param('courseId', Uuid) courseId: string,
    @Body(new ZodPipe(Course)) body: z.infer<typeof Course>,
  ) {
    return this.courses.update(user, courseId, body);
  }

  @Post(':courseId/layouts')
  @SiteAdminOnly()
  addLayout(
    @CurrentUser() user: SessionUser,
    @Param('courseId', Uuid) courseId: string,
    @Body(new ZodPipe(NewLayout)) body: z.infer<typeof NewLayout>,
  ) {
    return this.courses.addLayout(user, courseId, body);
  }

  @Put(':courseId/layouts/:layoutId')
  @SiteAdminOnly()
  updateLayout(
    @CurrentUser() user: SessionUser,
    @Param('courseId', Uuid) courseId: string,
    @Param('layoutId', Uuid) layoutId: string,
    @Body(new ZodPipe(Layout)) body: z.infer<typeof Layout>,
  ) {
    return this.courses.updateLayout(user, courseId, layoutId, body);
  }

  @Delete(':courseId/layouts/:layoutId')
  @SiteAdminOnly()
  removeLayout(
    @CurrentUser() user: SessionUser,
    @Param('courseId', Uuid) courseId: string,
    @Param('layoutId', Uuid) layoutId: string,
  ) {
    return this.courses.removeLayout(user, courseId, layoutId);
  }

  @Post(':courseId/images')
  @SiteAdminOnly()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }))
  addImage(
    @CurrentUser() user: SessionUser,
    @Param('courseId', Uuid) courseId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body(new ZodPipe(ImageBody)) body: z.infer<typeof ImageBody>,
  ) {
    return this.courses.addImage(user, courseId, file?.buffer, body.caption || null);
  }

  @Get(':courseId/images/:imageId')
  image(@Param('courseId', Uuid) courseId: string, @Param('imageId', Uuid) imageId: string) {
    return this.courses.openImage(courseId, imageId);
  }

  @Delete(':courseId/images/:imageId')
  @SiteAdminOnly()
  removeImage(
    @CurrentUser() user: SessionUser,
    @Param('courseId', Uuid) courseId: string,
    @Param('imageId', Uuid) imageId: string,
  ) {
    return this.courses.removeImage(user, courseId, imageId);
  }
}
