import AsyncLock from 'async-lock'
import { CronJob, CronTime } from 'cron'
import { invokeMap, map, filter } from 'lodash'

import logger from '../../imports/logger'

class TaskRunner {
  lock = null
  jobFactory = null
  tasks = []

  constructor(lock, jobFactory, logger) {
    const exitEvents = ['SIGINT', 'SIGTERM', 'exit']

    this.lock = lock
    this.logger = logger
    this.jobFactory = jobFactory

    exitEvents.forEach(event => process.on(event, () => this.stopTasks()))
  }

  registerTask(task) {
    const { logger, tasks, lock, jobFactory } = this
    const { schedule, name } = task
    const taskIdentifier = name || tasks.length

    tasks.push(
      //we use function and not arrow so CronJob can set this context
      new jobFactory(schedule, async function() {
        logger.info('Running cron task', { taskIdentifier })

        try {
          const taskResult = await lock.acquire(taskIdentifier, async () => task.execute())
          logger.info('Cron task completed', { taskIdentifier, taskResult })
          if (taskResult.cronTime) {
            logger.info('Cron task setting new schedule', { schedule: taskResult.cronTime })
            this.setTime(new CronTime(taskResult.cronTime))
            this.start()
          }
        } catch (exception) {
          const { message: errMessage } = exception

          logger.error('Cron task failed', { e: exception, errMessage, taskIdentifier })
        }
      })
    )
  }

  startTasks() {
    const { logger, tasks } = this

    logger.info('Starting cron tasks', filter(map(tasks, 'name')))
    invokeMap(tasks, 'start')
  }

  stopTasks() {
    const { logger, tasks } = this

    logger.info('Stopping cron tasks')
    invokeMap(tasks, 'stop')
  }
}

export default new TaskRunner(new AsyncLock(), CronJob, logger.child({ from: 'TaskRunner' }))
