import { z } from 'zod';

/** Email as typed on a phone: trims spaces and lower-cases before validating. */
export const EmailInput = z.string().trim().toLowerCase().pipe(z.email().max(254));
