import AsyncLock from 'async-lock'
import { CronJob } from 'cron'
import { invokeMap } from 'lodash'

class TaskRunner {
  lock = null
  jobFactory = null
  tasks = []

  // TODO: inject logger
  constructor(lock, jobFactory) {
    const exitEvents = ['SIGINT', 'SIGTERM', 'exit']

    this.lock = lock
    this.jobFactory = jobFactory

    exitEvents.forEach(event => process.on(event, () => this.stopTasks()))
  }

  registerTask(task) {
    const { tasks, lock, jobFactory } = this
    const { schedule, name } = task
    const taskIdentifier = name || tasks.length

    tasks.push(
      new jobFactory(schedule, async () => {
        try {
          await lock.acquire(taskIdentifier, async () => task.execute())
          // TODO: log task success
        } catch (exception) {
          // TODO: log task error
        }
      })
    )
  }

  // TODO: log tasks started / stopped
  startTasks() {
    invokeMap(this.tasks, 'start')
  }

  stopTasks() {
    invokeMap(this.tasks, 'stop')
  }
}

export default new TaskRunner(new AsyncLock(), CronJob)
