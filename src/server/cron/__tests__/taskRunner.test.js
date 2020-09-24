import getTaskRunner from '../TaskRunner'
import moment from 'moment'
import delay from 'delay'
import { size } from 'lodash'

const TaskRunner = getTaskRunner()
jest.setTimeout(20000)

describe('TaskRunner', () => {
  const testTask = {
    name: 'testTask',
    schedule: moment()
      .add(3, 'seconds')
      .toDate(),
    execute: async ({ setTime }) =>
      setTime(
        moment()
          .add(3, 'seconds')
          .toDate()
      )
  }

  const testCronTask = {
    name: 'testCronTask',
    schedule: '* * * * * *',
    execute: async () => {}
  }

  const executeSpy = jest.spyOn(testTask, 'execute')
  const executeCronSpy = jest.spyOn(testCronTask, 'execute')

  test('it should queue task', async () => {
    expect(size(TaskRunner.tasks)).toEqual(0)
    TaskRunner.registerTask(testTask)
    expect(size(TaskRunner.tasks)).toEqual(1)
  })

  test('it should run task', async () => {
    TaskRunner.startTasks()
    await delay(5500)
    expect(executeSpy).toHaveBeenCalled()
  })

  test('it should run task again with rescheduled time', async () => {
    await delay(3500)
    TaskRunner.stopTasks()
    // check if there was at lest one additional call during last 3.5sec
    expect(executeSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  test('it should run cron syntax multiple times', async () => {
    TaskRunner.registerTask(testCronTask)
    TaskRunner.startTasks()
    await delay(12500)
    TaskRunner.stopTasks()
    // check if there was at lest 2 call during last 2.5 sec
    expect(executeCronSpy.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
