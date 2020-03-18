// @flow
export type UserRecord = {
  identifier: string,
  fullName?: string,
  mobile?: string,
  email?: string,
  jwt?: string,
  smsValidated?: boolean,
  isEmailConfirmed?: boolean,
  otp?: { code: number, expirationDate: number, tempMauticId: string },
  isCompleted?: { whiteList: boolean, w3Record: boolean, marketToken: boolean, topWallet: boolean },
  emailVerificationCode?: string,
  mauticId?: string
}

export type JWTRecord = {
  method: 'eth',
  loggedInAs: string,
  gdAddress: string,
  profilePublickey: string
}

export type LoggedUser = JWTRecord & UserRecord

export interface StorageAPI {
  getUser(identifier: string): Promise<UserRecord | void>;
  getUserField(identifier: string, field: string): Promise<any>;
  completeStep(identifier: string, stepName: string): Promise<any>;
  addUser(user: UserRecord): Promise<boolean>;
  updateUser(user: UserRecord): Promise<boolean>;
  deleteUser(user: UserRecord): Promise<boolean>;
  listUsers(cb: ({ [string]: UserRecord }) => void): void;
}

export interface VerificationAPI {
  verifyUser(user: UserRecord, verificationData: any): Promise<boolean | Error>;
  verifyMobile(user: UserRecord, verificationData: { otp: string }): Promise<boolean | Error>;
  verifyEmail(user: UserRecord, verificationData: { code: string }): Promise<boolean | Error>;
}
