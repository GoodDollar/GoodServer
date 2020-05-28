// @flow

import CronTasksRunner from '../cron/TaskRunner'

/**
 * Clean up before server will be stopped
 * @param options - Add some options if required
 */
export default function(options: any = {}) {
  // Stop executing cron tasks
  CronTasksRunner.stopTasks()

  if (options.exit) process.exit(options.exitCode)
}
