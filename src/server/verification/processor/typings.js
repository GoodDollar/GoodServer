// @flow

export interface IEnrollmentEventPayload {
  isEnroll: boolean;
  isDuplicate: boolean;
  isLive: boolean;
}

export interface IEnrollmentProvider {
  isPayloadValid(payload: any): boolean;

  enroll(
    enrollmentIdentifier: string,
    payload: any,
    onEnrollmentProcessing: (payload: IEnrollmentEventPayload) => void | Promise<void>
  ): Promise<any>;
}

// TODO: other types e.g. IEnrollmentProcessor, IEnrollmentProvider,
// payload interfaces, response interfacws etc
