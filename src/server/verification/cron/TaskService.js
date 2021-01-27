// @flow
import moment from 'moment'
import { toLower, pickBy, mapKeys } from 'lodash'

import Config from '../../server.config'
import AdminWallet from '../../blockchain/AdminWallet'
import logger from '../../../imports/logger'

export const DISPOSE_ENROLLMENTS_TASK = 'verification/dispose_enrollments'

export const DisposeAt = {
  Reauthenticate: 'auth-period',
  AccountRemoved: 'account-removal'
}

class TaskService {
  keepEnrollments = null

  constructor(config, storage, adminApi, logger) {
    const { keepFaceVerificationRecords } = config

    this.logger = logger
    this.storage = storage
    this.adminApi = adminApi
    this.keepEnrollments = keepFaceVerificationRecords
  }

  // eslint-disable-next-line require-await
  async hasDisposalTask(enrollmentIdentifier, executeAt = DisposeAt.AccountRemoved) {
    const { storage, getTaskFilters } = this
    const filters = getTaskFilters(enrollmentIdentifier, executeAt)

    return storage.hasTasksQueued(DISPOSE_ENROLLMENTS_TASK, filters)
  }

  async scheduleDisposalTask(enrollmentIdentifier, executeAt = DisposeAt.AccountRemoved) {
    const { storage, getTaskFilters, createTaskSubject } = this
    const filters = getTaskFilters(enrollmentIdentifier)
    const newTaskSubject = createTaskSubject(enrollmentIdentifier, executeAt)

    await storage.cancelTasksQueued(DISPOSE_ENROLLMENTS_TASK, filters)
    return storage.enqueueTask(DISPOSE_ENROLLMENTS_TASK, newTaskSubject)
  }

  async fetchDisposalTasks() {
    const { Reauthenticate, AccountRemoved } = DisposeAt
    const { storage, adminApi, keepEnrollments } = this

    const authenticationPeriod = await adminApi.getAuthenticationPeriod()
    const deletedAccountFilters = { 'subject.executeAt': AccountRemoved }

    if (keepEnrollments > 0) {
      deletedAccountFilters.createdAt = {
        $lte: moment()
          .subtract(keepEnrollments, 'hours')
          .toDate()
      }
    }

    const enqueuedAtFilters = {
      $or: [
        deletedAccountFilters,
        {
          'subject.executeAt': Reauthenticate,
          createdAt: {
            $lte: moment()
              .subtract(authenticationPeriod + 1, 'days') // give extra one day before we delete
              .toDate()
          }
        }
      ]
    }

    return storage.fetchTasksForProcessing(DISPOSE_ENROLLMENTS_TASK, enqueuedAtFilters)
  }

  async lockDisposalTask(enrollmentIdentifier) {
    const { storage, getTaskFilters } = this
    const filters = getTaskFilters(enrollmentIdentifier)

    await storage.fetchTasksForProcessing(DISPOSE_ENROLLMENTS_TASK, filters)
  }

  async unlockDisposalTask(enrollmentIdentifier) {
    const { storage, getTaskFilters } = this
    const filters = getTaskFilters(enrollmentIdentifier)

    await storage.unlockDelayedTasks(DISPOSE_ENROLLMENTS_TASK, filters)
  }

  createTaskSubject = (enrollmentIdentifier, executeAt) => ({
    executeAt,
    enrollmentIdentifier: toLower(enrollmentIdentifier)
  })

  getTaskFilters = (enrollmentIdentifier, executeAt = null) => {
    const subject = this.createTaskSubject(enrollmentIdentifier, executeAt)

    return mapKeys(pickBy(subject), (_, key) => `subject.${key}`)
  }
}

const taskServices = new WeakMap()
const defaultLogger = logger.child({ from: 'TaskService' })

export default (storage, log = defaultLogger) => {
  if (!taskServices.has(storage)) {
    const taskService = new TaskService(Config, storage, AdminWallet, log)

    taskServices.set(storage, taskService)
  }

  return taskServices.get(storage)
}
