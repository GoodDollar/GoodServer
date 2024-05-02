// @flow
import { mapKeys, pickBy, toLower } from 'lodash'

export const DISPOSE_ENROLLMENTS_TASK = 'verification/dispose_enrollments'

export const DisposeAt = {
  Reauthenticate: 'auth-period',
  AccountRemoved: 'account-removal'
}

export const createTaskSubject = (enrollmentIdentifier, executeAt) => ({
  executeAt,
  enrollmentIdentifier: toLower(enrollmentIdentifier)
})

export const forEnrollment = (enrollmentIdentifier, executeAt = null) => {
  const subject = createTaskSubject(enrollmentIdentifier, executeAt)

  return mapKeys(pickBy(subject), (_, key) => `subject.${key}`)
}

export const cancelDisposalTask = async (storage, enrollmentIdentifier): Promise<void> => {
  await storage.cancelTasksQueued(DISPOSE_ENROLLMENTS_TASK, forEnrollment(enrollmentIdentifier))
}

export const scheduleDisposalTask = async (storage, enrollmentIdentifier, executeAt): Promise<DelayedTaskRecord> => {
  await cancelDisposalTask(storage, enrollmentIdentifier)

  return storage.enqueueTask(DISPOSE_ENROLLMENTS_TASK, createTaskSubject(enrollmentIdentifier, executeAt))
}

export const getDisposalTask = async (storage, enrollmentIdentifier): Promise<void> => {
  return storage.getTask(DISPOSE_ENROLLMENTS_TASK, forEnrollment(enrollmentIdentifier))
}
