// @flow

export const EnrollmentEvents = {
  Started: 'started',
  Processing: 'processing',
  Completed: 'completed'
}

export const EnrollmentProviders = {
  Zoom: 'zoom',
  Kairos: 'kairos'
}

export type EnrollmentProvider = $Values<EnrollmentProviders>

export type EnrollmentEvent = $Values<EnrollmentEvents>

export interface IEnrollmentEventPayload {
  isEnroll: boolean;
  isDuplicate: boolean;
  isLive: boolean;
}

export interface IEnrollmentProviderSubscriber {
  onEnrollmentStarted(): void;
  onEnrollmentProcessing(processingPayload: IEnrollmentEventPayload): void;
  onEnrollmentCompleted(completedPayload: IEnrollmentEventPayload): void;
}

// TODO: other types e.g. IEnrollmentProcessor, IEnrollmentProvider,
// payload interfaces, response interfacws etc
