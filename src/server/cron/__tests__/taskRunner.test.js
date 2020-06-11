import TaskRunner from '../TaskRunner'
import moment from 'moment'
import delay from 'delay'

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
    expect(TaskRunner.tasks.length).toEqual(0)
    TaskRunner.registerTask(testTask)
    console.log(TaskRunner.tasks)
    expect(TaskRunner.tasks.length).toEqual(1)
  })

  test('it should run task', async () => {
    TaskRunner.startTasks()
    await delay(3000)
    expect(executeSpy).toHaveBeenCalled()
  })

  test('it should run task again with rescheduled time', async () => {
    await delay(3000)
    TaskRunner.stopTasks()
    expect(executeSpy).toHaveBeenCalledTimes(2)
  })

  test('it should run cron syntax multiple times', async () => {
    TaskRunner.registerTask(testCronTask)
    TaskRunner.startTasks()
    await delay(2000)
    TaskRunner.stopTasks()
    expect(executeCronSpy).toHaveBeenCalledTimes(2)
  })
})
