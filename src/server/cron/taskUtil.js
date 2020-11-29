//@flow
export const DISPOSE_ENROLLMENTS_TASK = 'verification/dispose_enrollments'

export const scheduleDisposalTask = async (storage, enrollmentIdentifier, executeAt): Promise<DelayedTaskRecord> => {
  await storage.cancelTasksQueued(DISPOSE_ENROLLMENTS_TASK, { 'subject.enrollmentIdentifier': enrollmentIdentifier })
  return await storage.enqueueTask(DISPOSE_ENROLLMENTS_TASK, { enrollmentIdentifier, executeAt })
}
