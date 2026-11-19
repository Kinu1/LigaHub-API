-- Snapshot recipients must survive until campaign retention allows removal.
-- Block hard deletion of source registrations; cancellation remains supported.
ALTER TABLE "communication_recipients" DROP CONSTRAINT "communication_recipients_registrationId_fkey";
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_recipients_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_campaigns" ADD CONSTRAINT "communication_snapshot_nonnegative" CHECK ("snapshotCount" >= 0);
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachment_bounds" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 10485760 AND "totalChunks" BETWEEN 1 AND 20);
ALTER TABLE "communication_attachment_chunks" ADD CONSTRAINT "communication_chunk_bounds" CHECK ("chunkIndex" BETWEEN 0 AND 19);
ALTER TABLE "communication_recipients" ADD CONSTRAINT "communication_attempt_bounds" CHECK ("attempts" BETWEEN 0 AND 5);
