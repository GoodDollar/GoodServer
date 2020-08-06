import startTaskRunner from '../TaskRunner'
import moment from 'moment'
import delay from 'delay'

const TaskRunner = startTaskRunner()
jest.setTimeout(10000)
describe('TaskRunner', () => {
  const testTask = {
    schedule: moment()
      .add(3, 'seconds')
      .toDate(),
    name: 'testTask',
    execute: async ({ setTime }) => {
      setTime(
        moment()
          .add(3, 'seconds')
          .toDate()
      )
    }
  }
  const testCronTask = {
    schedule: '* * * * * *',
    name: 'testCronTask',
    execute: async () => {}
  }

  const executeSpy = jest.spyOn(testTask, 'execute')
  const executeCronSpy = jest.spyOn(testCronTask, 'execute')
  test('it should queue task', async () => {
    expect(Object.keys(TaskRunner.tasks).length).toEqual(0)
    TaskRunner.registerTask(testTask)
    expect(Object.keys(TaskRunner.tasks).length).toEqual(1)
  })

  test('it should run task', async () => {
    TaskRunner.startTasks()
    await delay(3500)
    expect(executeSpy).toHaveBeenCalled()
  })

  test('it should run task again with rescheduled time', async () => {
    await delay(3500)
    TaskRunner.stopTasks()
    expect(executeSpy).toHaveBeenCalledTimes(2)
  })

  test('it should run cron syntax multiple times', async () => {
    TaskRunner.registerTask(testCronTask)
    TaskRunner.startTasks()
    await delay(2200)
    TaskRunner.stopTasks()
    expect(executeCronSpy).toHaveBeenCalledTimes(2)
  })
})
