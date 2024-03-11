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

export type IdScanRequest = {
  idScan: any,
  idScanFrontImage: any,
  idScanBackImage: any
}

export type IdScanResult = {
  matchLevel: number,
  success: boolean,
  isMatch: boolean,
  documentData: any
}

// TODO: other types e.g. IEnrollmentProcessor, IEnrollmentProvider,
// payload interfaces, response interfacws etc
