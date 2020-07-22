import MongoLock from '../utils/tx-manager/queueMongo'
import { CronJob, CronTime } from 'cron'
import { invokeMap, map, filter } from 'lodash'

import logger from '../../imports/logger'

class TaskRunner {
  lock = null
  jobFactory = null
  tasks = []

  constructor(lock, jobFactory, logger) {
    const exitEvents = ['SIGINT', 'beforeExit']

    this.lock = lock
    this.logger = logger
    this.jobFactory = jobFactory

    exitEvents.forEach(event => process.on(event, () => this.stopTasks()))
  }

  registerTask(task) {
    const { logger, tasks, lock, jobFactory } = this
    const { schedule, name } = task
    const taskIdentifier = name || tasks.length

    const taskJob = new jobFactory(schedule, async () => {
      logger.info('Running cron task', { taskIdentifier })

      const { address, release, fail } = await lock.lock(taskIdentifier)
      logger.info('got task lock:', { address, taskIdentifier })
      try {
        const taskResult = await task.execute({
          // an context object we're passing to the task to let it manipilate its execution & schedule
          // let task whould decide to stop or to set new schedule by themselves during execution
          // let's make this feedback more clear
          setTime: time => {
            logger.info('Cron task setting new schedule', { taskName: name, schedule: time })

            taskJob.setTime(time instanceof CronTime ? time : new CronTime(time))
            taskJob.start()
          },

          stop: () => {
            logger.info('Cron task has stopped itself', { taskName: name })
            taskJob.stop()
          }
        })

        release()
        logger.info('Cron task completed', { taskIdentifier, taskResult })
      } catch (exception) {
        fail()
        const { message: errMessage } = exception

        logger.error('Cron task failed', errMessage, exception, { taskIdentifier })
      }
    })

    tasks.push(taskJob)
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

const startTaskRunner = () =>
  new TaskRunner(new MongoLock('tasksRunner'), CronJob, logger.child({ from: 'TaskRunner' }))
export default startTaskRunner
