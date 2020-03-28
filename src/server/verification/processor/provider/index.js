// @flow

import EventEmitter from 'events';

import {
  EnrollmentEvents,
  type EnrollmentEvent,
  type IEnrollmentEventPayload,
  type IEnrollmentProviderSubscriber
} from '../typings';

class EnrollmentProvider extends EventEmitter {
  isPayloadValid(payload: any): boolean {}

  async enroll(payload: any, enrollmentIdentifier: string) {}

  emitStarted() {
    this.emit(EnrollmentEvents.Started);
  }

  emitProcessing(processingPayload: IEnrollmentEventPayload) {
    this.emit(EnrollmentEvents.Processing, processingPayload);
  }

  emitCompleted(completedPayload: IEnrollmentEventPayload) {
    this.emit(EnrollmentEvents.Completed, completedPayload);
  }

  subscribe(enrollmentProcessor: IEnrollmentProviderSubscriber) {
    for (let [eventName, event] of Object.entries(EnrollmentEvents)) {
      const handlerMethodName = 'onEnrollment' + eventName;
      const handler = enrollmentProcessor[handlerMethodName];

      this.on(event, handler.bind(enrollmentProcessor));
    }
  }
}

module.exports = EnrollmentProvider
