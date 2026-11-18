import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { UTApi } from 'uploadthing/server';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/server/auth';

const f = createUploadthing();

export const ourFileRouter = {
  /** Original presentation files, uploaded directly from the browser. */
  sourceFile: f({ blob: { maxFileSize: '64MB', maxFileCount: 1 } })
    .middleware(async ({ req }) => {
      const user = await requireUser(getDb(), req);
      return { userId: user.id };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // The dashboard can default to public; make privacy explicit regardless.
      await new UTApi().updateACL(file.key, 'private');
      return { userId: metadata.userId, key: file.key };
    })
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
