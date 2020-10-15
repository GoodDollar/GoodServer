import { CronJob, CronTime } from 'cron'
import { invokeMap, keys, once } from 'lodash'
import { v4 as uuidv4 } from 'uuid'
import moment from 'moment'
import MongoLock from '../utils/tx-manager/queueMongo'
import logger from '../../imports/logger'

class TaskRunner {
  lock = null
  jobFactory = null
  tasks = {}

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
    const taskName = name || `task/${uuidv4()}`
    const taskJob = new jobFactory(schedule, async () => {
      const taskId = uuidv4()
      try {
        logger.info('Running cron task. getting lock...', { taskName, taskId })

        const { address, release } = await lock.lock(taskName, 60000, taskId)
        // we don't need re-queue in the cron. just lock -> run -> release (despite success/failed)
        logger.info('Obtained mutex for exclusive run:', { address, taskName, taskId })

        try {
          const taskResult = await task.execute({
            // an context object we're passing to the task to let it manipilate its execution & schedule
            // let task whould decide to stop or to set new schedule by themselves during execution
            // let's make this feedback more clear
            setTime: time => {
              logger.info('Cron task setting new schedule', { taskName, schedule: time, taskId })

              taskJob.setTime(time instanceof CronTime ? time : new CronTime(time))
              taskJob.start()
            },

            stop: () => {
              logger.info('Cron task has stopped itself', { taskName, taskId })
              taskJob.stop()
            }
          })

          logger.info('Cron task completed', { taskName, taskResult, taskId })
        } catch (exception) {
          const { message: errMessage } = exception

          logger.error('Cron task failed', errMessage, exception, { taskName, taskId })
        } finally {
          release()
        }
      } catch (exception) {
        const { message: errMessage } = exception
        if (errMessage.includes('lock not acquired timeout')) {
          const nextTry = moment().add(1, 'hours')
          logger.info('task lock timeout,probably other worker is doing it, retrying later', {
            taskName,
            nextTry,
            taskId
          })
          taskJob.setTime(new CronTime(nextTry))
          taskJob.start()
          return
        }
        logger.error('Cron task failed', errMessage, exception, { taskName, taskId })
      }
    })

    logger.info('Cron task registered', { taskName, schedule })
    tasks[taskName] = taskJob
  }

  startTasks() {
    const { logger, tasks } = this

    logger.info('Starting cron tasks', keys(tasks))
    invokeMap(tasks, 'start')
  }

  stopTasks() {
    const { logger, tasks } = this

    logger.info('Stopping cron tasks', keys(tasks))
    invokeMap(tasks, 'stop')
  }
}

export default once(
  () =>
    new TaskRunner(
      new MongoLock('tasksRunner', 3600 /*60 minutes lock*/),
      CronJob,
      logger.child({ from: 'TaskRunner' })
    )
)
