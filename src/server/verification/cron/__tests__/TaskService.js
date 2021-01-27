// @flow
import createTaskService, { DisposeAt } from '../TaskService'

const storageMock = {}
const ucEnrollmentIdentifier = 'f0D7A688489Ab3079491d407A03BF16e5B027b2c'
const enrollmentIdentifier = ucEnrollmentIdentifier.toLowerCase()

describe('TaskService', () => {
  const taskService = createTaskService(storageMock)
  const { AccountRemoved, Reauthenticate } = DisposeAt

  test('createTaskSubject() should set identifier and disposal condition', () => {
    ;[AccountRemoved, Reauthenticate].forEach(condition => {
      expect(taskService.createTaskSubject(ucEnrollmentIdentifier, condition)).toEqual({
        enrollmentIdentifier,
        executeAt: condition
      })
    })
  })

  test('createTaskSubject() should set identifier to lower case', () => {
    expect(taskService.createTaskSubject(ucEnrollmentIdentifier, Reauthenticate)).toEqual({
      enrollmentIdentifier,
      executeAt: Reauthenticate
    })
  })

  test('getTaskFilters() should generate full document paths', () => {
    expect(taskService.getTaskFilters(enrollmentIdentifier, Reauthenticate)).toEqual({
      'subject.enrollmentIdentifier': enrollmentIdentifier,
      'subject.executeAt': Reauthenticate
    })
  })

  test('getTaskFilters() should not set executeAt if omited', () => {
    expect(taskService.getTaskFilters(enrollmentIdentifier)).toEqual({
      'subject.enrollmentIdentifier': enrollmentIdentifier
    })
  })
})
