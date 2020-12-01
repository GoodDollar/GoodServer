// @flow
export const DISPOSE_ENROLLMENTS_TASK = 'verification/dispose_enrollments'

export const DisposeAt = {
  Reauthenticate: 'auth-period',
  AccountRemoved: 'account-removal'
}

export const forEnrollment = enrollmentIdentifier => ({ 'subject.enrollmentIdentifier': enrollmentIdentifier })

// eslint-disable-next-line require-await
export const scheduleDisposalTask = async (storage, enrollmentIdentifier, executeAt): Promise<DelayedTaskRecord> => {
  await storage.cancelTasksQueued(DISPOSE_ENROLLMENTS_TASK, forEnrollment(enrollmentIdentifier))

  return storage.enqueueTask(DISPOSE_ENROLLMENTS_TASK, { enrollmentIdentifier, executeAt })
}
