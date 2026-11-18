import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { UTApi, UTFiles } from 'uploadthing/server';
import { getDb } from '@/lib/db';
import { requireUser } from '@/lib/server/auth';

const f = createUploadthing();

export const ourFileRouter = {
  /** Original presentation files, uploaded directly from the browser. */
  sourceFile: f({ blob: { maxFileSize: '64MB', maxFileCount: 1 } })
    .middleware(async ({ req }) => {
      const user = await requireUser(getDb(), req);
      // UploadThing signs any key on request, so ownership has to come from the
      // upload itself: the relayed legacy-ppt path only accepts ids that start
      // with the caller's own user id. The id reaches the stored file through
      // the UTFiles symbol; returning `customId` as plain metadata is ignored.
      return { userId: user.id, [UTFiles]: [{ customId: `${user.id}-${crypto.randomUUID()}` }] };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      // The dashboard can default to public; make privacy explicit regardless.
      await new UTApi().updateACL(file.key, 'private');
      return { userId: metadata.userId, key: file.key, customId: file.customId };
    })
} satisfies FileRouter;

export type OurFileRouter = typeof ourFileRouter;
